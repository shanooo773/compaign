// Offline restore and aggregate quota diagnosis; never emits identities or message content.
const fs=require('node:fs'),assert=require('node:assert/strict'),crypto=require('node:crypto'),{spawnSync}=require('node:child_process'),{DatabaseSync}=require('node:sqlite');
const dir='apps/api/.wrangler';
const file=JSON.parse(fs.readFileSync(dir+'/onboarding-safety-summary.json','utf8')).backupFile;
const command="Add-Type -AssemblyName System.Security; $b=[Convert]::FromBase64String([Console]::In.ReadToEnd()); [Console]::Out.Write([Convert]::ToBase64String([Security.Cryptography.ProtectedData]::Unprotect($b,$null,[Security.Cryptography.DataProtectionScope]::CurrentUser)))";
const r=spawnSync('powershell.exe',['-NoProfile','-NonInteractive','-Command',command],{input:fs.readFileSync(file).toString('base64'),encoding:'utf8',windowsHide:true,maxBuffer:64*1024*1024});assert.equal(r.status,0);
const backup=JSON.parse(Buffer.from(r.stdout.trim(),'base64').toString()),db=new DatabaseSync(':memory:');
db.exec('PRAGMA foreign_keys=OFF');
const q=x=>'"'+x.replaceAll('"','""')+'"';
for(const t of backup.schema.filter(s=>s.type==='table'))db.exec(t.sql);
for(const item of backup.data)for(const row of JSON.parse(item.data)){const keys=Object.keys(row);db.prepare('INSERT INTO '+q(item.name)+' ('+keys.map(q)+') VALUES ('+keys.map(()=>'?')+')').run(...keys.map(k=>row[k].kind==='blob'?Buffer.from(row[k].value,'hex'):row[k].value));}
for(const t of backup.schema.filter(s=>s.type!=='table'))db.exec(t.sql);
const digest=()=>crypto.createHash('sha256').update(JSON.stringify(backup.data.map(t=>[t.name,db.prepare('SELECT * FROM '+q(t.name)).all()]))).digest('hex');
const before=digest();
const old=db.prepare("SELECT u.id,count(m.id) retained,SUM(m.status='draft') drafts,SUM(m.status='pending') pending,SUM(m.status='sent') sent,SUM(m.status='cancelled') cancelled,SUM(m.status='failed') failed,SUM(m.status='replied') replied FROM users u LEFT JOIN messages m ON m.user_id=u.id GROUP BY u.id ORDER BY retained DESC").all();
const globalUsed=db.prepare('SELECT count(*) n FROM messages').get().n;
db.exec(fs.readFileSync('apps/api/migrations/0018_active_message_capacity.sql','utf8'));
assert.equal(digest(),before);
const result={capturedAt:backup.capturedAt,backupFile:file,oldGlobalUsed:globalUsed,oldGlobalAvailable:1000-globalUsed,newGlobalUsed:db.prepare('SELECT count(*) n FROM active_message_capacity').get().n,allExistingRowsUnchanged:true,accounts:old.map((u,i)=>({account:i+1,retained:u.retained,drafts:u.drafts,pending:u.pending,sent:u.sent,cancelled:u.cancelled,failed:u.failed,replied:u.replied,oldAvailable:100-u.retained,oldRejects16Initials:u.retained+16>100,active:db.prepare('SELECT count(*) n FROM active_message_capacity WHERE user_id=?').get(u.id).n}))};
fs.writeFileSync(dir+'/capacity-diagnosis.json',JSON.stringify(result,null,2));console.log(JSON.stringify(result));db.close();
