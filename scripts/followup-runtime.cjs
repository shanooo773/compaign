const fs = require("node:fs");
const assert = require("node:assert/strict");
const { build } = require("esbuild");
const { Miniflare, convertV4MiniflareOptions } = require(
  require.resolve("miniflare", {
    paths: [require.resolve("wrangler/package.json")],
  }),
);

async function main() {
  const entry = `import worker from './apps/api/src/index';
    import {encrypt} from './apps/api/src/oauth';
    import {queueSequence} from './apps/api/src/followup-sequence';
    import {runLiveJobs} from './apps/api/src/automation';
    import {cleanDocuments} from './apps/api/src/storage';
    export default {async fetch(req,env) {
      const route=new URL(req.url).pathname;
      if(route.startsWith('/api/'))return worker.fetch(req,env);
      if(route==='/tokens')return Response.json({tokens:await encrypt(env,'runtime-user:gmail:tokens:v1',{access_token:'synthetic',refresh_token:'synthetic',expires_in:3600})});
      if(route==='/queue')await queueSequence(env);
      if(route==='/send')await runLiveJobs(env);
      if(route==='/clean')await cleanDocuments(env);
      if(route==='/cron')await worker.scheduled({cron:'* * * * *',scheduledTime:Date.now()},env);
      return Response.json({ok:true});
    }};`;
  const bundled = await build({
    stdin: { contents: entry, resolveDir: process.cwd() },
    bundle: true,
    write: false,
    format: "esm",
    platform: "browser",
  });
  let submissions = 0;
  const captured = [];
  const mf = new Miniflare(
    convertV4MiniflareOptions({
      modules: true,
      script: bundled.outputFiles[0].text,
      compatibilityDate: "2026-10-01",
      d1Databases: ["DB"],
      kvNamespaces: ["DOCUMENTS_KV"],
      bindings: {
        APP_ORIGIN: "https://synthetic.invalid",
        OAUTH_ENABLED: "true",
        LIVE_EMAIL_ENABLED: "true",
        MOCK_DELIVERY_ENABLED: "false",
        LIVE_TEST_RECIPIENTS: "controlled@example.invalid",
        TOKEN_ENCRYPTION_KEY: Buffer.alloc(32, 7).toString("base64"),
        GMAIL_CLIENT_ID: "synthetic",
        GMAIL_CLIENT_SECRET: "synthetic",
      },
      outboundService: async (request) => {
        if (request.url.includes("/messages/send")) {
          submissions++;
          const body = await request.json();
          if (body.threadId) assert.equal(body.threadId, "runtime-thread");
          const mime = Buffer.from(body.raw, "base64url").toString();
          captured.push(mime);
          if (body.threadId)
            assert.match(
              mime,
              /In-Reply-To: <runtime-original@ms-professor-agent.invalid>/,
            );
          return Response.json({
            id:
              submissions === 1
                ? "runtime-followup"
                : "runtime-followup-" + submissions,
            threadId: "runtime-thread",
          });
        }
        if (request.url.includes("/threads/"))
          return Response.json({ messages: [] });
        if (request.url.endsWith("/profile"))
          return Response.json({ emailAddress: "sender@example.invalid" });
        throw new Error("Unexpected outbound request blocked");
      },
    }),
  );
  try {
    const db = await mf.getD1Database("DB");
    for (const file of fs
      .readdirSync("apps/api/migrations")
      .filter((file) => file.endsWith(".sql"))
      .sort()) {
      const sql = fs
        .readFileSync("apps/api/migrations/" + file, "utf8")
        .replace(/--[^\n]*/g, "")
        .replace(/\r?\n/g, " ");
      await db.exec(sql);
    }
    const tokens = await (
      await mf.dispatchFetch("http://localhost/tokens")
    ).json();
    const now = Date.now();
    const original = {
      recipient: "controlled@example.invalid",
      subject: "Runtime sequence",
      body: "Synthetic original",
      attachments: [],
      key: "runtime-original@ms-professor-agent.invalid",
    };
    const step = {
      subject: original.subject,
      body: "Exact runtime follow-up",
      delay_value: 5,
      delay_unit: "minutes",
      relative_to: "original",
    };
    await db.batch([
      db.prepare(
        "INSERT INTO users(id,email,password) VALUES('runtime-user','owner@example.invalid','synthetic')",
      ),
      db.prepare("INSERT INTO profiles(user_id) VALUES('runtime-user')"),
      db.prepare(
        "INSERT INTO professors(id,user_id,name,email) VALUES('runtime-professor','runtime-user','Synthetic','controlled@example.invalid')",
      ),
      db
        .prepare(
          "INSERT INTO connections(id,user_id,provider,address,subject,scopes,tokens,expires_at) VALUES('runtime-connection','runtime-user','gmail','sender@example.invalid','runtime-mailbox','gmail.send gmail.readonly',?,?)",
        )
        .bind(tokens.tokens, now + 3600000),
      db
        .prepare(
          "INSERT INTO messages(id,user_id,professor_id,subject,body,mode,authorized,approved,status,scheduled_at,timezone,sent_at,live_ready) VALUES('runtime-root','runtime-user','runtime-professor',?,?,'manual',1,1,'sent',?,'Asia/Karachi',?,1)",
        )
        .bind(
          original.subject,
          original.body,
          new Date(now - 600000).toISOString(),
          new Date(now - 600000).toISOString(),
        ),
      db
        .prepare(
          "INSERT INTO transports(message_id,user_id,connection_id,snapshot,state,provider_id,thread_id) VALUES('runtime-root','runtime-user','runtime-connection',?,'confirmed','runtime-original','runtime-thread')",
        )
        .bind(JSON.stringify(original)),
      db
        .prepare(
          "INSERT INTO message_authorizations(message_id,user_id,campaign_id,snapshot,authorized_at,followup_authorized) VALUES('runtime-root','runtime-user','runtime-campaign',?,?,1)",
        )
        .bind(
          JSON.stringify({ initial: original, followup: { steps: [step] } }),
          now,
        ),
      db
        .prepare(
          "INSERT INTO followup_steps(root_id,step,child_id,subject,body,delay_value,delay_unit,relative_to,authorized_at) VALUES('runtime-root',1,'runtime-child',?,?,5,'minutes','original',?)",
        )
        .bind(step.subject, step.body, now),
    ]);
    for (const route of ["queue", "queue", "send", "send", "cron"]) {
      const response = await mf.dispatchFetch("http://localhost/" + route);
      assert.equal(response.status, 200, await response.text());
    }
    assert.equal(submissions, 1);
    assert.equal(
      (
        await db
          .prepare(
            "SELECT state FROM transports WHERE message_id='runtime-child'",
          )
          .first()
      ).state,
      "confirmed",
    );
    assert.equal(
      (
        await db
          .prepare(
            "SELECT count(*) n FROM deliveries WHERE message_id='runtime-child'",
          )
          .first()
      ).n,
      1,
    );
    const health = await db
      .prepare("SELECT * FROM scheduler_health WHERE id=1")
      .first();
    assert(health.completed_at && !health.failure);
    const session = "runtime-import-session";
    await db
      .prepare(
        "INSERT INTO sessions(token,user_id,expires_at) VALUES(?,'runtime-user',?)",
      )
      .bind(
        require("node:crypto")
          .createHash("sha256")
          .update(session)
          .digest("hex"),
        Date.now() + 3600000,
      )
      .run();
    await db
      .prepare("UPDATE users SET email_verified_at=? WHERE id='runtime-user'")
      .bind(Date.now())
      .run();
    const rows = [
      {
        name: "Repeat recipient",
        email: "repeat@example.invalid",
        subject: "Same reviewed content",
        body: "Synthetic only",
        scheduled_at: "2099-01-01T00:00:00Z",
        timezone: "Asia/Karachi",
      },
    ];
    const firstImport = require("node:crypto").randomUUID();
    const request = async (route, body) => {
      const response = await mf.dispatchFetch(
        "https://synthetic.invalid/api" + route,
        {
          method: "POST",
          headers: {
            Origin: "https://synthetic.invalid",
            Cookie: "session=" + session,
            "Content-Type": "application/json",
          },
          body: JSON.stringify(body),
        },
      );
      assert.equal(response.status, 200, await response.clone().text());
      return response.json();
    };
    const first = await request("/imports/drafts", {
      import_id: firstImport,
      rows,
    });
    await request("/messages/" + first.drafts[0].id + "/cancel", {});
    const retry = await request("/imports/drafts", {
      import_id: firstImport,
      rows,
    });
    assert.equal(retry.created, 0);
    assert.equal(retry.drafts[0].status, "cancelled");
    const repeated = await request("/imports/drafts", {
      import_id: require("node:crypto").randomUUID(),
      rows,
    });
    assert.equal(repeated.created, 1);
    assert.notEqual(repeated.drafts[0].id, first.drafts[0].id);
    assert.equal(submissions, 1);

    const docs = [];
    for (const [name, content] of [
      ["cv.txt", "Synthetic CV attachment"],
      ["transcript.txt", "Synthetic transcript"],
    ]) {
      const form = new FormData();
      form.set("file", new File([content], name, { type: "text/plain" }));
      const serialized = new Request(
        "https://synthetic.invalid/api/documents",
        { method: "POST", body: form },
      );
      const uploaded = await mf.dispatchFetch(serialized.url, {
        method: "POST",
        headers: {
          Origin: "https://synthetic.invalid",
          Cookie: "session=" + session,
          "Content-Type": serialized.headers.get("Content-Type"),
        },
        body: await serialized.arrayBuffer(),
      });
      assert.equal(uploaded.status, 200, await uploaded.clone().text());
      docs.push((await uploaded.json()).id);
    }
    const connection = require("node:crypto").randomUUID();
    await db
      .prepare(
        "INSERT INTO connections(id,user_id,provider,address,subject,scopes,tokens,expires_at) VALUES(?,'runtime-user','gmail','attachment-sender@example.invalid','attachment-mailbox','gmail.send gmail.readonly',?,?)",
      )
      .bind(connection, tokens.tokens, Date.now() + 3600000)
      .run();
    await db
      .prepare(
        "INSERT INTO mailbox_checks(connection_id,checked_at,status,detail) VALUES(?,?,'ready','Isolated attachment test')",
      )
      .bind(connection, Date.now())
      .run();
    const imported = await request("/imports/drafts", {
      import_id: require("node:crypto").randomUUID(),
      rows: [
        {
          name: "Attachment professor",
          email: "controlled@example.invalid",
          subject: "Approved attachment inquiry",
          body: "Exact content",
          scheduled_at: "2000-01-01T00:00:00Z",
          timezone: "Asia/Karachi",
          follow_up_sequence: JSON.stringify(
            Array.from({ length: 10 }, (_, n) => ({
              subject: "Step " + (n + 1),
              body: "Exact step content",
              delay_value: 6,
              delay_unit: "days",
              relative_to: "previous",
            })),
          ),
        },
      ],
    });
    const approvalBody = {
      ids: [imported.drafts[0].id],
      sending_account_id: connection,
      authorize_followups: true,
      attachment_selection: { initial: docs, followups: { 10: [docs[0]] } },
    };
    const dry = await request("/messages/approve", {
      ...approvalBody,
      dry_run: true,
    });
    assert.equal(dry.would_authorize_followups, 10);
    assert.equal(
      (
        await db
          .prepare("SELECT count(*) n FROM campaign_attachment_pins")
          .first()
      ).n,
      0,
    );
    const approved = await request("/messages/approve", approvalBody);
    assert.equal(approved.authorized_followups, 10);
    assert.equal(
      (
        await db
          .prepare("SELECT count(*) n FROM campaign_attachment_pins")
          .first()
      ).n,
      2,
    );
    assert(
      (
        await db
          .prepare(
            "SELECT MIN(retained_until) expiry FROM campaign_attachment_pins",
          )
          .first()
      ).expiry >
        Date.now() + 66 * 86400000,
    );
    await db.exec("DELETE FROM usage_counters WHERE scope LIKE 'send:%'");
    const sent = await mf.dispatchFetch("http://localhost/send");
    assert.equal(sent.status, 200, await sent.text());
    assert.equal(submissions, 2);
    assert.match(captured.at(-1), /filename\*=UTF-8''cv.txt/);
    assert.match(captured.at(-1), /filename\*=UTF-8''transcript.txt/);
    await request("/campaigns/" + approved.campaign_id + "/cancel", {});
    await mf.dispatchFetch("http://localhost/clean");
    assert.equal(
      (
        await db
          .prepare("SELECT count(*) n FROM campaign_attachment_pins")
          .first()
      ).n,
      0,
    );
    console.log(
      "PASS native Workers/D1/KV: 60-day ten-step campaign, two private uploaded documents, dry-run without pins, single approval with exact attachment plan, retained private bytes, actual MIME file parts, campaign cancellation and pin cleanup. Provider traffic intercepted.",
    );

    console.log(
      "PASS native Workers runtime and D1: all migrations, new import after cancellation, idempotent import retries, exact step approval, 5-minute due time, Gmail threading, duplicate queue/send prevention and scheduled handler health. All provider traffic intercepted; no real mail.",
    );
  } finally {
    await mf.dispose();
  }
}
main().catch((error) => {
  console.error(error.stack);
  process.exitCode = 1;
});
