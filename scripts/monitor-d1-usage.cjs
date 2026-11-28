// Read-only admin monitor. Stores aggregate observations locally; never writes D1.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
(async()=>{
 const dir='apps/api/.wrangler',cfg=JSON.parse(fs.readFileSync(dir+'/management-config.json','utf8'));
 const token=/oauth_token\s*=\s*"([^"\r\n]+)"/.exec(fs.readFileSync(path.join(process.env.APPDATA,'xdg.config/.wrangler/config/default.toml'),'utf8'))?.[1];assert(token);
 const now=new Date(),start=new Date(now);start.setUTCHours(0,0,0,0);
 const query=`query($accountTag: string, $filter: ZoneWorkersRequestsFilter_InputObject) { viewer { accounts(filter:{accountTag:$accountTag}) { d1AnalyticsAdaptiveGroups(limit:10000, filter:$filter) { sum { rowsRead rowsWritten readQueries writeQueries } dimensions { datetimeHour } } } } }`;
 const r=await fetch('https://api.cloudflare.com/client/v4/graphql',{method:'POST',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},body:JSON.stringify({query,variables:{accountTag:cfg.account_id,filter:{AND:[{datetimeHour_geq:start.toISOString(),datetimeHour_leq:now.toISOString()}]}}}),signal:AbortSignal.timeout(20000)});
 const j=await r.json();assert(r.ok&&!j.errors?.length,'Cloudflare analytics unavailable; usage unknown');
 const rows=j.data.viewer.accounts[0].d1AnalyticsAdaptiveGroups;
 const read=rows.reduce((n,r)=>n+r.sum.rowsRead,0);
 const written=rows.reduce((n,r)=>n+r.sum.rowsWritten,0);
 const previousFile=dir+'/d1-usage-observation.json';let previous;try{previous=JSON.parse(fs.readFileSync(previousFile,'utf8'));}catch{}
 const elapsed=previous?(now-Date.parse(previous.observedAt))/60000:0;
 const rate=previous?.utcDay===start.toISOString()&&elapsed>=1?Math.max(0,written-previous.accountRowsWritten)/elapsed:null;
 const result={observedAt:now.toISOString(),utcDay:start.toISOString(),scope:'all D1 databases in account',accountRowsRead:read,accountRowsWritten:written,readWarning:read>=4000000?"Daily reads approach or exceed 4,000,000":null,reportedHours:rows.length,writeRatePerMinute:rate,warning:written>=80000?'Daily writes approach or exceed 80,000':rate!==null&&rate>50?'Unusually high observed write rate':null,analyticsMayLag:true};
 fs.writeFileSync(previousFile,JSON.stringify(result,null,2));console.log(JSON.stringify(result));
 if(result.warning||result.readWarning)process.exitCode=2;
})().catch(()=>{console.error('Read-only D1 usage monitoring failed; no database changes made.');process.exitCode=1;});
