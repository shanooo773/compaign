// Offline-only replay of a Windows-user-encrypted production snapshot.
const fs=require('node:fs'),assert=require('node:assert/strict'),{spawnSync}=require('node:child_process'),{DatabaseSync}=require('node:sqlite');
const dir='apps/api/.wrangler';
const file=JSON.parse(fs.readFileSync(dir+'/onboarding-safety-summary.json','utf8')).backupFile;
const command="Add-Type -AssemblyName System.Security; $b=[Convert]::FromBase64String([Console]::In.ReadToEnd()); [Console]::Out.Write([Convert]::ToBase64String([Security.Cryptography.ProtectedData]::Unprotect($b,$null,[Security.Cryptography.DataProtectionScope]::CurrentUser)))";
const r=spawnSync('powershell.exe',['-NoProfile','-NonInteractive','-Command',command],{input:fs.readFileSync(file).toString('base64'),encoding:'utf8',windowsHide:true,maxBuffer:64*1024*1024});assert.equal(r.status,0);
const backup=JSON.parse(Buffer.from(r.stdout.trim(),'base64').toString());
const decode=name=>JSON.parse(backup.data.find(t=>t.name===name).data).map(r=>Object.fromEntries(Object.entries(r).map(([k,v])=>[k,v.value])));
const transports=decode('transports'),receipts=decode('deliveries'),attempts=decode('delivery_attempts');
const result={capturedAt:backup.capturedAt,unresolvedTransports:transports.filter(t=>['submitting','uncertain','leased'].includes(t.state)).length,confirmedWithoutReceipt:transports.filter(t=>t.state==='confirmed'&&!receipts.some(d=>d.message_id===t.message_id)).length,acceptedAttemptsWithoutReceipt:attempts.filter(a=>a.outcome==='accepted'&&!receipts.some(d=>d.message_id===a.message_id)).length,uncertainAttempts:attempts.filter(a=>a.outcome==='uncertain').length,retainedReceipts:receipts.length,retainedAttempts:attempts.length};
fs.writeFileSync(dir+'/d1-delivery-diagnosis.json',JSON.stringify(result,null,2));console.log(JSON.stringify(result));
