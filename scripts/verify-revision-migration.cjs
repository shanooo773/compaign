const fs=require('node:fs'),assert=require('node:assert/strict'),{spawnSync}=require('node:child_process'),{DatabaseSync}=require('node:sqlite'),crypto=require('node:crypto');
const file=process.argv[2];assert(file && file.startsWith('apps/api/.wrangler/'),'Private backup path required');
const code="Add-Type -AssemblyName System.Security; $b=[Convert]::FromBase64String([Console]::In.ReadToEnd()); [Console]::Out.Write([Convert]::ToBase64String([Security.Cryptography.ProtectedData]::Unprotect($b,$null,[Security.Cryptography.DataProtectionScope]::CurrentUser)))";
const result=spawnSync('powershell.exe',['-NoProfile','-NonInteractive','-Command',code],{input:fs.readFileSync(file).toString('base64'),encoding:'utf8',windowsHide:true,maxBuffer:64*1024*1024});assert.equal(result.status,0,'Backup decryption failed');
const backup=JSON.parse(Buffer.from(result.stdout,'base64').toString()),db=new DatabaseSync(':memory:');db.exec('PRAGMA foreign_keys=OFF');const q=x=>'"'+x.replaceAll('"','""')+'"';
for(const t of backup.schema.filter(s=>s.type==='table'))db.exec(t.sql);
for(const item of backup.data){for(const row of JSON.parse(item.data)){const keys=Object.keys(row);db.prepare(`INSERT INTO ${q(item.name)} (${keys.map(q)}) VALUES (${keys.map(()=>'?')})`).run(...keys.map(k=>row[k].kind==='blob'?Buffer.from(row[k].value,'hex'):row[k].value));}}
for(const t of backup.schema.filter(s=>s.type!=='table'))db.exec(t.sql);
const digest=v=>crypto.createHash('sha256').update(JSON.stringify(v)).digest('hex');const hashes=Object.fromEntries(backup.data.map(t=>[t.name,digest(db.prepare(`SELECT * FROM ${q(t.name)}`).all())]));
db.exec(fs.readFileSync('apps/api/migrations/0017_message_revisions.sql','utf8'));
for(const [name,hash] of Object.entries(hashes))assert.equal(digest(db.prepare(`SELECT * FROM ${q(name)}`).all()),hash,'Existing table changed: '+name);
assert.equal(db.prepare('PRAGMA integrity_check').get().integrity_check,'ok');assert.equal(db.prepare('PRAGMA foreign_key_check').all().length,0);
const summary={backupVerified:true,additiveMigrationAppliedLocally:true,allExistingTableRowsUnchanged:true,integrityCheck:true,foreignKeyCheck:true,approvedCampaigns:db.prepare('SELECT count(*) n FROM campaign_approvals').get().n,legacyContactEvidence:db.prepare('SELECT count(*) n FROM contacted_initials').get().n,rollingSubmissionEvidence:db.prepare('SELECT count(*) n FROM outgoing_submissions').get().n};
fs.writeFileSync('apps/api/.wrangler/revision-migration-verification.json',JSON.stringify(summary,null,2));console.log(JSON.stringify(summary));db.close();
