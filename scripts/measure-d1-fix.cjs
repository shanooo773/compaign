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
  const result=[];for(let n=0;n<2;n++)result.push(Number(db.prepare(query).run().changes));
  const unresolved=db.prepare('SELECT count(*) n FROM followup_steps WHERE due_at IS NULL AND queued=0 AND cancel_reason IS NULL').get().n;
  return {matchedRowsPerExecution:result,unresolvedSteps:unresolved};
 } finally {db.close();}
}
const result={snapshotCapturedAt:backup.capturedAt,offlineOnly:true,before:replay(old),after:replay(sql),note:'SQLite matched-row counts exclude D1 index amplification; no Gmail or production mutation.'};
fs.writeFileSync(dir+'/d1-fix-replay.json',JSON.stringify(result,null,2));console.log(JSON.stringify(result));
