// Reconcile an uncertain release outcome before any retry.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');const dir='apps/api/.wrangler';
(async()=>{
 const cfg=JSON.parse(fs.readFileSync(dir+'/management-config.json')),before=JSON.parse(fs.readFileSync(dir+'/read-quota-active-before.json'));
 const token=/oauth_token\s*=\s*"([^"\r\n]+)"/.exec(fs.readFileSync(path.join(process.env.APPDATA,'xdg.config/.wrangler/config/default.toml'),'utf8'))[1];
 const base='https://api.cloudflare.com/client/v4/accounts/'+cfg.account_id+'/workers/scripts/'+cfg.name;
 async function api(route,body){const r=await fetch(base+route,{method:body?'POST':'GET',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},body:body?JSON.stringify(body):undefined,signal:AbortSignal.timeout(30000)});const j=await r.json();assert(r.ok&&j.success,JSON.stringify(j.errors));return j.result;}
 const log=fs.readFileSync(dir+'/read-quota-upload.log','utf8'),version=/(?:Worker )?Version ID:\s*([0-9a-f-]{36})/i.exec(log)?.[1];assert(version);
 const active=await api('/deployments'),schedules=await api('/schedules');assert.deepEqual(schedules,before.schedules);
 const bindings=bs=>bs.map(b=>({name:b.name,type:b.type,...(b.type==='plain_text'?{text:b.text}:{}),...(b.type==='d1'?{id:b.id}:{}),...(b.type==='kv_namespace'?{namespace_id:b.namespace_id}:{})})).sort((a,b)=>a.name.localeCompare(b.name));
 const v=await api('/versions/'+version);assert.deepEqual(bindings(v.resources.bindings),bindings(before.settings.bindings));
 assert.equal(fs.readFileSync(dir+'/read-quota-upload-build/index.js','utf8'),fs.readFileSync(dir+'/read-quota-build/index.js','utf8'));
 let deployment=active.deployments[0],alreadyActive=deployment.versions.length===1&&deployment.versions[0].version_id===version&&deployment.versions[0].percentage===100;
 if(!alreadyActive){assert.deepEqual(deployment,before.active.deployments[0],'Production changed externally');deployment=await api('/deployments',{strategy:'percentage',versions:[{version_id:version,percentage:100}],annotations:{'workers/message':'Verified D1 query optimizations, minute sending and hourly bounded reply sweeps'}});}
 const result={version,deployment,deployedAt:new Date().toISOString(),alreadyActive,cronChanged:false,bindingsMatch:true};fs.writeFileSync(dir+'/read-quota-deployment.json',JSON.stringify(result,null,2));console.log(JSON.stringify(result));
})().catch(e=>{console.error(e.message);process.exitCode=1;});
