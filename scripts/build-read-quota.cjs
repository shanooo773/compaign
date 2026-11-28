const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),{spawnSync}=require('node:child_process');
const dir='apps/api/.wrangler',root=dir+'/read-quota-baseline-source';fs.mkdirSync(root+'/apps/api',{recursive:true});fs.cpSync('apps/api/src',root+'/apps/api/src',{recursive:true});fs.cpSync('shared',root+'/shared',{recursive:true});
for(const name of ['campaign-archive','followup-sequence','automation','index'])fs.copyFileSync(dir+'/read-quota-source-before/'+name+'.ts',root+'/apps/api/src/'+name+'.ts');
const cfg=JSON.parse(fs.readFileSync(dir+'/management-config.json'));cfg.main=path.resolve(root+'/apps/api/src/index.ts');fs.writeFileSync(dir+'/read-quota-baseline-config.json',JSON.stringify(cfg));
for(const [config,out] of [['read-quota-baseline-config.json','read-quota-baseline-build'],['management-config.json','read-quota-build']]){
 const r=spawnSync(process.execPath,['node_modules/wrangler/bin/wrangler.js','deploy','--dry-run','--config',dir+'/'+config,'--outdir',path.resolve(dir+'/'+out)],{encoding:'utf8',windowsHide:true,timeout:180000,maxBuffer:8e6});fs.writeFileSync(dir+'/'+out+'.log',r.stdout+'\n'+r.stderr);assert.equal(r.status,0,'Build failed');}
console.log('Baseline and optimized Worker builds passed; no deployment.');
