import {beforeEach,afterEach,it,expect,vi} from "vitest";
import {harness,fileForm} from "./harness";
import {passwordHash} from "../src/passwords";
import {encrypt} from "../src/oauth";
import {runLiveJobs} from "../src/automation";
import {queueSequence} from "../src/followup-sequence";
let h:ReturnType<typeof harness>,user:any,connection:string;
beforeEach(async()=>{
 h=harness(); user=await h.user("owner@example.com");connection=crypto.randomUUID();
 Object.assign(h.env,{OAUTH_ENABLED:"true",LIVE_EMAIL_ENABLED:"true",MOCK_DELIVERY_ENABLED:"false",LIVE_OWNER_USER_IDS:user.id,LIVE_TEST_RECIPIENTS:"prof@example.com",GMAIL_CLIENT_ID:"synthetic",GMAIL_CLIENT_SECRET:"synthetic",TOKEN_ENCRYPTION_KEY:btoa(String.fromCharCode(...new Uint8Array(32).fill(9)))});
 const tokens=await encrypt(h.env,user.id+":gmail:tokens:v1",{access_token:"synthetic",refresh_token:"synthetic",expires_in:3600});
 h.db.prepare("INSERT INTO connections(id,user_id,provider,address,subject,scopes,tokens,expires_at) VALUES(?,?,'gmail','owner@example.com','mailbox-identity','gmail.send gmail.readonly',?,?)").run(connection,user.id,tokens,Date.now()+864000000);
 h.db.prepare("INSERT INTO mailbox_checks(connection_id,checked_at,status,detail) VALUES(?,?,'ready','fixture')").run(connection,Date.now());
 vi.stubGlobal("fetch",()=>{throw Error("Real network forbidden");});
});
afterEach(()=>{h.db.close();vi.unstubAllGlobals();vi.useRealTimers();});
async function draft(email="prof@example.com"){
 const r=await h.request("/imports/drafts","POST",{import_id:crypto.randomUUID(),rows:[{name:"Professor Fixture",email,subject:"Research",body:"Exact approved content",scheduled_at:new Date(Date.now()+600000).toISOString(),timezone:"UTC",follow_up_sequence:JSON.stringify([{subject:"Follow-up",body:"Exact follow-up",delay_value:10,delay_unit:"minutes",relative_to:"previous"},{subject:"Final",body:"Exact final",delay_value:20,delay_unit:"minutes",relative_to:"previous"}])}]},user.session);
 expect(r.status).toBe(200);return (await r.json()).drafts[0];
}
const approve=(id:string,extra={})=>h.request("/messages/approve","POST",{ids:[id],name:"Korea GKS Fall 2027",sending_account_id:connection, without_attachments_acknowledged: true,authorize_followups:true,...extra},user.session);
const check=(ids:string[],session=user.session)=>h.request("/campaigns/duplicate-check","POST",{ids},session);
let serial=0;
function network(events:any[]=[]){return vi.fn(async(input:any)=>{const url=String(input);if(url.includes("/messages/send"))return Response.json({id:"sent-"+(++serial),threadId:"thread"});if(url.includes("/threads/"))return Response.json({messages:events});if(url.includes("/messages?"))return Response.json({messages:[]});throw Error("Unexpected provider request");});}
const reply=(labels:string[],sender="prof@example.com")=>({id:"reply",internalDate:String(Date.now()+1000),labelIds:labels,snippet:"Thank you",payload:{headers:[{name:"From",value:sender}]}});

const view=async(c:string)=> (await h.request(`/campaigns/${c}/upcoming`,"GET",undefined,user.session)).json();
const campaign=()=>h.db.prepare("SELECT id FROM campaign_approvals ORDER BY rowid DESC LIMIT 1").get()!.id as string;
const change=(row:any,extra={})=>({id:row.id,expected:row.expected,subject:row.subject,body:row.body,attachments:row.attachments.map((d:any)=>d.id),scheduled_at:row.scheduled_at,...extra});
const revise=(c:string,changes:any[],extra={})=>h.request(`/campaigns/${c}/upcoming`,"POST",{changes,confirmed:true,without_attachments_acknowledged:true,...extra},user.session);
const upload=async(name="cv.txt")=>{const r=await h.request("/documents","POST",fileForm("Synthetic CV",name),user.session);expect(r.status).toBe(200);return (await r.json()).id;};
it("opens and previews revisions without database writes",async()=>{
 const d=await draft();await approve(d.id);const c=campaign();const before=h.db.prepare("SELECT total_changes() n").get()!.n;
 const v=await view(c);expect(v.items).toHaveLength(3);expect(v.items.every((r:any)=>r.editable)).toBe(true);
 const r=await revise(c,[change(v.items[0],{subject:"Corrected"})],{dry_run:true});expect(r.status).toBe(200);
 expect(h.db.prepare("SELECT total_changes() n").get()!.n).toBe(before);
});
it("sends a newly approved CV and content through mocked Gmail while retaining original approvals",async()=>{
 const d=await draft();await approve(d.id);const c=campaign(),doc=await upload();
 const old=JSON.stringify(h.db.prepare("SELECT * FROM message_authorizations").all()),transport=JSON.stringify(h.db.prepare("SELECT snapshot FROM transports").all());
 const v=await view(c);const revised=change(v.items[0],{subject:"Corrected subject",body:"Corrected body",attachments:[doc]});
 expect((await revise(c,[revised])).status).toBe(200);
 expect(JSON.stringify(h.db.prepare("SELECT * FROM message_authorizations").all())).toBe(old);
 expect(JSON.stringify(h.db.prepare("SELECT snapshot FROM transports").all())).toBe(transport);
 expect(h.db.prepare("SELECT scheduled_at FROM messages WHERE id=?").get(d.id)!.scheduled_at).toBe(d.scheduled_at);
 const sent:any[]=[];const mock=vi.fn(async(url:any,init:any)=>{expect(String(url)).toContain('/messages/send');sent.push(Buffer.from(JSON.parse(init.body).raw,'base64url').toString());return Response.json({id:'fixture-new',threadId:'fixture-thread'});});
 vi.useFakeTimers({toFake:['Date']});vi.setSystemTime(Date.now()+660000);await runLiveJobs(h.env,mock as any);
 expect(sent).toHaveLength(1);expect(sent[0]).toContain(Buffer.from('Corrected subject').toString('base64'));expect(sent[0]).toContain(Buffer.from('Corrected body').toString('base64'));expect(sent[0]).toContain('cv.txt');expect(sent[0]).toContain(Buffer.from('Synthetic CV').toString('base64'));
 expect(h.db.prepare("SELECT count(*) n FROM deliveries").get()!.n).toBe(1);await runLiveJobs(h.env,mock as any);expect(sent).toHaveLength(1);
 const after=await view(c);expect(after.items.find((r:any)=>r.id===d.id).editable).toBe(false);
 expect((await revise(c,[revised])).status).toBe(409);
});
it("supports attachment replacement and removal with immutable version history and explicit warning",async()=>{
 const d=await draft();await approve(d.id);const c=campaign(),a=await upload('first.txt'),b=await upload('second.txt');
 for(const attachments of [[a],[b],[]]){const row=(await view(c)).items[0];const request=change(row,{attachments});
  if(!attachments.length)expect((await revise(c,[request],{without_attachments_acknowledged:false})).status).toBe(409);
  expect((await revise(c,[request])).status).toBe(200);
 }
 expect(h.db.prepare("SELECT count(*) n FROM message_revisions").get()!.n).toBe(3);
 expect(h.db.prepare("SELECT count(*) n FROM campaign_attachment_pins").get()!.n).toBe(2);
 expect(()=>h.db.exec("UPDATE message_revisions SET snapshot='{}'")).toThrow(/immutable/);
});
it.each(['leased','submitting','uncertain','confirmed'])("rejects edits to %s transports",async(state)=>{
 const d=await draft();await approve(d.id);const c=campaign(),row=(await view(c)).items[0];
 h.db.prepare("UPDATE transports SET state=? WHERE message_id=?").run(state,d.id);
 expect((await revise(c,[change(row,{body:'unsafe'})])).status).toBe(409);
 expect(h.db.prepare("SELECT count(*) n FROM message_revisions").get()!.n).toBe(0);
});
it("rejects stale revisions and blocks atomic multi-message changes when reply or cancellation arrives",async()=>{
 const d=await draft();await approve(d.id);const c=campaign(),v=await view(c),a=change(v.items[0],{subject:'v1'});
 expect((await revise(c,[a])).status).toBe(200);expect((await revise(c,[a])).status).toBe(409);
 const fresh=await view(c);h.db.prepare("UPDATE messages SET status='replied' WHERE id=?").run(d.id);
 expect((await revise(c,fresh.items.slice(1).map((r:any)=>change(r,{body:'blocked'})))).status).toBe(409);
 expect(h.db.prepare("SELECT count(*) n FROM revision_approvals").get()!.n).toBe(1);
});
it("preserves timezone and schedules unless explicitly changed; enforces future and horizon limits",async()=>{
 const d=await draft();await approve(d.id);const c=campaign(),row=(await view(c)).items[0];
 for(const scheduled_at of [new Date(Date.now()-1).toISOString(),new Date(Date.now()+61*86400000).toISOString()])expect((await revise(c,[change(row,{scheduled_at})])).status).toBe(400);
 const scheduled_at=new Date(Date.now()+1200000).toISOString();expect((await revise(c,[change(row,{scheduled_at})])).status).toBe(200);
 const r=h.db.prepare("SELECT * FROM current_message_revisions").get()!;expect(r.scheduled_at).toBe(scheduled_at);expect(r.timezone).toBe('UTC');expect(h.db.prepare("SELECT scheduled_at FROM messages WHERE id=?").get(d.id)!.scheduled_at).toBe(d.scheduled_at);
});
it("revises an unqueued follow-up and generates the revised approved snapshot",async()=>{
 const d=await draft();await approve(d.id);const c=campaign(),doc=await upload(),followup=(await view(c)).items[1];
 expect((await revise(c,[change(followup,{subject:'Revised follow-up',body:'Revised wording',attachments:[doc]})])).status).toBe(200);
 const original=h.db.prepare("SELECT subject FROM followup_steps WHERE child_id=?").get(followup.id)!.subject;expect(original).toBe('Follow-up');
 vi.useFakeTimers({toFake:['Date']});vi.setSystemTime(Date.now()+660000);await runLiveJobs(h.env,network() as any);
 vi.setSystemTime(Date.now()+660000);await queueSequence(h.env,network() as any);
 const child=h.db.prepare("SELECT * FROM messages WHERE id=?").get(followup.id)!;expect(child.subject).toBe('Revised follow-up');
 expect(JSON.parse(h.db.prepare("SELECT snapshot FROM transports WHERE message_id=?").get(followup.id)!.snapshot as string).attachments[0].id).toBe(doc);
 const provider=network();await runLiveJobs(h.env,provider as any);expect(provider.mock.calls.some((args:any)=>String(args[0]).includes('/messages/send'))).toBe(true);
});
it("rejects cross-user revision access",async()=>{
 const d=await draft();await approve(d.id);const c=campaign(),other=await h.user('other@example.com');expect((await h.request(`/campaigns/${c}/upcoming`,'GET',undefined,other.session)).status).toBe(404);
});

it.each(['claim','reply','cancel','suppress'])("atomically rejects a %s arriving between validation and revision insertion",async(event)=>{
 const d=await draft();await approve(d.id);const c=campaign(),row=(await view(c)).items[0],batch=h.env.DB.batch.bind(h.env.DB);let inject=true;
 h.env.DB.batch=async(statements:any)=>{if(inject&&statements.some((s:any)=>s._sql.startsWith('INSERT INTO revision_approvals'))){inject=false;
  if(event==='claim')h.db.prepare("UPDATE transports SET state='leased',lease='race' WHERE message_id=?").run(d.id);
  if(event==='reply')h.db.prepare("UPDATE messages SET status='replied' WHERE id=?").run(d.id);
  if(event==='cancel')await h.request(`/campaigns/${c}/cancel`,'POST',{},user.session);
  if(event==='suppress')h.db.prepare("INSERT INTO suppressions(user_id,address,reason) VALUES(?,'prof@example.com','opt_out')").run(user.id);
 }return batch(statements);};
 expect((await revise(c,[change(row,{body:'must not apply'})])).status).toBe(409);
 expect(h.db.prepare("SELECT count(*) n FROM revision_approvals").get()!.n).toBe(0);expect(h.db.prepare("SELECT count(*) n FROM message_revisions").get()!.n).toBe(0);
});
it("edits only eligible messages in a campaign with sent initial email",async()=>{
 const d=await draft();await approve(d.id);const c=campaign();vi.useFakeTimers({toFake:['Date']});vi.setSystemTime(Date.now()+660000);await runLiveJobs(h.env,network() as any);
 const v=await view(c);expect(v.items[0].editable).toBe(false);expect(v.items[1].editable).toBe(true);
 const sent=JSON.stringify(h.db.prepare("SELECT * FROM deliveries").all());expect((await revise(c,[change(v.items[1],{subject:'Future follow-up correction'})])).status).toBe(200);expect(JSON.stringify(h.db.prepare("SELECT * FROM deliveries").all())).toBe(sent);
});

it("prevents a revised follow-up preceding its initial email or a reschedule creating a backlog",async()=>{
 const d=await draft();await approve(d.id);const c=campaign(),v=await view(c),followup=v.items[1];
 expect((await revise(c,[change(followup,{scheduled_at:new Date(Date.now()+300000).toISOString()})])).status).toBe(400);
 const fixed=new Date(Date.now()+1200000).toISOString();expect((await revise(c,[change(followup,{scheduled_at:fixed})])).status).toBe(200);
 const initial=(await view(c)).items[0];expect((await revise(c,[change(initial,{scheduled_at:new Date(Date.now()+1800000).toISOString()})])).status).toBe(400);
});
it("performs zero idle scheduler writes with future approved revisions",async()=>{
 const d=await draft();await approve(d.id);const c=campaign(),row=(await view(c)).items[0];expect((await revise(c,[change(row,{subject:'Revised pending'})])).status).toBe(200);
 const before=h.db.prepare('SELECT total_changes() n').get()!.n;
 for(let tick=0;tick<9;tick++){await queueSequence(h.env,network() as any);await runLiveJobs(h.env,network() as any);}
 expect(h.db.prepare('SELECT total_changes() n').get()!.n).toBe(before);
});

it("retains revision audit during workspace deletion but allows explicit full account erasure",async()=>{
 const d=await draft();await approve(d.id);const c=campaign(),doc=await upload(),row=(await view(c)).items[0];expect((await revise(c,[change(row,{attachments:[doc]})])).status).toBe(200);
 await h.request(`/campaigns/${c}/cancel`,'POST',{},user.session);
 expect((await h.request(`/campaigns/${c}/delete`,'POST',{confirm_name:'Korea GKS Fall 2027'},user.session)).status).toBe(200);
 expect(h.db.prepare('SELECT count(*) n FROM revision_approvals').get()!.n).toBe(1);
 const password='Synthetic-passphrase-39';h.db.prepare('UPDATE users SET password=? WHERE id=?').run(await passwordHash(password),user.id); // gitleaks:allow -- synthetic in-memory test password; network is forbidden.
 const result=await h.request('/account/delete','POST',{current_password:password,confirmation:'DELETE MY ACCOUNT'},user.session);expect(result.status).toBe(200);
 expect(h.db.prepare('SELECT count(*) n FROM message_revisions').get()!.n).toBe(0);expect(h.db.prepare('SELECT count(*) n FROM revision_approvals').get()!.n).toBe(0);expect(h.db.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
});
