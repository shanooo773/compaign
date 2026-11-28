const fs = require("node:fs"),
  path = require("node:path"),
  { spawnSync } = require("node:child_process"),
  crypto = require("node:crypto");
function decrypt(file) {
  const code =
    "Add-Type -AssemblyName System.Security; $b=[Convert]::FromBase64String([Console]::In.ReadToEnd()); [Console]::Out.Write([Convert]::ToBase64String([Security.Cryptography.ProtectedData]::Unprotect($b,$null,[Security.Cryptography.DataProtectionScope]::CurrentUser)))";
  const r = spawnSync(
    "powershell.exe",
    ["-NoProfile", "-NonInteractive", "-Command", code],
    {
      input: fs.readFileSync(file).toString("base64"),
      encoding: "utf8",
      windowsHide: true,
      maxBuffer: 64 * 1024 * 1024,
    },
  );
  if (r.status !== 0) throw Error("Private baseline decryption failed");
  return JSON.parse(Buffer.from(r.stdout, "base64").toString());
}
(async () => {
  const summary = JSON.parse(
    fs.readFileSync(
      "apps/api/.wrangler/google-activation-baseline-summary.json",
      "utf8",
    ),
  );
  const snapshot = decrypt(summary.backupFile),
    settings = snapshot.settings;
  const cfg = JSON.parse(
    fs.readFileSync("apps/api/.wrangler/pdf-release-config.json", "utf8"),
  );
  cfg.vars = Object.fromEntries(
    settings.bindings
      .filter((b) => b.type === "plain_text")
      .map((b) => [b.name, b.text]),
  );
  cfg.compatibility_date =
    settings.compatibility_date || cfg.compatibility_date;
  cfg.compatibility_flags = settings.compatibility_flags || [];
  const schedules = Array.isArray(snapshot.schedules)
    ? snapshot.schedules
    : snapshot.schedules.schedules;
  cfg.triggers = { crons: schedules.map((s) => s.cron) };
  cfg.main = "../src/index.ts";
  cfg.d1_databases[0].migrations_dir = "../migrations";
  fs.writeFileSync(
    "apps/api/.wrangler/google-activation-config.json",
    JSON.stringify(cfg, null, 2),
  );
  const root = "apps/api/.wrangler/google-activation-original-tree";
  fs.mkdirSync(root + "/apps/api", { recursive: true });
  fs.cpSync("apps/api/src", root + "/apps/api/src", { recursive: true });
  fs.cpSync("shared", root + "/shared", { recursive: true });
  const originals = "apps/api/.wrangler/google-activation-source-baseline";
  for (const file of fs.readdirSync(originals).filter((x) => x.endsWith(".ts")))
    fs.copyFileSync(originals + "/" + file, root + "/apps/api/src/" + file);
  const oldCfg = {
    ...cfg,
    main: path.resolve(root + "/apps/api/src/index.ts"),
  };
  fs.writeFileSync(
    "apps/api/.wrangler/google-activation-original-config.json",
    JSON.stringify(oldCfg, null, 2),
  );
  const login = fs.readFileSync(
      path.join(
        process.env.APPDATA,
        "xdg.config/.wrangler/config/default.toml",
      ),
      "utf8",
    ),
    token = /oauth_token\s*=\s*"([^"\r\n]+)"/.exec(login)?.[1];
  const response = await fetch(
    "https://api.cloudflare.com/client/v4/accounts/" +
      cfg.account_id +
      "/workers/scripts/" +
      cfg.name,
    {
      headers: { Authorization: "Bearer " + token },
      signal: AbortSignal.timeout(20000),
    },
  );
  if (!response.ok) throw Error("Read-only Worker source inspection failed");
  const raw = await response.text(),
    boundary = raw.slice(0, raw.indexOf("\r\n"));
  let deployed;
  for (const part of raw.split(boundary)) {
    const split = part.indexOf("\r\n\r\n");
    if (split >= 0 && /name="index\.js"/.test(part.slice(0, split)))
      deployed = part.slice(split + 4).replace(/\r\n$/, "");
  }
  if (!deployed) throw Error("Worker module could not be extracted");
  fs.writeFileSync(
    "apps/api/.wrangler/google-activation-deployed-before.js",
    deployed,
  );
  console.log(
    JSON.stringify({
      freshConfigurationCaptured: true,
      baselineWorkerSHA256: crypto
        .createHash("sha256")
        .update(deployed)
        .digest("hex"),
      cronCount: cfg.triggers.crons.length,
    }),
  );
})().catch(() => {
  console.error(
    "Release preparation failed; no production mutation requested.",
  );
  process.exitCode = 1;
});
