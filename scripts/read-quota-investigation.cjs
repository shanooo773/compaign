const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),{spawnSync}=require('node:child_process');
const dir='apps/api/.wrangler';
(async()=>{
 const cfg=JSON.parse(fs.readFileSync(dir+'/management-config.json'));
 const token=/oauth_token\s*=\s*"([^"\r\n]+)"/.exec(fs.readFileSync(path.join(process.env.APPDATA,'xdg.config/.wrangler/config/default.toml'),'utf8'))?.[1];assert(token);
 const r=spawnSync(process.execPath,['node_modules/wrangler/bin/wrangler.js','d1','insights','outreach','--config',dir+'/management-config.json','--time-period','7d','--sort-by','reads','--limit','100','--json'],{encoding:'utf8',windowsHide:true,timeout:90000,maxBuffer:8e6});assert.equal(r.status,0,r.stderr);
 const queries=JSON.parse(r.stdout);fs.writeFileSync(dir+'/read-quota-insights.json',JSON.stringify(queries,null,2));
 const query=`query($accountTag: string, $filter: ZoneWorkersRequestsFilter_InputObject) { viewer { accounts(filter:{accountTag:$accountTag}) { d1AnalyticsAdaptiveGroups(limit:10000, filter:$filter) { sum { rowsRead rowsWritten readQueries writeQueries } dimensions { datetimeHour databaseId } } } } }`;
 const response=await fetch('https://api.cloudflare.com/client/v4/graphql',{method:'POST',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},body:JSON.stringify({query,variables:{accountTag:cfg.account_id,filter:{AND:[{datetimeHour_geq:new Date(Date.now()-7*86400000).toISOString(),datetimeHour_leq:new Date().toISOString()}]}}}),signal:AbortSignal.timeout(30000)});
 const metrics=await response.json();assert(response.ok&&!metrics.errors?.length,JSON.stringify(metrics.errors));
 fs.writeFileSync(dir+'/read-quota-analytics-before.json',JSON.stringify(metrics.data,null,2));
 console.log(JSON.stringify({queries:queries.length,top:queries.slice(0,6).map(q=>({sql:q.query.slice(0,70),reads:q.totalRowsRead,executions:q.numberOfTimesRun,average:q.avgRowsRead})),analyticsHours:metrics.data.viewer.accounts[0].d1AnalyticsAdaptiveGroups.length}));
})().catch(e=>{console.error(e.message);process.exitCode=1;});
