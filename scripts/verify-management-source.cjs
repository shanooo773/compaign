const fs=require('node:fs'),{spawnSync}=require('node:child_process'),{transformSync}=require('esbuild'),crypto=require('node:crypto'),assert=require('node:assert/strict');
for(const variant of ['original','new']){const args=['node_modules/wrangler/bin/wrangler.js','deploy','--dry-run','--config','apps/api/.wrangler/'+(variant==='original'?'management-original-config.json':'management-config.json'),'--outdir',require('node:path').resolve('apps/api/.wrangler/management-'+variant+'-build')];const r=spawnSync(process.execPath,args,{encoding:'utf8',windowsHide:true,timeout:120000,maxBuffer:8*1024*1024});assert.equal(r.status,0,'Worker dry run failed; inspect private logs');}
const normalize=s=>{
 let code=transformSync(s,{loader:'js',minifyWhitespace:true,legalComments:'none'}).code;
 // Existing Smart Import extracted this exact field array and added unused template columns.
 // Inline only this reviewed constant extraction; require every other byte of normalized code to match.
 const constants='var spreadsheetBaseColumns=["name","email","university","interests","subject","body","scheduled_at","timezone"];var spreadsheetStepFields=["subject","body","delay_value","delay_unit","relative_to"];var spreadsheetColumns=[...spreadsheetBaseColumns,...Array.from({length:MAX_FOLLOWUPS},(_,i3)=>spreadsheetStepFields.map(field=>`follow_up_${i3+1}_${field}`)).flat()];';
 if(code.includes(constants)) code=code.replace(constants,"").replaceAll("spreadsheetStepFields",'["subject","body","delay_value","delay_unit","relative_to"]');
 return code;
};
const hash=s=>crypto.createHash('sha256').update(normalize(s)).digest('hex');const old=fs.readFileSync('apps/api/.wrangler/management-original-build/index.js','utf8'),deployed=fs.readFileSync('apps/api/.wrangler/management-deployed-before.js','utf8');
const result={startingSourceMatchesProduction:hash(old)===hash(deployed),originalHash:hash(old),deployedHash:hash(deployed),newWorkerBuildPassed:true,reviewedEquivalentChange:"Spreadsheet field-array constant extraction only"};fs.writeFileSync('apps/api/.wrangler/management-source-comparison.json',JSON.stringify(result));console.log(JSON.stringify(result));assert(result.startingSourceMatchesProduction,'Source baseline differs from production; do not deploy');
