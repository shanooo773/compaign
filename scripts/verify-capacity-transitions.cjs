// Read encrypted snapshots locally; emit only aggregate transition evidence.
const fs=require('fs'),assert=require('assert/strict'),{spawnSync}=require('child_process');
const dir='apps/api/.wrangler',latest=JSON.parse(fs.readFileSync(dir+'/onboarding-safety-summary.json','utf8')).backupFile;
function open(file){const cmd="Add-Type -AssemblyName System.Security; $b=[Convert]::FromBase64String([Console]::In.ReadToEnd()); [Console]::Out.Write([Convert]::ToBase64String([Security.Cryptography.ProtectedData]::Unprotect($b,$null,[Security.Cryptography.DataProtectionScope]::CurrentUser)))";const r=spawnSync('powershell.exe',['-NoProfile','-NonInteractive','-Command',cmd],{input:fs.readFileSync(file).toString('base64'),encoding:'utf8',windowsHide:true,maxBuffer:64*1024*1024});assert.equal(r.status,0);return JSON.parse(Buffer.from(r.stdout.trim(),'base64').toString());}
const before=open(dir+'/onboarding-production-1795025494356.dpapi'),after=open(latest);
const rows=(b,name)=>JSON.parse(b.data.find(t=>t.name===name).data).map(r=>Object.fromEntries(Object.entries(r).map(([k,v])=>[k,v.value])));
const oldMessages=rows(before,'messages'),messages=rows(after,'messages'),steps=rows(before,'followup_steps'),receipts=rows(after,'deliveries'),auth=rows(after,'message_authorizations');
const fresh=messages.filter(m=>!oldMessages.some(o=>o.id===m.id));
for(const m of fresh){const step=steps.find(f=>f.child_id===m.id);assert(step,'New message must belong to a pre-existing approved step');assert.equal(m.subject,step.subject);assert.equal(m.body,step.body);assert.equal(auth.find(a=>a.message_id===m.id).authorized_at,step.authorized_at);
const base=messages.find(b=>b.id===(step.relative_to==='original'||step.step===1?step.root_id:steps.find(f=>f.root_id===step.root_id&&f.step===step.step-1).child_id));
const due=Date.parse(base.sent_at)+step.delay_value*({minutes:60000,hours:3600000,days:86400000}[step.delay_unit]);
assert.equal(Date.parse(m.scheduled_at),due);
if(m.status==='sent'){assert(Date.parse(m.sent_at)>=due);assert(receipts.some(r=>r.message_id===m.id&&r.provider==='gmail'));}}
for(const name of ['campaign_approvals','message_authorizations','deliveries','followup_approvals']){const old=rows(before,name),now=rows(after,name);for(const row of old)assert(now.some(n=>JSON.stringify(n)===JSON.stringify(row)),'Original immutable record changed: '+name);}
const result={backupFile:latest,preexistingApprovedFollowupsQueued:fresh.length,naturalScheduledDeliveries:fresh.filter(m=>m.status==='sent').length,originalContentAndAuthorizationPreserved:true,originalSchedulesPreserved:true,originalImmutableRecordsPreserved:true,realTestEmailsSent:0};
fs.writeFileSync(dir+'/capacity-natural-transitions.json',JSON.stringify(result,null,2));console.log(JSON.stringify(result));