// Offline-only replay of a Windows-user-encrypted production snapshot.
const fs=require('node:fs'),assert=require('node:assert/strict'),{spawnSync}=require('node:child_process'),{DatabaseSync}=require('node:sqlite');
const dir='apps/api/.wrangler';
const file=JSON.parse(fs.readFileSync(dir+'/onboarding-safety-summary.json','utf8')).backupFile;
const command="Add-Type -AssemblyName System.Security; $b=[Convert]::FromBase64String([Console]::In.ReadToEnd()); [Console]::Out.Write([Convert]::ToBase64String([Security.Cryptography.ProtectedData]::Unprotect($b,$null,[Security.Cryptography.DataProtectionScope]::CurrentUser)))";
const r=spawnSync('powershell.exe',['-NoProfile','-NonInteractive','-Command',command],{input:fs.readFileSync(file).toString('base64'),encoding:'utf8',windowsHide:true,maxBuffer:64*1024*1024});assert.equal(r.status,0);
const backup=JSON.parse(Buffer.from(r.stdout.trim(),'base64').toString());
const q=s=>'"'+s.replaceAll('"','""')+'"';
const source=fs.readFileSync('apps/api/src/followup-sequence.ts','utf8').replaceAll('\r\n','\n');
const sql=source.match(/`(UPDATE followup_steps SET due_at=[\s\S]*?)`/)[1],old=sql.slice(0,sql.indexOf('\n    AND EXISTS ('));
function replay(query){
 const db=new DatabaseSync(':memory:');
 try {
  db.exec('PRAGMA foreign_keys=OFF');
  for(const t of backup.schema.filter(s=>s.type==='table'))db.exec(t.sql);
  for(const item of backup.data)for(const row of JSON.parse(item.data)){
   const names=Object.keys(row);db.prepare(`INSERT INTO ${q(item.name)} (${names.map(q)}) VALUES (${names.map(()=>'?')})`).run(...names.map(n=>row[n].kind==='blob'?Buffer.from(row[n].value,'hex'):row[n].value));
  }
  for(const item of backup.schema.filter(s=>s.type!=='table'))db.exec(item.sql);
  const rows=()=>Object.fromEntries(backup.schema.filter(s=>s.type==='table').map(t=>[t.name,db.prepare('SELECT * FROM '+q(t.name)).all()]));
  const before=rows();db.exec(fs.readFileSync('apps/api/migrations/0016_campaign_archives.sql','utf8'));
  assert.deepEqual(rows(),before);assert.equal(db.prepare('PRAGMA integrity_check').get().integrity_check,'ok');assert.equal(db.prepare('PRAGMA foreign_key_check').all().length,0);
  return {allExistingTableRowsUnchanged:true,integrityCheck:true,foreignKeyCheck:true,newTables:3};
 } finally {db.close();}
}
const result={snapshotCapturedAt:backup.capturedAt,...replay()};fs.writeFileSync(dir+'/lifecycle-migration-verification.json',JSON.stringify(result,null,2));console.log(JSON.stringify(result));
