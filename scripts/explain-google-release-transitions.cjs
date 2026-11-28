const fs = require("node:fs"),
  crypto = require("node:crypto"),
  assert = require("node:assert/strict"),
  { spawnSync } = require("node:child_process");
const summary = JSON.parse(
    fs.readFileSync(
      "apps/api/.wrangler/onboarding-safety-summary.json",
      "utf8",
    ),
  ),
  original = JSON.parse(
    fs.readFileSync(
      "apps/api/.wrangler/google-activation-baseline-summary.json",
      "utf8",
    ),
  );
function open(file) {
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
  assert.equal(r.status, 0);
  return JSON.parse(Buffer.from(r.stdout, "base64").toString());
}
const before = open(original.backupFile),
  after = open(summary.backupFile);
const rows = (s, name) =>
  JSON.parse(s.data.find((t) => t.name === name)?.data || "[]").map((row) =>
    Object.fromEntries(
      Object.entries(row).map(([key, value]) => [key, value.value]),
    ),
  );
const fingerprint = (row) =>
  crypto.createHash("sha256").update(JSON.stringify(row)).digest("hex");
const oldEvents = new Set(rows(before, "mailbox_events").map(fingerprint)),
  added = rows(after, "mailbox_events").filter(
    (e) => !oldEvents.has(fingerprint(e)),
  ),
  replied = new Set();
for (const message of rows(before, "messages")) {
  const now = rows(after, "messages").find((m) => m.id === message.id);
  if (now.status === message.status) continue;
  assert.equal(message.status, "sent");
  assert.equal(now.status, "replied");
  assert(
    added.some((e) => e.message_id === message.id && e.kind === "reply"),
    "Reply status requires a new tracked provider event",
  );
  replied.add(message.id);
}
let cancellations = 0;
for (const step of rows(before, "followup_steps")) {
  const now = rows(after, "followup_steps").find(
    (s) => s.root_id === step.root_id && s.step === step.step,
  );
  if (now.cancel_reason === step.cancel_reason) continue;
  assert.equal(step.cancel_reason, null);
  assert.equal(now.cancel_reason, "reply");
  assert(
    replied.has(step.root_id),
    "Cancellation must correspond to the newly replied thread",
  );
  cancellations++;
}
const remainingPins = new Set(
  rows(after, "campaign_attachment_pins").map(
    (p) => p.root_id + ":" + p.document_id,
  ),
);
const removed = rows(before, "campaign_attachment_pins").filter(
  (p) => !remainingPins.has(p.root_id + ":" + p.document_id),
);
assert(
  removed.every((pin) => replied.has(pin.root_id)),
  "Unexpected attachment pin removal",
);
assert.equal(
  rows(before, "deliveries").length,
  rows(after, "deliveries").length,
  "Unexpected delivery count change",
);
const result = {
  reviewedAt: new Date().toISOString(),
  baselineBackup: original.backupFile,
  latestBackup: summary.backupFile,
  verifiedNaturalReplies: replied.size,
  replyCancelledSteps: cancellations,
  replyReleasedPins: removed.length,
  providerReplyEvents: added.filter((e) => e.kind === "reply").length,
  noAdditionalDeliveries: true,
};
fs.writeFileSync(
  "apps/api/.wrangler/google-activation-natural-transitions.json",
  JSON.stringify(result, null, 2),
);
console.log(JSON.stringify(result));
