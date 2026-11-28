// Additive lifecycle release; never calls Gmail or manually triggers cron.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),{spawnSync}=require('node:child_process');
const dir='apps/api/.wrangler',cfg=JSON.parse(fs.readFileSync(dir+'/management-config.json','utf8'));
const token=/oauth_token\s*=\s*"([^"\r\n]+)"/.exec(fs.readFileSync(path.join(process.env.APPDATA,'xdg.config/.wrangler/config/default.toml'),'utf8'))?.[1];assert(token);
const base='/accounts/'+cfg.account_id+'/workers/scripts/'+cfg.name;
async function api(route,body){const r=await fetch('https://api.cloudflare.com/client/v4'+route,{method:body?'POST':'GET',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},body:body?JSON.stringify(body):undefined,signal:AbortSignal.timeout(30000)});const j=await r.json();assert(r.ok&&j.success,'Cloudflare operation failed: '+r.status);return j.result;}
const canonical=bs=>bs.map(b=>({name:b.name,type:b.type,...(b.type==='plain_text'?{text:b.text}:{}),...(b.type==='d1'?{id:b.id}:{}),...(b.type==='kv_namespace'?{namespace_id:b.namespace_id}:{})})).sort((a,b)=>a.name.localeCompare(b.name));
(async()=>{
 const mode=process.argv[2];assert(['upload','migrate','deploy'].includes(mode));
 assert(JSON.parse(fs.readFileSync(dir+'/lifecycle-source-verification.json','utf8')).onlyReviewedLifecycleChanges);
 const safety=JSON.parse(fs.readFileSync(dir+'/onboarding-safety-summary.json','utf8'));assert(safety.restoredInMemory&&safety.schedulerHealthy);assert(Date.now()-Date.parse(safety.capturedAt)<1800000,'Refresh encrypted backup');
 assert(JSON.parse(fs.readFileSync(dir+'/lifecycle-migration-verification.json','utf8')).allExistingTableRowsUnchanged);
 const settings=await api(base+'/settings'),schedules=await api(base+'/schedules'),active=await api(base+'/deployments');
 if(mode==='upload'){
  fs.writeFileSync(dir+'/lifecycle-active-before.json',JSON.stringify({active,settings,schedules}));
  const r=spawnSync(process.execPath,['node_modules/wrangler/bin/wrangler.js','versions','upload','--config',dir+'/management-config.json','--outdir',path.resolve(dir+'/lifecycle-upload-build'),'--keep-vars','--tag','campaign-lifecycle','--message','Safe Archive/Restore and audit-retaining workspace deletion'],{encoding:'utf8',windowsHide:true,timeout:180000,maxBuffer:8*1024*1024});
  fs.writeFileSync(dir+'/lifecycle-upload.log',r.stdout+'\n'+r.stderr);assert.equal(r.status,0,'Upload failed; inspect private log');
  const version=/(?:Worker )?Version ID:\s*([0-9a-f-]{36})/i.exec(r.stdout+'\n'+r.stderr)?.[1];assert(version);
  const v=await api(base+'/versions/'+version);assert.deepEqual(canonical(v.resources.bindings),canonical(settings.bindings),'Uploaded bindings differ');
  const expected=fs.readFileSync(dir+'/lifecycle-build/index.js','utf8');assert.equal(fs.readFileSync(dir+'/lifecycle-upload-build/index.js','utf8'),expected,'Upload build differs from verified artifact');
  fs.writeFileSync(dir+'/lifecycle-upload.json',JSON.stringify({version,bindingsMatch:true}));console.log(JSON.stringify({uploadedVersion:version,bindingsMatch:true,productionTrafficChanged:false}));
 }else if(mode==='migrate'){
  const db='/accounts/'+cfg.account_id+'/d1/database/'+cfg.d1_databases[0].database_id;
  const result=await api(db+'/query',{sql:"SELECT name FROM d1_migrations ORDER BY id"});assert.equal(result[0].results.length,15,'Inspect migration history before retry');
  await api(db+'/query',{sql:fs.readFileSync('apps/api/migrations/0016_campaign_archives.sql','utf8')+"\nINSERT INTO d1_migrations(name) VALUES('0016_campaign_archives.sql');"});
  console.log(JSON.stringify({additiveMigrationApplied:'0016_campaign_archives.sql',existingCampaignRowsChanged:false}));
 }else{
  const applied=await api('/accounts/'+cfg.account_id+'/d1/database/'+cfg.d1_databases[0].database_id+'/query',{sql:"SELECT name FROM d1_migrations WHERE name='0016_campaign_archives.sql'"});assert.equal(applied[0].results.length,1);
  const before=JSON.parse(fs.readFileSync(dir+'/lifecycle-active-before.json','utf8'));
  assert.deepEqual(active.deployments[0],before.active.deployments[0],'Production changed');assert.deepEqual(canonical(settings.bindings),canonical(before.settings.bindings));assert.deepEqual(schedules,before.schedules);
  const uploaded=JSON.parse(fs.readFileSync(dir+'/lifecycle-upload.json','utf8'));assert(uploaded.bindingsMatch);
  const deployment=await api(base+'/deployments',{strategy:'percentage',versions:[{version_id:uploaded.version,percentage:100}],annotations:{'workers/message':'Verified lifecycle management; retain approvals and sending audit; preserve schedules'}});
  fs.writeFileSync(dir+'/lifecycle-deployment.json',JSON.stringify({version:uploaded.version,deployment,deployedAt:new Date().toISOString()}));console.log(JSON.stringify({deployedVersion:uploaded.version,cronChanged:false,additiveMetadataSchema:true}));
 }
})().catch(e=>{console.error(e.message);process.exitCode=1;});
