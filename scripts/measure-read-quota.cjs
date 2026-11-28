// Offline D1 engine measurements from the encrypted, verified production snapshot.
const fs=require('node:fs'),assert=require('node:assert/strict'),{spawnSync}=require('node:child_process'),{Miniflare,convertV4MiniflareOptions}=require('miniflare');
const dir='apps/api/.wrangler',q=s=>'"'+s.replaceAll('"','""')+'"';
(async()=>{
 const safety=JSON.parse(fs.readFileSync(dir+'/onboarding-safety-summary.json'));
 const cmd="Add-Type -AssemblyName System.Security; $b=[Convert]::FromBase64String([Console]::In.ReadToEnd()); [Console]::Out.Write([Convert]::ToBase64String([Security.Cryptography.ProtectedData]::Unprotect($b,$null,[Security.Cryptography.DataProtectionScope]::CurrentUser)))";
 const r=spawnSync('powershell.exe',['-NoProfile','-NonInteractive','-Command',cmd],{input:fs.readFileSync(safety.backupFile).toString('base64'),encoding:'utf8',windowsHide:true,maxBuffer:64e6});assert.equal(r.status,0);const backup=JSON.parse(Buffer.from(r.stdout.trim(),'base64'));
 const mf=new Miniflare(convertV4MiniflareOptions({workers:[{name:"offline",modules:true,script:'export default {fetch(){return new Response("offline")}}',d1Databases:['DB']}]}));
 try{
 const db=await mf.getD1Database('DB');
 await db.batch(backup.schema.filter(s=>s.type==='table').map(s=>db.prepare(s.sql)));
 const inserts=[db.prepare('PRAGMA defer_foreign_keys=ON')];
 for(const item of backup.data)for(const row of JSON.parse(item.data)){const names=Object.keys(row);inserts.push(db.prepare(`INSERT INTO ${q(item.name)} (${names.map(q)}) VALUES (${names.map(()=>'?')})`).bind(...names.map(n=>row[n].kind==='blob'?[...Buffer.from(row[n].value,'hex')]:row[n].value)));}
 await db.batch(inserts);
 await db.batch(backup.schema.filter(s=>s.type!=='table').map(s=>db.prepare(s.sql)));
 const insights=JSON.parse(fs.readFileSync(dir+'/read-quota-insights.json'));
 const normalize=s=>s.replace(/\s+/g,' ').trim();
 const oldIdle=normalize(fs.readFileSync(dir+'/read-quota-source-before/campaign-archive.ts','utf8').match(/campaignIdleSQL = `([\s\S]*?)`/)[1]);
 const newIdle=normalize(fs.readFileSync('apps/api/src/campaign-archive.ts','utf8').match(/campaignIdleSQL = `([\s\S]*?)`/)[1]);
 const campaign=normalize(insights[0].query);assert(campaign.includes(oldIdle));
 const oldFollow=insights.find(x=>x.query.startsWith('SELECT f.*,r.snapshot')).query;
 const newFollow=fs.readFileSync('apps/api/src/followup-sequence.ts','utf8').match(/`(WITH candidates[\s\S]*?)`/)[1];
 const update=fs.readFileSync('apps/api/src/followup-sequence.ts','utf8').match(/`(UPDATE followup_steps SET due_at=[\s\S]*?)`/)[1];
 const users=(await db.prepare('SELECT DISTINCT user_id FROM campaign_approvals').all()).results.map(r=>r.user_id);
 async function measure(sql,params){const result=await db.prepare(sql).bind(...params).all();return {reads:result.meta.rows_read,writes:result.meta.rows_written,results:result.results,plan:(await db.prepare('EXPLAIN QUERY PLAN '+sql).bind(...params).all()).results};}
 const stepWrite=async()=>{
  const sql="UPDATE followup_steps SET next_check_at=next_check_at+60000 WHERE rowid=(SELECT rowid FROM followup_steps WHERE queued=0 AND cancel_reason IS NULL LIMIT 1)";
  const r=await db.prepare(sql).run();
  await db.prepare(sql.replace('+60000','-60000')).run();return r.meta.rows_written;
 };
 const stepWritesBefore=await stepWrite();
 const before={campaigns:[],followup:await measure(oldFollow,[Date.now(),Date.now(),1]),dates:await measure(update,[])};
 for(const user of users)before.campaigns.push(await measure(campaign,[user]));
 const migration=fs.readFileSync('apps/api/migrations/0019_read_quota.sql','utf8').replace(/\uFEFF/g,'').replace(/^--.*$/gm,'').split(';').map(s=>s.trim()).filter(Boolean);
 const indexBuild=await db.batch(migration.map(s=>db.prepare(s)));
 const stepWritesAfter=await stepWrite();
 const after={campaigns:[],followup:await measure(newFollow,[...Array(6).fill(Date.now())]),dates:await measure(update,[])};
 for(const user of users)after.campaigns.push(await measure(campaign.replace(oldIdle,newIdle),[user]));
 assert.deepEqual(after.campaigns.map(r=>r.results),before.campaigns.map(r=>r.results));assert.deepEqual(after.followup.results,before.followup.results);
 const redact=r=>({reads:r.reads,writes:r.writes,returned:r.results.length,plan:r.plan});
 const result={capturedAt:backup.capturedAt,offlineD1Engine:true,productionChanged:false,realEmailsSent:0,before:{campaigns:before.campaigns.map(redact),followup:redact(before.followup),dates:redact(before.dates)},after:{campaigns:after.campaigns.map(redact),followup:redact(after.followup),dates:redact(after.dates)},indexBuild:indexBuild.map(r=>r.meta),stepRetryIndexWrites:{before:stepWritesBefore,after:stepWritesAfter},resultEquality:true};
 fs.writeFileSync(dir+'/read-quota-measurements.json',JSON.stringify(result,null,2));
 console.log(JSON.stringify({beforeCampaignReads:before.campaigns.map(x=>x.reads),afterCampaignReads:after.campaigns.map(x=>x.reads),beforeFollowup:before.followup.reads,afterFollowup:after.followup.reads,beforeDate:before.dates.reads,afterDate:after.dates.reads,indexBuildWrites:indexBuild.map(x=>x.meta.rows_written),stepRetryWrites:{before:stepWritesBefore,after:stepWritesAfter},resultsEqual:true}));
 }finally{await mf.dispose();}
})().catch(e=>{console.error(e);process.exitCode=1;});
