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

function decode(file){const b=JSON.parse(protect(fs.readFileSync(file),true).toString());return name=>JSON.parse(b.data.find(x=>x.name===name).data).map(r=>Object.fromEntries(Object.entries(r).map(([k,v])=>[k,v.value])));}
const before=decode('apps/api/.wrangler/onboarding-production-1793961990788.dpapi'),after=decode('apps/api/.wrangler/onboarding-production-1793964789962.dpapi');
const changed=before('messages').filter(m=>after('messages').find(n=>n.id===m.id)?.status!==m.status);
const receipts=changed.map(m=>{const n=after('messages').find(n=>n.id===m.id),d=after('deliveries').filter(d=>d.message_id===m.id);return {from:m.status,to:n.status,scheduleUnchanged:m.scheduled_at===n.scheduled_at,deliveryCount:d.length};});
assert(receipts.every(r=>r.from==='pending'&&r.to==='sent'&&r.scheduleUnchanged&&r.deliveryCount>0));fs.writeFileSync(directory+'/ui-redesign-natural-transitions.json',JSON.stringify({count:receipts.length,receipts},null,2));console.log(JSON.stringify({naturalDeliveriesVerified:receipts.length,schedulesUnchanged:true}));
