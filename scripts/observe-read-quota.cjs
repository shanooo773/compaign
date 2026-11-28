// Read-only natural Worker observations. Retain aggregate outcomes only, never log payloads.
const fs=require('node:fs'),{spawn}=require('node:child_process');
const child=spawn(process.execPath,['node_modules/wrangler/bin/wrangler.js','tail','ms-professor-outreach-api','--config','apps/api/.wrangler/management-config.json','--format','json'],{windowsHide:true,stdio:['ignore','pipe','pipe']});
const summary={startedAt:new Date().toISOString(),events:0,scheduled:0,outcomes:{},errors:{quota:0,gmail:0,oauth:0,other:0}};
let buffer='';
child.stdout.on('data',chunk=>{buffer+=chunk.toString();let start=-1,depth=0,string=false,escaped=false;
 for(let i=0;i<buffer.length;i++){const c=buffer[i];if(start<0){if(c==='{'){start=i;depth=1;}continue;}if(string){if(escaped)escaped=false;else if(c==='\\')escaped=true;else if(c==='"')string=false;continue;}if(c==='"')string=true;else if(c==='{')depth++;else if(c==='}'&&--depth===0){try{const event=JSON.parse(buffer.slice(start,i+1));summary.events++;if(event.event?.cron)summary.scheduled++;const outcome=event.outcome||'unknown';summary.outcomes[outcome]=(summary.outcomes[outcome]||0)+1;for(const e of event.exceptions||[]){const s=String(e.message||'');summary.errors[/daily.*(?:read|write)|row (?:read|write) limit|D1.*quota/i.test(s)?'quota':/gmail/i.test(s)?'gmail':/oauth|token/i.test(s)?'oauth':'other']++;}}catch{}buffer=buffer.slice(i+1);i=-1;start=-1;}}
 if(buffer.length>2000000)buffer='';
});
child.stderr.on('data',()=>{});
setTimeout(()=>child.kill(),130000);
child.on('close',code=>{summary.finishedAt=new Date().toISOString();summary.tailExitCode=code;fs.writeFileSync('apps/api/.wrangler/read-quota-observation.json',JSON.stringify(summary,null,2));console.log(JSON.stringify(summary));});
