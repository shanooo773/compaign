const fs = require("node:fs"),
  path = require("node:path"),
  crypto = require("node:crypto"),
  assert = require("node:assert/strict"),
  { spawnSync } = require("node:child_process");
const cfg = JSON.parse(
  fs.readFileSync("apps/api/.wrangler/google-activation-config.json", "utf8"),
);
const login = fs.readFileSync(
    path.join(process.env.APPDATA, "xdg.config/.wrangler/config/default.toml"),
    "utf8",
  ),
  token = /oauth_token\s*=\s*"([^"\r\n]+)"/.exec(login)?.[1];
const root = "/accounts/" + cfg.account_id,
  worker = root + "/workers/scripts/" + cfg.name,
  db = root + "/d1/database/" + cfg.d1_databases[0].database_id;
async function api(route, body) {
  const response = await fetch("https://api.cloudflare.com/client/v4" + route, {
    method: body ? "POST" : "GET",
    signal: AbortSignal.timeout(30000),
    headers: {
      Authorization: "Bearer " + token,
      "Content-Type": "application/json",
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const result = await response.json();
  assert(
    response.ok && result.success,
    "Cloudflare operation failed, status " + response.status,
  );
  return result.result;
}
async function originalWorkerGuard() {
  const response = await fetch(
    "https://api.cloudflare.com/client/v4" + worker,
    {
      headers: { Authorization: "Bearer " + token },
      signal: AbortSignal.timeout(20000),
    },
  );
  assert(response.ok, "Worker baseline could not be checked");
  const raw = await response.text(),
    boundary = raw.slice(0, raw.indexOf("\r\n"));
  let module;
  for (const part of raw.split(boundary)) {
    const split = part.indexOf("\r\n\r\n");
    if (split >= 0 && /name="index\.js"/.test(part.slice(0, split)))
      module = part.slice(split + 4).replace(/\r\n$/, "");
  }
  assert.equal(
    crypto
      .createHash("sha256")
      .update(module || "")
      .digest("hex"),
    crypto
      .createHash("sha256")
      .update(
        fs.readFileSync(
          "apps/api/.wrangler/google-activation-deployed-before.js",
        ),
      )
      .digest("hex"),
    "Latest uploaded Worker differs from the starting baseline",
  );
}
async function main() {
  assert(
    JSON.parse(
      fs.readFileSync(
        "apps/api/.wrangler/google-activation-source-comparison.json",
        "utf8",
      ),
    ).startingSourceMatchesProduction,
    "Starting source differs from production",
  );
  const mode = process.argv[2];
  if (mode === "migrate") {
    await originalWorkerGuard();
    const summary = JSON.parse(
      fs.readFileSync(
        "apps/api/.wrangler/onboarding-safety-summary.json",
        "utf8",
      ),
    );
    assert(
      summary.comparison?.immutableRecordsMatch && summary.schedulerHealthy,
      "Recent integrity check is required",
    );
    assert(
      Date.now() - Date.parse(summary.capturedAt) < 600000,
      "Refresh integrity check before applying additive schema",
    );
    const before = await api(db + "/query", {
      sql: "SELECT name FROM d1_migrations ORDER BY id; SELECT name FROM sqlite_master WHERE name='google_student_identities'",
    });
    assert.equal(before[0].results.length, 13, "Unexpected migration history");
    assert.equal(
      before[1].results.length,
      0,
      "Activation table already exists; inspect before retry",
    );
    const migration = fs.readFileSync(
      "apps/api/migrations/0014_google_student_activation.sql",
      "utf8",
    );
    assert(
      !/\b(DROP|ALTER|UPDATE|DELETE|REPLACE)\b/i.test(
        migration
          .replace(/--[^\n]*/g, "")
          .replace(/BEFORE UPDATE OF/g, "BEFORE EVENT OF")
          .replace(/ON DELETE CASCADE/g, "ON CASCADE"),
      ),
      "Only the reviewed additive table/trigger are permitted",
    );
    await api(db + "/query", {
      sql:
        migration +
        "\nINSERT INTO d1_migrations(name) VALUES('0014_google_student_activation.sql');",
    });
    console.log(
      "Applied only additive 0014: empty identity table, immutable-binding trigger and migration receipt. No existing records changed.",
    );
  } else if (mode === "upload") {
    await originalWorkerGuard();
    const r = spawnSync(
      process.execPath,
      [
        "node_modules/wrangler/bin/wrangler.js",
        "versions",
        "upload",
        "--config",
        "apps/api/.wrangler/google-activation-config.json",
        "--outdir",
        "google-activation-build",
        "--keep-vars",
        "--tag",
        "google-activation",
        "--message",
        "Secure matching Google identity activation; preserve campaigns and cron",
      ],
      {
        encoding: "utf8",
        windowsHide: true,
        timeout: 180000,
        maxBuffer: 8 * 1024 * 1024,
      },
    );
    assert.equal(
      r.status,
      0,
      "Worker version upload failed; output withheld to avoid exposing private bindings",
    );
    const output = r.stdout + "\n" + r.stderr;
    const version =
      /Worker Version ID:\s*([0-9a-f-]{36})/i.exec(output)?.[1] ||
      /Version ID:\s*([0-9a-f-]{36})/i.exec(output)?.[1];
    assert(
      version,
      "Version uploaded but ID could not be parsed; inspect private Cloudflare metadata before retry",
    );
    fs.writeFileSync(
      "apps/api/.wrangler/google-activation-upload.json",
      JSON.stringify({
        version,
        uploadedAt: new Date().toISOString(),
        bundleSHA256: crypto
          .createHash("sha256")
          .update(
            fs.readFileSync(
              "apps/api/.wrangler/google-activation-build/index.js",
            ),
          )
          .digest("hex"),
      }),
    );
    console.log(
      JSON.stringify({
        versionUploaded: version,
        productionTrafficChanged: false,
      }),
    );
  } else if (mode === "deploy") {
    const summary = JSON.parse(
      fs.readFileSync(
        "apps/api/.wrangler/onboarding-safety-summary.json",
        "utf8",
      ),
    );
    assert(
      summary.comparison?.immutableRecordsMatch && summary.schedulerHealthy,
      "Verified integrity and scheduler health required",
    );
    if (summary.comparison?.manualReviewNeeded) {
      const review = JSON.parse(
        fs.readFileSync(
          "apps/api/.wrangler/google-activation-natural-transitions.json",
          "utf8",
        ),
      );
      assert.equal(
        review.latestBackup,
        summary.backupFile,
        "Natural transitions must be reviewed against the latest backup",
      );
      assert(
        review.noAdditionalDeliveries,
        "Unexpected deliveries require review",
      );
    }
    const expected = JSON.parse(
      fs.readFileSync(
        "apps/api/.wrangler/google-activation-active-deployments.json",
        "utf8",
      ),
    ).deployments[0];
    const baseline = JSON.parse(
      fs.readFileSync(
        "apps/api/.wrangler/google-activation-baseline-summary.json",
        "utf8",
      ),
    );
    assert(
      Date.parse(expected.created_on) < Date.parse(baseline.capturedAt),
      "An external deployment occurred after baseline capture",
    );
    const active = (await api(worker + "/deployments")).deployments[0];
    assert.deepEqual(
      active.versions,
      expected.versions,
      "Active production version changed during release",
    );
    assert.equal(
      active.id,
      expected.id,
      "Active deployment changed during release",
    );
    const { version } = JSON.parse(
      fs.readFileSync(
        "apps/api/.wrangler/google-activation-upload.json",
        "utf8",
      ),
    );
    const checked = JSON.parse(
      fs.readFileSync(
        "apps/api/.wrangler/google-activation-version-check.json",
        "utf8",
      ),
    );
    assert.equal(checked.version, version);
    assert(checked.bindingsMatch, "Version binding comparison is required");
    const result = await api(worker + "/deployments", {
      strategy: "percentage",
      versions: [{ version_id: version, percentage: 100 }],
      annotations: {
        "workers/message":
          "Secure Google student activation, isolated from existing campaign state",
      },
    });
    fs.writeFileSync(
      "apps/api/.wrangler/google-activation-deployment.json",
      JSON.stringify({ version, result, deployedAt: new Date().toISOString() }),
    );
    console.log(
      JSON.stringify({
        workerVersionDeployed: version,
        cronEndpointCalled: false,
        existingCampaignMutations: false,
      }),
    );
  } else throw Error("Choose migrate, upload or deploy explicitly");
}
main().catch((e) => {
  console.error(e.message);
  process.exitCode = 1;
});
