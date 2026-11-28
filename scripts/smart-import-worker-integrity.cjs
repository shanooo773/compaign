// Read-only check: frontend releases must leave the Worker version and bytes intact.
const fs = require("node:fs"),
  path = require("node:path"),
  crypto = require("node:crypto"),
  assert = require("node:assert/strict");
(async () => {
  const cfg = JSON.parse(
    fs.readFileSync("apps/api/.wrangler/google-activation-config.json"),
  );
  const token = /oauth_token\s*=\s*"([^"\r\n]+)"/.exec(
    fs.readFileSync(
      path.join(
        process.env.APPDATA,
        "xdg.config/.wrangler/config/default.toml",
      ),
      "utf8",
    ),
  )?.[1];
  assert(token, "Cloudflare authentication unavailable");
  const base =
    "https://api.cloudflare.com/client/v4/accounts/" +
    cfg.account_id +
    "/workers/scripts/" +
    cfg.name;
  const headers = { Authorization: "Bearer " + token };
  const r = await fetch(base, { headers, signal: AbortSignal.timeout(20000) });
  assert(r.ok, "Worker read failed");
  const raw = await r.text(),
    boundary = raw.slice(0, raw.indexOf("\r\n"));
  let module;
  for (const part of raw.split(boundary)) {
    const split = part.indexOf("\r\n\r\n");
    if (split >= 0 && /name="index\.js"/.test(part.slice(0, split)))
      module = part.slice(split + 4).replace(/\r\n$/, "");
  }
  assert(module, "Worker module unavailable");
  const d = await (
    await fetch(base + "/deployments", {
      headers,
      signal: AbortSignal.timeout(20000),
    })
  ).json();
  assert(d.success, "Deployment read failed");
  const evidence = {
    checkedAt: new Date().toISOString(),
    moduleSHA256: crypto.createHash("sha256").update(module).digest("hex"),
    activeVersions: d.result.deployments[0].versions,
  };
  const before = JSON.parse(
    fs.readFileSync("apps/api/.wrangler/smart-import-worker-before.json"),
  );
  assert.equal(
    evidence.moduleSHA256,
    before.moduleSHA256,
    "Worker bytes changed",
  );
  assert.deepEqual(
    evidence.activeVersions,
    before.activeVersions,
    "Worker traffic changed",
  );
  fs.writeFileSync(
    "apps/api/.wrangler/smart-import-worker-after.json",
    JSON.stringify({ ...evidence, unchanged: true }, null, 2),
  );
  console.log(JSON.stringify({ ...evidence, unchanged: true }));
})().catch(() => {
  console.error(
    "Read-only Worker integrity check failed; do not expose credentials while investigating.",
  );
  process.exitCode = 1;
});
