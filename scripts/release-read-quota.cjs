// Gated release: additive tested indexes, version upload, preserved bindings and unchanged Cron.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),{spawnSync}=require('node:child_process'),crypto=require('node:crypto');
const dir='apps/api/.wrangler',cfg=JSON.parse(fs.readFileSync(dir+'/management-config.json'));
const token=/oauth_token\s*=\s*"([^"\r\n]+)"/.exec(fs.readFileSync(path.join(process.env.APPDATA,'xdg.config/.wrangler/config/default.toml'),'utf8'))?.[1];assert(token);
const base='/accounts/'+cfg.account_id,worker=base+'/workers/scripts/'+cfg.name;
async function api(route,body){const r=await fetch('https://api.cloudflare.com/client/v4'+route,{method:body?'POST':'GET',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},body:body?JSON.stringify(body):undefined,signal:AbortSignal.timeout(30000)});const j=await r.json();assert(r.ok&&j.success,'Cloudflare operation failed: '+r.status+' '+JSON.stringify(j.errors));return j.result;}
const bindings=bs=>bs.map(b=>({name:b.name,type:b.type,...(b.type==='plain_text'?{text:b.text}:{}),...(b.type==='d1'?{id:b.id}:{}),...(b.type==='kv_namespace'?{namespace_id:b.namespace_id}:{})})).sort((a,b)=>a.name.localeCompare(b.name));
(async()=>{
 assert(JSON.parse(fs.readFileSync(dir+'/read-quota-source-verification.json')).baselineMatchesProduction);
 const measure=JSON.parse(fs.readFileSync(dir+'/read-quota-measurements.json'));assert(measure.resultEquality&&measure.after.followup.reads<measure.before.followup.reads);
 const safety=JSON.parse(fs.readFileSync(dir+'/onboarding-safety-summary.json'));assert(safety.restoredInMemory&&safety.schedulerHealthy&&Date.now()-Date.parse(safety.capturedAt)<1800000,'Refresh verified backup');
 const settings=await api(worker+'/settings'),schedules=await api(worker+'/schedules'),active=await api(worker+'/deployments');
 if(fs.existsSync(dir+'/read-quota-deployment.json')){
  const previous=JSON.parse(fs.readFileSync(dir+'/read-quota-deployment.json'));
  assert.deepEqual(active.deployments[0].versions,[{version_id:previous.version,percentage:100}],'Prior verified version no longer active');
  if(!fs.existsSync(dir+'/read-quota-initial-deployment.json'))fs.copyFileSync(dir+'/read-quota-deployment.json',dir+'/read-quota-initial-deployment.json');
 }

 assert.deepEqual((Array.isArray(schedules)?schedules:schedules.schedules).map(s=>s.cron),['* * * * *']);
 fs.writeFileSync(dir+'/read-quota-active-before.json',JSON.stringify({settings,schedules,active}));
 const migration=spawnSync(process.execPath,['node_modules/wrangler/bin/wrangler.js','d1','migrations','apply','outreach','--remote','--config','apps/api/wrangler.jsonc'],{encoding:'utf8',windowsHide:true,timeout:180000,maxBuffer:8e6});fs.writeFileSync(dir+'/read-quota-migration.log',migration.stdout+'\n'+migration.stderr);assert.equal(migration.status,0,'Migration failed; inspect private log');
 const upload=spawnSync(process.execPath,['node_modules/wrangler/bin/wrangler.js','versions','upload','--config',dir+'/management-config.json','--outdir',path.resolve(dir+'/read-quota-upload-build'),'--keep-vars','--tag','d1-read-quota','--message','Indexed campaign and due queries; minute sending; hourly bounded reply sweeps'],{encoding:'utf8',windowsHide:true,timeout:180000,maxBuffer:8e6});fs.writeFileSync(dir+'/read-quota-upload.log',upload.stdout+'\n'+upload.stderr);assert.equal(upload.status,0,'Upload failed; inspect private log');
 const version=/(?:Worker )?Version ID:\s*([0-9a-f-]{36})/i.exec(upload.stdout+'\n'+upload.stderr)?.[1];assert(version);
 const v=await api(worker+'/versions/'+version);assert.deepEqual(bindings(v.resources.bindings),bindings(settings.bindings),'Bindings changed');
 assert.equal(fs.readFileSync(dir+'/read-quota-upload-build/index.js','utf8'),fs.readFileSync(dir+'/read-quota-build/index.js','utf8'),'Upload differs from tested artifact');
 const current=await api(worker+'/deployments');assert.deepEqual(current.deployments[0],active.deployments[0],'Production version changed');assert.deepEqual(await api(worker+'/schedules'),schedules);
 const deployment=await api(worker+'/deployments',{strategy:'percentage',versions:[{version_id:version,percentage:100}],annotations:{'workers/message':'Measured D1 read optimization; stored schedules and bindings preserved'}});
 const result={version,deployment,deployedAt:new Date().toISOString(),cronChanged:false,bindingsMatch:true,indexes:['messages_parent_status','followup_active_due','mailbox_events_message']};fs.writeFileSync(dir+'/read-quota-deployment.json',JSON.stringify(result,null,2));console.log(JSON.stringify(result));
})().catch(e=>{console.error(e.message);process.exitCode=1;});
