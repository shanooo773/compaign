// Read-only production capture. Never calls D1 export (it can block the live DB),
// mailbox APIs, scheduler endpoints, migrations, or production mutations.
const fs = require("node:fs"),
  path = require("node:path"),
  crypto = require("node:crypto"),
  assert = require("node:assert/strict"),
  { spawnSync } = require("node:child_process");
const { DatabaseSync } = require("node:sqlite");
const directory = "apps/api/.wrangler";
const digest = (x) =>
  crypto
    .createHash("sha256")
    .update(typeof x === "string" ? x : JSON.stringify(x))
    .digest("hex");
const q = (x) => '"' + x.replaceAll('"', '""') + '"';
function protect(data, decrypt = false) {
  const command = `Add-Type -AssemblyName System.Security; $bytes=[Convert]::FromBase64String([Console]::In.ReadToEnd()); $result=[Security.Cryptography.ProtectedData]::${decrypt ? "Unprotect" : "Protect"}($bytes,$null,[Security.Cryptography.DataProtectionScope]::CurrentUser); [Console]::Out.Write([Convert]::ToBase64String($result))`;
  const result = spawnSync(
    "powershell.exe",
    ["-NoProfile", "-NonInteractive", "-Command", command],
    {
      input: Buffer.from(data).toString("base64"),
      encoding: "utf8",
      maxBuffer: 64 * 1024 * 1024,
      windowsHide: true,
    },
  );
  assert.equal(result.status, 0, "Windows user encryption failed");
  return Buffer.from(result.stdout.trim(), "base64");
}
let phase = "credential discovery";
async function main() {
  const account = JSON.parse(
    fs.readFileSync(directory + "/live-release-baseline.json", "utf8"),
  ).account;
  const login = fs.readFileSync(
    path.join(process.env.APPDATA, "xdg.config/.wrangler/config/default.toml"),
    "utf8",
  );
  const token = /oauth_token\s*=\s*"([^"\r\n]+)"/.exec(login)?.[1];
  assert(token, "Wrangler authentication missing");
  const base = "/accounts/" + account,
    worker = base + "/workers/scripts/ms-professor-outreach-api";
  async function api(route, body) {
    const response = await fetch(
      "https://api.cloudflare.com/client/v4" + route,
      {
        signal: AbortSignal.timeout(20000),
        method: body ? "POST" : "GET",
        headers: {
          Authorization: "Bearer " + token,
          "Content-Type": "application/json",
        },
        body: body ? JSON.stringify(body) : undefined,
      },
    );
    const result = await response.json();
    if (!response.ok || !result.success) {
      console.error(
        JSON.stringify({
          httpStatus: response.status,
          errorCodes: (result.errors || []).map((e) => e.code),
          diagnostic: (result.errors || []).map((e) =>
            String(e.message).slice(0, 300),
          ),
        }),
      );
      throw new Error("Read-only inspection failed");
    }
    return result.result;
  }
  const query = async (sql) =>
    (
      await api(
        base + "/d1/database/684cb48c-3f43-4cef-8217-cf9624d23522/query",
        { sql },
      )
    )[0].results;
  phase = "schema inspection";
  const schema = await query(
    "SELECT type,name,tbl_name,sql FROM sqlite_master WHERE sql IS NOT NULL AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%' ORDER BY type,name",
  );
  const tables = schema.filter((s) => s.type === "table");
  phase = "column inspection";
  // Derive columns locally from the captured schema to minimise production queries.
  const schemaDB = new DatabaseSync(":memory:");
  for (const table of tables) schemaDB.exec(table.sql);
  const columns = tables.map((table) =>
    schemaDB.prepare("PRAGMA table_info(" + q(table.name) + ")").all(),
  );
  schemaDB.close();
  const sql =
    "SELECT " +
    tables
      .map(
        (t, i) =>
          `(SELECT json_group_array(json_object(${columns[i].flatMap((c) => ["'" + c.name.replaceAll("'", "''") + "'", `json_object('kind',typeof(${q(c.name)}),'value',CASE WHEN typeof(${q(c.name)})='blob' THEN hex(${q(c.name)}) ELSE ${q(c.name)} END)`]).join(",")})) FROM ${q(t.name)}) AS ${q(t.name)}`,
      )
      .join(",");
  const start = new Date().toISOString();
  phase = "single-statement data snapshot";
  const snapshot = (await query(sql))[0];
  const data = Object.entries(snapshot).map(([name, data]) => ({ name, data })); // All application tables in one read statement snapshot.
  const schemaAfter = await query(
    "SELECT type,name,tbl_name,sql FROM sqlite_master WHERE sql IS NOT NULL AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%' ORDER BY type,name",
  );
  assert.equal(
    digest(schema),
    digest(schemaAfter),
    "Schema changed during capture; do not deploy",
  );
  phase = "worker settings inspection";
  const settings = await api(worker + "/settings"),
    schedules = await api(worker + "/schedules");
  const safeVars = Object.fromEntries(
    (settings.bindings || [])
      .filter(
        (b) =>
          b.type === "plain_text" &&
          [
            "APP_ORIGIN",
            "MAIL_PROVIDER",
            "MAIL_DELIVERY_ENABLED",
            "MAIL_FREE_PLAN_CONFIRMED",
            "MAIL_SENDER_VERIFIED",
            "LIVE_EMAIL_ENABLED",
            "MOCK_DELIVERY_ENABLED",
          ].includes(b.name),
      )
      .map((b) => [b.name, b.text]),
  );
  const bundle = {
    capturedAt: start,
    finishedAt: new Date().toISOString(),
    schema,
    data,
    settings,
    schedules,
  };
  phase = "encrypted backup creation";
  const plain = Buffer.from(JSON.stringify(bundle)),
    encrypted = protect(plain);
  const filename =
    directory + "/onboarding-production-" + Date.now() + ".dpapi";
  fs.writeFileSync(filename, encrypted, { flag: "wx" });
  const restored = protect(fs.readFileSync(filename), true);
  assert.equal(
    digest(restored.toString()),
    digest(plain.toString()),
    "Encrypted backup round trip failed",
  );
  // Verify schema and data by restoring only to an in-memory local SQLite DB.
  phase = "in-memory restore";
  const backup = JSON.parse(restored.toString());
  const db = new DatabaseSync(":memory:");
  db.exec("PRAGMA foreign_keys=OFF");
  for (const t of backup.schema.filter((s) => s.type === "table"))
    db.exec(t.sql);
  const counts = {};
  for (const item of backup.data) {
    const rows = JSON.parse(item.data);
    counts[item.name] = rows.length;
    for (const row of rows) {
      const names = Object.keys(row);
      db.prepare(
        `INSERT INTO ${q(item.name)} (${names.map(q).join(",")}) VALUES (${names.map(() => "?").join(",")})`,
      ).run(
        ...names.map((n) =>
          row[n].kind === "blob"
            ? Buffer.from(row[n].value, "hex")
            : row[n].value,
        ),
      );
    }
  }
  for (const item of backup.schema.filter((s) => s.type !== "table"))
    db.exec(item.sql);
  assert.equal(
    db.prepare("PRAGMA integrity_check").get().integrity_check,
    "ok",
  );
  assert.equal(db.prepare("PRAGMA foreign_key_check").all().length, 0);
  db.close();

  const decodeRows = (bundle, name) => {
    const item = bundle.data.find((t) => t.name === name);
    return item
      ? JSON.parse(item.data).map((row) =>
          Object.fromEntries(Object.entries(row).map(([k, v]) => [k, v.value])),
        )
      : [];
  };

  phase = "private attachment integrity";
  let verifiedDocuments = 0;
  const bindings = backup.settings.bindings || [];
  const kv = bindings.find((b) => b.name === "DOCUMENTS_KV");
  for (const document of decodeRows(backup, "documents").filter(
    (d) => d.storage_state === "ready",
  )) {
    const pinned = decodeRows(backup, "campaign_attachment_pins").some(
      (p) => p.document_id === document.id,
    );
    if (
      !pinned &&
      Math.max(document.expires_at || 0, document.retained_until || 0) <=
        Date.now()
    )
      continue;
    assert.equal(
      document.storage_backend,
      "kv",
      "Legacy document requires separate read verification",
    );
    assert(kv?.namespace_id, "Private KV binding missing");
    const response = await fetch(
      "https://api.cloudflare.com/client/v4" +
        base +
        "/storage/kv/namespaces/" +
        kv.namespace_id +
        "/values/" +
        encodeURIComponent(document.object_key),
      { headers: { Authorization: "Bearer " + token } },
    );
    assert(response.ok, "Private attachment is unavailable");
    const bytes = Buffer.from(await response.arrayBuffer());
    assert.equal(
      bytes.length,
      document.size,
      "Private attachment size mismatch",
    );
    assert.equal(
      crypto.createHash("sha256").update(bytes).digest("hex"),
      document.checksum,
      "Private attachment checksum mismatch",
    );
    verifiedDocuments++;
  }
  phase = "immutable campaign comparison";
  const previousFile = process.argv[2];
  let comparison = null;
  if (previousFile) {
    assert(
      path.resolve(previousFile).startsWith(path.resolve(directory) + path.sep),
      "Baseline must be in private Wrangler state",
    );
    const before = JSON.parse(
      protect(fs.readFileSync(previousFile), true).toString(),
    );
    if (process.argv.includes("--campaign-lifecycle")) {
      const names=new Set(['campaign_archives','campaign_archives_owner','campaign_workspace_deletions','campaign_deletions_owner','campaign_deletion_documents','notifications_campaign_entity','message_attachments_document']);
      assert.equal(digest(before.schema),digest(backup.schema.filter(item=>!names.has(item.name))),"Existing production schema changed");
      const scratch=new DatabaseSync(":memory:");
      scratch.exec("CREATE TABLE notifications(user_id TEXT,entity_id TEXT); CREATE TABLE message_attachments(document_id TEXT)");
      scratch.exec(fs.readFileSync("apps/api/migrations/0016_campaign_archives.sql","utf8"));
      const expected=scratch.prepare("SELECT type,name,tbl_name,sql FROM sqlite_master WHERE name IN ('campaign_archives','campaign_archives_owner','campaign_workspace_deletions','campaign_deletions_owner','campaign_deletion_documents','notifications_campaign_entity','message_attachments_document') ORDER BY type,name").all();scratch.close();
      assert.equal(digest(backup.schema.filter(item=>names.has(item.name))),digest(expected),"Unexpected lifecycle schema");
    } else if (process.argv.includes("--google-activation")) {
      const names = new Set([
        "google_student_identities",
        "google_identity_immutable",
      ]);
      const existing = backup.schema.filter((item) => !names.has(item.name));
      assert.equal(
        digest(before.schema),
        digest(existing),
        "Existing production schema changed",
      );
      const scratch = new DatabaseSync(":memory:");
      scratch.exec("CREATE TABLE users(id TEXT PRIMARY KEY)");
      scratch.exec(
        fs.readFileSync(
          "apps/api/migrations/0014_google_student_activation.sql",
          "utf8",
        ),
      );
      const expected = scratch
        .prepare(
          "SELECT type,name,tbl_name,sql FROM sqlite_master WHERE name IN ('google_student_identities','google_identity_immutable') ORDER BY type,name",
        )
        .all();
      scratch.close();
      assert.equal(
        digest(backup.schema.filter((item) => names.has(item.name))),
        digest(expected),
        "Unexpected Google activation schema",
      );
    } else {
      assert.equal(
        digest(before.schema),
        digest(backup.schema),
        "Production schema changed",
      );
    }
    assert.equal(
      digest(before.schedules),
      digest(backup.schedules),
      "Production cron changed",
    );
    const bindings = (value) =>
      (value.bindings || []).toSorted((a, b) => a.name.localeCompare(b.name));
    assert.equal(
      digest(bindings(before.settings)),
      digest(bindings(backup.settings)),
      "Worker bindings changed",
    );
    let verifiedStudentActivations = 0;
    const specs = {
      users: ["id", "email", "password", "email_verified_at", "legacy_access"],
      profiles: ["user_id", "paused", "stopped"],
      outreach_settings: null,
      campaign_approvals: null,
      message_authorizations: null,
      followup_approvals: null,
      message_attachments: null,
      transports: ["message_id", "user_id", "connection_id", "snapshot"],
      followup_steps: [
        "root_id",
        "step",
        "child_id",
        "subject",
        "body",
        "delay_value",
        "delay_unit",
        "relative_to",
        "authorized_at",
      ],
      messages: [
        "id",
        "user_id",
        "professor_id",
        "subject",
        "body",
        "mode",
        "authorized",
        "scheduled_at",
        "timezone",
        "approved",
        "parent_id",
        "live_ready",
      ],
      documents: [
        "id",
        "user_id",
        "object_key",
        "checksum",
        "size",
        "name",
        "content_type",
        "storage_backend",
      ],
      connections: [
        "id",
        "user_id",
        "provider",
        "address",
        "subject",
        "scopes",
      ],
    };
    for (const [table, fields] of Object.entries(specs)) {
      const original = decodeRows(before, table),
        current = decodeRows(backup, table);
      const pk = columns[tables.findIndex((t) => t.name === table)]
        .filter((c) => c.pk)
        .map((c) => c.name);
      const identity = (row) => JSON.stringify(pk.map((k) => row[k]));
      const present = new Map(current.map((row) => [identity(row), row]));
      for (const old of original) {
        const row = present.get(identity(old));
        assert(row, "Existing protected row missing in " + table);
        let selected = fields || Object.keys(old);
        if (
          table === "users" &&
          old.email_verified_at == null &&
          old.legacy_access === 0 &&
          row.email_verified_at != null &&
          process.argv.includes("--google-activation")
        ) {
          const binding = decodeRows(backup, "google_student_identities").find(
            (g) =>
              g.user_id === old.id &&
              g.email === old.email.toLowerCase() &&
              g.verified_at === row.email_verified_at,
          );
          assert(
            binding,
            "A changed student verification state requires its matching immutable Google identity record",
          );
          assert(
            decodeRows(backup, "audit").some(
              (a) =>
                a.user_id === old.id && a.action === "account.google_activated",
            ),
            "Student activation audit record is missing",
          );
          selected = selected.filter((key) => key !== "email_verified_at");
          verifiedStudentActivations++;
        }
        assert.equal(
          digest(Object.fromEntries(selected.map((k) => [k, old[k]]))),
          digest(Object.fromEntries(selected.map((k) => [k, row[k]]))),
          "Immutable campaign/account data changed in " + table,
        );
      }
    }
    const original = decodeRows(before, "messages"),
      current = decodeRows(backup, "messages");
    const transitions = original.flatMap((old) => {
      const row = current.find((r) => r.id === old.id);
      return row.status === old.status
        ? []
        : [{ idHash: digest(old.id), from: old.status, to: row.status }];
    });
    comparison = {
      verifiedStudentActivations,
      immutableRecordsMatch: true,
      cronAndBindingsMatch: true,
      messageTransitions: transitions,
      manualReviewNeeded: transitions.length > 0,
    };
  }
  const heartbeat = decodeRows(backup, "scheduler_health")[0];
  const schedulerHealthy =
    !!heartbeat &&
    !heartbeat.failure &&
    Date.now() - heartbeat.completed_at < 300000;
  assert(
    schedulerHealthy,
    "Scheduler heartbeat is stale or failed; deployment blocked",
  );
  const evidence = {
    schedulerHealthy,
    outreachCounts: {
      approvedCampaigns: decodeRows(backup, "campaign_approvals").length,
      pendingInitials: decodeRows(backup, "messages").filter(
        (m) => m.status === "pending" && !m.parent_id,
      ).length,
      pendingFollowupMessages: decodeRows(backup, "messages").filter(
        (m) => m.status === "pending" && !!m.parent_id,
      ).length,
      unqueuedFollowupSteps: decodeRows(backup, "followup_steps").filter(
        (s) => !s.queued && !s.cancel_reason,
      ).length,
    },
    verifiedDocuments,
    schedulerHealth: decodeRows(backup, "scheduler_health").map((row) => ({
      started_at: row.started_at,
      completed_at: row.completed_at,
      failure: row.failure,
    })),
    comparison,
    backupFile: filename,
    sha256: digest(plain.toString()),
    encryptedSha256: digest(encrypted.toString("base64")),
    capturedAt: start,
    counts,
    configuration: safeVars,
    secretNames: (settings.bindings || [])
      .filter((b) => b.type === "secret_text")
      .map((b) => b.name),
    cronHash: digest(schedules),
    restoredInMemory: true,
  };
  fs.writeFileSync(
    directory + "/onboarding-safety-summary.json",
    JSON.stringify(evidence, null, 2),
  );
  console.log(
    JSON.stringify({
      schedulerHealthy,
      outreachCounts: evidence.outreachCounts,
      verifiedDocuments,
      backupVerified: true,
      localRestoreVerified: true,
      encryptedBackup: filename,
      comparison,
      counts,
      configuration: safeVars,
      brevoKeyPresent: evidence.secretNames.includes("BREVO_API_KEY"),
      cronFingerprint: evidence.cronHash,
    }),
  );
}
main().catch(() => {
  console.error("Failed phase: " + phase);
  console.error(
    "Production capture or local restore verification failed. No production mutation was requested. Do not perform further deployment without a successful safety check.",
  );
  process.exitCode = 1;
});
