// Read-only deployed artifact and exact query row counters. Never submits email.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),{spawnSync}=require('node:child_process');
const dir='apps/api/.wrangler';
(async()=>{
 const cfg=JSON.parse(fs.readFileSync(dir+'/management-config.json')),release=JSON.parse(fs.readFileSync(dir+'/read-quota-deployment.json'));
 const token=/oauth_token\s*=\s*"([^"\r\n]+)"/.exec(fs.readFileSync(path.join(process.env.APPDATA,'xdg.config/.wrangler/config/default.toml'),'utf8'))[1];
 const base='/accounts/'+cfg.account_id,worker=base+'/workers/scripts/'+cfg.name;
 async function api(route,body){const r=await fetch('https://api.cloudflare.com/client/v4'+route,{method:body?'POST':'GET',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},body:body?JSON.stringify(body):undefined,signal:AbortSignal.timeout(30000)});const j=await r.json();assert(r.ok&&j.success,JSON.stringify(j.errors));return j.result;}
 const active=await api(worker+'/deployments');assert.deepEqual(active.deployments[0].versions,[{version_id:release.version,percentage:100}]);
 const r=await fetch('https://api.cloudflare.com/client/v4'+worker,{headers:{Authorization:'Bearer '+token},signal:AbortSignal.timeout(30000)});assert(r.ok);const raw=await r.text(),boundary=raw.slice(0,raw.indexOf('\r\n'));let live;
 for(const part of raw.split(boundary)){const i=part.indexOf('\r\n\r\n');if(i>=0&&/name="index\.js"/.test(part.slice(0,i)))live=part.slice(i+4).replace(/\r\n$/,'');}assert.equal(live,fs.readFileSync(dir+'/read-quota-upload-build/index.js','utf8'));
 const safety=JSON.parse(fs.readFileSync(dir+'/read-quota-safety-before.json'));
 const cmd="Add-Type -AssemblyName System.Security; $b=[Convert]::FromBase64String([Console]::In.ReadToEnd()); [Console]::Out.Write([Convert]::ToBase64String([Security.Cryptography.ProtectedData]::Unprotect($b,$null,[Security.Cryptography.DataProtectionScope]::CurrentUser)))";
 const restored=spawnSync('powershell.exe',['-NoProfile','-NonInteractive','-Command',cmd],{input:fs.readFileSync(safety.backupFile).toString('base64'),encoding:'utf8',windowsHide:true,maxBuffer:64e6});assert.equal(restored.status,0);const backup=JSON.parse(Buffer.from(restored.stdout.trim(),'base64'));
 const users=[...new Set(JSON.parse(backup.data.find(t=>t.name==='campaign_approvals').data).map(row=>row.user_id.value))];
 const normalize=s=>s.replace(/\s+/g,' ').trim();
 const oldIdle=normalize(fs.readFileSync(dir+'/read-quota-source-before/campaign-archive.ts','utf8').match(/campaignIdleSQL = `([\s\S]*?)`/)[1]),fresh=normalize(fs.readFileSync('apps/api/src/campaign-archive.ts','utf8').match(/campaignIdleSQL = `([\s\S]*?)`/)[1]);
 const sql=normalize(JSON.parse(fs.readFileSync(dir+'/read-quota-insights.json'))[0].query).replace(oldIdle,fresh);
 const query=(sql,params=[])=>api(base+'/d1/database/684cb48c-3f43-4cef-8217-cf9624d23522/query',{sql,params});
 const campaigns=[];for(const user of users){const [r]=await query(sql,[user]);campaigns.push({reads:r.meta.rows_read,writes:r.meta.rows_written,returned:r.results.length});}
 const follow=fs.readFileSync('apps/api/src/followup-sequence.ts','utf8').match(/`(WITH candidates[\s\S]*?)`/)[1];const [f]=await query(follow,Array(6).fill(Date.now()));
 const result={checkedAt:new Date().toISOString(),activeVersion:release.version,artifactMatches:true,campaigns,followup:{reads:f.meta.rows_read,writes:f.meta.rows_written,returned:f.results.length},indexes:(await query("SELECT name FROM sqlite_master WHERE name IN ('messages_parent_status','followup_active_due','mailbox_events_message')"))[0].results.map(r=>r.name),cronUnchanged:JSON.stringify(await api(worker+'/schedules'))===JSON.stringify(JSON.parse(fs.readFileSync(dir+'/read-quota-active-before.json')).schedules)};
 fs.writeFileSync(dir+'/read-quota-production-verification.json',JSON.stringify(result,null,2));console.log(JSON.stringify(result));
})().catch(e=>{console.error(e.message);process.exitCode=1;});
