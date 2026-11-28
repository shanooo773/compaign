import {it,expect,vi,afterEach} from "vitest";
import worker from "../src/index";
import {harness} from "./harness";
import {scheduleWork,d1QuotaError,quotaBlocked,backoffQuota} from "../src/read-quota";
afterEach(()=>{vi.useRealTimers();vi.unstubAllGlobals();});
it("runs 1440 idle minute ticks with 24 reply sweeps and no mailbox calls",async()=>{
 const h=harness();Object.assign(h.env,{MOCK_DELIVERY_ENABLED:"false",OAUTH_ENABLED:"true",LIVE_EMAIL_ENABLED:"true",TOKEN_ENCRYPTION_KEY:"unused",LIVE_TEST_RECIPIENTS:"synthetic@example.invalid"});
 vi.useFakeTimers();vi.setSystemTime(new Date('2026-11-22T00:00:00Z'));
 const network=vi.fn(()=>{throw Error('External network forbidden');});vi.stubGlobal('fetch',network);
 const before=Number(h.db.prepare('SELECT total_changes() n').get()!.n);
 try{
 let hourly=0;
 for(let minute=0;minute<1440;minute++){
  const time=Date.parse('2026-11-22T00:00:00Z')+minute*60000;vi.setSystemTime(time);
  hourly+=+scheduleWork(time).replies;
  await worker.scheduled({scheduledTime:time} as any,h.env);
 }
 expect(hourly).toBe(24);expect(network).not.toHaveBeenCalled();
 expect(h.flags.writes).toBe(24);expect(h.flags.deletes).toBe(24);
 expect(Number(h.db.prepare('SELECT total_changes() n').get()!.n)-before).toBe(2880);
 }finally{h.db.close();}
},30000); // A full day of scheduler ticks needs headroom on shared CI runners.
it("backs off persisted D1 read exhaustion across environments and recovers after UTC reset",async()=>{
 const h=harness();vi.useFakeTimers();vi.setSystemTime(new Date('2026-11-22T20:00:00Z'));
 try{
 expect(d1QuotaError(Error('D1_ERROR: daily row read limit'))).toBe(true);
 expect(d1QuotaError(Error('Gmail temporary failure'))).toBe(false);
 await backoffQuota(h.env);expect(await quotaBlocked(h.env)).toBe(true);
 expect(await quotaBlocked({...h.env})).toBe(true);
 vi.setSystemTime(new Date('2026-11-23T00:01:01Z'));expect(await quotaBlocked(h.env)).toBe(false);
 }finally{h.db.close();}
});


it("sends ten professors across two students once under concurrent minute executions and preserves schedules",async()=>{
 const {encrypt}=await import("../src/oauth");const {runLiveJobs}=await import("../src/automation");
 const h=harness();vi.useFakeTimers({toFake:["Date"]});const start=Date.now();
 const users=[await h.user("one@example.com"),await h.user("two@example.com")];
 Object.assign(h.env,{MOCK_DELIVERY_ENABLED:"false",OAUTH_ENABLED:"true",LIVE_EMAIL_ENABLED:"true",LIVE_OWNER_USER_IDS:users.map(u=>u.id).join(","),LIVE_TEST_RECIPIENTS:Array.from({length:10},(_,i)=>"prof"+i+"@example.com").join(","),GMAIL_CLIENT_ID:"synthetic",GMAIL_CLIENT_SECRET:"synthetic",TOKEN_ENCRYPTION_KEY:Buffer.alloc(32,9).toString("base64")});
 const calls:string[]=[];
 const network=vi.fn(async(input:any)=>{expect(String(input)).toContain("/messages/send");const id="receipt-"+calls.length;calls.push(id);return Response.json({id,threadId:"thread-"+id});});
 try{
 for(let u=0;u<2;u++){
  const connection=crypto.randomUUID(),tokens=await encrypt(h.env,users[u].id+":gmail:tokens:v1",{access_token:"synthetic",refresh_token:"synthetic",expires_in:3600});
  h.db.prepare("INSERT INTO connections(id,user_id,provider,address,subject,scopes,tokens,expires_at) VALUES(?,?,'gmail',?,?,'gmail.send gmail.readonly',?,?)").run(connection,users[u].id,"student"+u+"@example.com","mailbox"+u,tokens,start+86400000);
  h.db.prepare("INSERT INTO mailbox_checks(connection_id,checked_at,status,detail) VALUES(?,?,'ready','fixture')").run(connection,start);
  const imported=await h.request("/imports/drafts","POST",{import_id:crypto.randomUUID(),rows:Array.from({length:5},(_,i)=>({name:"Professor "+(u*5+i),email:"prof"+(u*5+i)+"@example.com",subject:"Synthetic inquiry",body:"Approved synthetic body",scheduled_at:new Date(start+(i+1)*60000).toISOString(),timezone:"UTC"}))},users[u].session);
  expect(imported.status).toBe(200);const drafts=(await imported.json()).drafts;
  const approved=await h.request("/messages/approve","POST",{ids:drafts.map((d:any)=>d.id),name:u?"China fixture":"Korea fixture",sending_account_id:connection,without_attachments_acknowledged:true},users[u].session);expect(approved.status).toBe(200);
 }
 const schedules=h.db.prepare("SELECT id,scheduled_at FROM messages ORDER BY id").all();
 for(let minute=0;minute<15;minute++){vi.setSystemTime(start+minute*60000+1);await Promise.all([runLiveJobs(h.env,network as any),runLiveJobs(h.env,network as any)]);}
 expect(calls).toHaveLength(10);expect(h.db.prepare("SELECT count(*) n FROM deliveries").get()!.n).toBe(10);
 expect(h.db.prepare("SELECT count(*) n FROM messages WHERE status='sent'").get()!.n).toBe(10);
 expect(h.db.prepare("SELECT id,scheduled_at FROM messages ORDER BY id").all()).toEqual(schedules);
 expect(h.db.prepare("SELECT count(*) n FROM campaign_approvals").get()!.n).toBe(2);
 }finally{h.db.close();}
});
