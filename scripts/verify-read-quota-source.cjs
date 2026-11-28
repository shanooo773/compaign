// Read-only source and binding comparison; refuses unrelated local changes.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),{transformSync}=require('esbuild');
const dir='apps/api/.wrangler';
(async()=>{
 const cfg=JSON.parse(fs.readFileSync(dir+'/management-config.json'));
 const token=/oauth_token\s*=\s*"([^"\r\n]+)"/.exec(fs.readFileSync(path.join(process.env.APPDATA,'xdg.config/.wrangler/config/default.toml'),'utf8'))?.[1];assert(token);
 const base='https://api.cloudflare.com/client/v4/accounts/'+cfg.account_id+'/workers/scripts/'+cfg.name;
 const r=await fetch(base,{headers:{Authorization:'Bearer '+token},signal:AbortSignal.timeout(30000)});assert(r.ok);const raw=await r.text(),boundary=raw.slice(0,raw.indexOf('\r\n'));let live;
 for(const part of raw.split(boundary)){const i=part.indexOf('\r\n\r\n');if(i>=0&&/name="index\.js"/.test(part.slice(0,i)))live=part.slice(i+4).replace(/\r\n$/,'');}assert(live);
 fs.writeFileSync(dir+'/read-quota-live-before.js',live);
 const normalize=s=>transformSync(s,{loader:'js',minifyWhitespace:true,legalComments:'none'}).code;
 const baseline=fs.readFileSync(dir+'/read-quota-baseline-build/index.js','utf8');
 const result={capturedAt:new Date().toISOString(),baselineMatchesProduction:normalize(baseline)===normalize(live)};
 fs.writeFileSync(dir+'/read-quota-source-verification.json',JSON.stringify(result,null,2));console.log(JSON.stringify(result));assert(result.baselineMatchesProduction,'Baseline differs from live: deployment blocked');
})().catch(e=>{console.error(e.message);process.exitCode=1;});
