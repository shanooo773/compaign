// Read-only production source verification; never invokes the scheduler or Gmail.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {transformSync}=require('esbuild');
const dir='apps/api/.wrangler';
(async()=>{
 const cfg=JSON.parse(fs.readFileSync(dir+'/management-config.json','utf8'));
 const token=/oauth_token\s*=\s*"([^"\r\n]+)"/.exec(fs.readFileSync(path.join(process.env.APPDATA,'xdg.config/.wrangler/config/default.toml'),'utf8'))?.[1];assert(token);
 const base='https://api.cloudflare.com/client/v4/accounts/'+cfg.account_id+'/workers/scripts/'+cfg.name;
 const r=await fetch(base,{headers:{Authorization:'Bearer '+token},signal:AbortSignal.timeout(20000)});assert(r.ok);
 const raw=await r.text(),boundary=raw.slice(0,raw.indexOf('\r\n'));let live;
 for(const part of raw.split(boundary)){const i=part.indexOf('\r\n\r\n');if(i>=0 && /name="index\.js"/.test(part.slice(0,i)))live=part.slice(i+4).replace(/\r\n$/,'');}assert(live);
 fs.writeFileSync(dir+'/account-erasure-fix-live-before.js',live);
 const baseline=fs.readFileSync(dir+'/account-erasure-baseline-build/index.js','utf8');
 const normalize=s=>transformSync(s,{loader:'js',minifyWhitespace:true,legalComments:'none'}).code;
 const result={capturedAt:new Date().toISOString(),onlyTargetedChange:normalize(baseline)===normalize(live)};
 fs.writeFileSync(dir+'/account-erasure-fix-source-verification.json',JSON.stringify(result,null,2));
 console.log(JSON.stringify(result));
 assert(result.onlyTargetedChange,'Unrelated local source changes differ from production; deployment blocked');
})().catch(e=>{console.error(e.message);process.exitCode=1;});
