import {beforeEach,afterEach,it,expect,vi} from "vitest";
import {harness} from "./harness";
import {encrypt} from "../src/oauth";
import {runLiveJobs,syncReplies} from "../src/automation";
import {queueSequence} from "../src/followup-sequence";
import {emailProvider} from "../src/providers";
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
 const r=await h.request("/imports/drafts","POST",{import_id:crypto.randomUUID(),rows:[{name:"Professor Fixture",email,subject:"Research",body:"Exact approved content",scheduled_at:new Date(Date.now()-1000).toISOString(),timezone:"UTC",follow_up_sequence:JSON.stringify([{subject:"Follow-up",body:"Exact follow-up",delay_value:1,delay_unit:"minutes",relative_to:"previous"},{subject:"Final",body:"Exact final",delay_value:2,delay_unit:"minutes",relative_to:"previous"}])}]},user.session);
 expect(r.status).toBe(200);return (await r.json()).drafts[0];
}
const approve=(id:string,extra={})=>h.request("/messages/approve","POST",{ids:[id],name:"Korea GKS Fall 2027",sending_account_id:connection, without_attachments_acknowledged: true,authorize_followups:true,...extra},user.session);
const check=(ids:string[],session=user.session)=>h.request("/campaigns/duplicate-check","POST",{ids},session);
let serial=0;
function network(events:any[]=[]){return vi.fn(async(input:any)=>{const url=String(input);if(url.includes("/messages/send"))return Response.json({id:"sent-"+(++serial),threadId:"thread"});if(url.includes("/threads/"))return Response.json({messages:events});if(url.includes("/messages?"))return Response.json({messages:[]});throw Error("Unexpected provider request");});}
const reply=(labels:string[],sender="prof@example.com")=>({id:"reply",internalDate:String(Date.now()+1000),labelIds:labels,snippet:"Thank you",payload:{headers:[{name:"From",value:sender}]}});
it.each([[["INBOX"]],[["SPAM"]],[["TRASH"]],[[]],[["Label_custom"]],[["INBOX","Label_custom"]],[["SPAM","Label_custom"]],[["TRASH","SPAM"]]])("detects replies with labels %j, persists location and cancels every remaining step",async(labels)=>{
 const d=await draft();expect((await approve(d.id)).status).toBe(200);await runLiveJobs(h.env,network() as any);
 const provider=network([reply(labels)]);await syncReplies(h.env,provider as any,user.id,d.id);
 expect(h.db.prepare("SELECT status FROM messages WHERE id=?").get(d.id)!.status).toBe("replied");
 expect(h.db.prepare("SELECT count(*) n FROM followup_steps WHERE cancel_reason='reply'").get()!.n).toBe(2);
 const warning=labels.includes("SPAM") || labels.includes("TRASH");
 expect(h.db.prepare("SELECT count(*) n FROM notifications WHERE kind='reply_warning'").get()!.n).toBe(+warning);
 await syncReplies(h.env,provider as any,user.id,d.id);
 expect(h.db.prepare("SELECT count(*) n FROM mailbox_events").get()!.n).toBe(1);
 const state=await (await h.request("/state","GET",undefined,user.session)).json();
 expect(state.reply_locations).toHaveLength(1);expect(state.notifications.some((n:any)=>n.message.includes("Korea GKS Fall 2027"))).toBe(true);
});
it("updates folder warnings without duplicating the reply or resetting read state",async()=>{
 const d=await draft();await approve(d.id);await runLiveJobs(h.env,network() as any);
 await syncReplies(h.env,network([reply(["SPAM"])]) as any,user.id,d.id);
 await h.request("/notifications/read","POST",{},user.session);
 await syncReplies(h.env,network([reply(["INBOX","Label_custom"])]) as any,user.id,d.id);
 expect(h.db.prepare("SELECT count(*) n FROM notifications WHERE kind='reply_warning'").get()!.n).toBe(0);
 expect(h.db.prepare("SELECT count(*) n FROM notifications WHERE read=0").get()!.n).toBe(0);
 expect(h.db.prepare("SELECT location FROM reply_locations").get()!.location).toBe("Inbox");
 expect(h.db.prepare("SELECT count(*) n FROM mailbox_events").get()!.n).toBe(1);
});
it.each(["unrelated@example.com","owner@example.com"])("rejects unrelated or owner messages from %s",async(sender)=>{
 const d=await draft();await approve(d.id);await runLiveJobs(h.env,network() as any);await syncReplies(h.env,network([reply(["INBOX"],sender)]) as any,user.id,d.id);
 expect(h.db.prepare("SELECT status FROM messages WHERE id=?").get(d.id)!.status).toBe("sent");expect(h.db.prepare("SELECT count(*) n FROM mailbox_events").get()!.n).toBe(0);
});
it("rejects SENT messages even when the sender matches the recipient",async()=>{
 const d=await draft();await approve(d.id);await runLiveJobs(h.env,network() as any);await syncReplies(h.env,network([reply(["SENT"])]) as any,user.id,d.id);
 expect(h.db.prepare("SELECT count(*) n FROM mailbox_events").get()!.n).toBe(0);
});
it("finds a cross-thread reference in Spam and follows list pagination",async()=>{
 const api=emailProvider("gmail",(async(input:any)=>{const u=new URL(String(input));if(u.pathname.includes("/threads/"))return Response.json({messages:[]});if(u.pathname.endsWith("/messages")){expect(u.searchParams.get("includeSpamTrash")).toBe("true");return Response.json({messages:[{id:"inbound"}],nextPageToken:u.searchParams.has("pageToken")?undefined:"page-2"});}return Response.json({...reply(["SPAM"]),id:"inbound",threadId:"separate",payload:{headers:[{name:"From",value:"prof@example.com"},{name:"References",value:"<approved@example.com>"}]}});}) as any);
 const context={recipient:"prof@example.com",key:"approved@example.com",sentAt:new Date(Date.now()-60000).toISOString()};const page=await api.replies("synthetic","outbound",null,context);expect(page.events).toHaveLength(1);expect(page.cursor).toBe("page-2");expect((await api.replies("synthetic","outbound",page.cursor,context)).cursor).toBeNull();
});
it("requires separate duplicate acknowledgment and audits the exact history",async()=>{
 const first=await draft();await approve(first.id);const next=await draft();let review=await (await check([next.id])).json();expect(review.history[0]).toMatchObject({address:"prof@example.com",status:"pending",submitted:0});
 expect((await approve(next.id)).status).toBe(409);expect((await approve(next.id,{duplicate_acknowledgement:"stale"})).status).toBe(409);
 expect((await approve(next.id,{duplicate_acknowledgement:review.acknowledgement})).status).toBe(200);
 expect(h.db.prepare("SELECT count(*) n FROM audit WHERE action='campaign.duplicate_override'").get()!.n).toBe(1);
 expect(h.db.prepare("SELECT count(*) n FROM campaign_duplicate_reviews WHERE acknowledged=1").get()!.n).toBe(1);
 expect((await approve(next.id,{duplicate_acknowledgement:review.acknowledgement})).status).toBe(409);
});
it("allows changing recipients and does not count draft-only or cancelled unsent messages as contacted",async()=>{
 const a=await draft();const b=await draft("PROF@example.com");expect((await (await check([b.id])).json()).history).toHaveLength(0);
 await approve(a.id);await h.request(`/campaigns/${h.db.prepare("SELECT id FROM campaign_approvals").get()!.id}/cancel`,"POST",{},user.session);
 expect((await (await check([b.id])).json()).history[0]).toMatchObject({status:"cancelled",submitted:0});
});
it("warns for replied and previously submitted recipients, normalizes case, isolates ownership",async()=>{
 const a=await draft();await approve(a.id);await runLiveJobs(h.env,network() as any);await syncReplies(h.env,network([reply(["INBOX"])]) as any,user.id,a.id);
 const b=await draft("PROF@example.com");expect((await (await check([b.id])).json()).history[0]).toMatchObject({status:"replied",submitted:1});
 const other=await h.user("other@example.com");expect((await check([b.id],other.session)).status).toBe(404);
 expect((await (await h.request("/state","GET",undefined,other.session)).json()).notifications).toHaveLength(0);
});
it("closes simultaneous approval races",async()=>{
 const a=await draft(),b=await draft();const results=await Promise.all([approve(a.id),approve(b.id)]);expect(results.map(r=>r.status).sort()).toEqual([200,409]);expect(h.db.prepare("SELECT count(*) n FROM campaign_approvals").get()!.n).toBe(1);
});
it("renames display metadata while preserving immutable approved content and schedule",async()=>{
 const d=await draft();await approve(d.id);const c=h.db.prepare("SELECT * FROM campaign_approvals").get()!;const before=JSON.stringify(h.db.prepare("SELECT * FROM message_authorizations").all());
 expect((await h.request(`/campaigns/${c.id}/name`,"POST",{name:"Germany Robotics"},user.session)).status).toBe(200);
 expect(JSON.stringify(h.db.prepare("SELECT * FROM message_authorizations").all())).toBe(before);expect(h.db.prepare("SELECT name FROM campaign_approvals").get()!.name).toBe("Korea GKS Fall 2027");
 const other=await h.user("other@example.com");expect((await h.request(`/campaigns/${c.id}/name`,"POST",{name:"Stolen"},other.session)).status).toBe(404);
 const state=await (await h.request("/state","GET",undefined,user.session)).json();expect(state.campaigns[0].name).toBe("Germany Robotics");
});
function attempts(id:string,count:number){
 const historical=crypto.randomUUID();
 h.db.prepare("INSERT INTO messages(id,user_id,professor_id,subject,body,mode,status,scheduled_at,timezone) SELECT ?,user_id,professor_id,subject,body,mode,'sent',scheduled_at,timezone FROM messages WHERE id=?").run(historical,id);
 h.db.prepare("INSERT INTO transports(message_id,user_id,connection_id,snapshot,state) SELECT ?,user_id,connection_id,snapshot,'confirmed' FROM transports WHERE message_id=?").run(historical,id);
 for(let i=0;i<count;i++)h.db.prepare("INSERT INTO delivery_attempts(id,message_id,attempt,started_at,outcome) VALUES(?,?,?,?, 'confirmed')").run(crypto.randomUUID(),historical,i+1,Date.now()-6*3600000+i*61000);}
it.each([49,50])("enforces %i prior submissions using a genuine rolling window and postpones approved work",async(count)=>{
 const d=await draft();await approve(d.id);attempts(d.id,count);const provider=network();await runLiveJobs(h.env,provider as any);
 const t=h.db.prepare("SELECT * FROM transports WHERE message_id=?").get(d.id)!;
 if(count===49){expect(provider).toHaveBeenCalledTimes(1);expect(h.db.prepare("SELECT count(*) n FROM outgoing_submissions").get()!.n).toBe(50);}else{expect(provider).not.toHaveBeenCalled();expect(t.state).toBe("waiting");expect(t.attempts).toBe(0);expect(t.next_at).toBeGreaterThan(Date.now());expect(h.db.prepare("SELECT status FROM messages WHERE id=?").get(d.id)!.status).toBe("pending");}
 const usage=await (await h.request("/sending/usage","GET",undefined,user.session)).json();expect(usage.sent).toBe(50);expect(usage.remaining).toBe(0);
});
it("blocks the 51st submission atomically and releases allowance only after 24 hours",async()=>{
 const d=await draft();await approve(d.id);attempts(d.id,50);const insert=()=>h.db.prepare("INSERT INTO delivery_attempts(id,message_id,attempt,started_at,outcome) VALUES(?,?,51,?,'submitting')").run(crypto.randomUUID(),d.id,Date.now());expect(insert).toThrow(/Rolling sending allowance/);
 h.db.prepare("UPDATE delivery_attempts SET started_at=? WHERE attempt=1").run(Date.now()-86400000);expect(insert).not.toThrow();
});
it("keeps exact one-minute pacing across a calendar-minute boundary",async()=>{
 const d=await draft();await approve(d.id);h.db.prepare("INSERT INTO delivery_attempts(id,message_id,attempt,started_at,outcome) VALUES(?,?,1,?,'confirmed')").run(crypto.randomUUID(),d.id,Date.now()-59000);
 const provider=network();await runLiveJobs(h.env,provider as any);expect(provider).not.toHaveBeenCalled();expect(h.db.prepare("SELECT state FROM transports").get()!.state).toBe("waiting");
});

it("shares mailbox allowance across users and user allowance across mailboxes",async()=>{
 const d=await draft();await approve(d.id);attempts(d.id,50);
 const other=await h.user("mailbox-alias@example.com"),second=crypto.randomUUID(),message=crypto.randomUUID();
 h.db.prepare("INSERT INTO connections(id,user_id,provider,address,subject,scopes,expires_at) VALUES(?,?,'gmail','owner@example.com','mailbox-identity','gmail.send',9999999999999)").run(second,other.id);
 const otherProfessor=crypto.randomUUID();h.db.prepare("INSERT INTO professors(id,user_id,name,email) VALUES(?,?,'Other professor','prof@example.com')").run(otherProfessor,other.id);
 h.db.prepare("INSERT INTO messages(id,user_id,professor_id,subject,body,mode,status,scheduled_at,timezone) SELECT ?,?,?,subject,body,mode,'pending',scheduled_at,timezone FROM messages WHERE id=?").run(message,other.id,otherProfessor,d.id);
 h.db.prepare("INSERT INTO transports(message_id,user_id,connection_id,snapshot) SELECT ?,?,?,snapshot FROM transports WHERE message_id=?").run(message,other.id,second,d.id);
 const insert=()=>h.db.prepare("INSERT INTO delivery_attempts(id,message_id,attempt,started_at,outcome) VALUES(?,?,1,?,'submitting')").run(crypto.randomUUID(),message,Date.now());
 expect(insert).toThrow(/Rolling sending allowance/);
 const third=crypto.randomUUID(),thirdMessage=crypto.randomUUID();
 h.db.prepare("INSERT INTO connections(id,user_id,provider,address,subject,scopes,expires_at) VALUES(?,?,'gmail','different@example.com','different-mailbox','gmail.send',9999999999999)").run(third,user.id);
 h.db.prepare("INSERT INTO messages(id,user_id,professor_id,subject,body,mode,status,scheduled_at,timezone) SELECT ?,user_id,professor_id,subject,body,mode,'pending',scheduled_at,timezone FROM messages WHERE id=?").run(thirdMessage,d.id);
 h.db.prepare("INSERT INTO transports(message_id,user_id,connection_id,snapshot) SELECT ?,?,?,snapshot FROM transports WHERE message_id=?").run(thirdMessage,user.id,third,d.id);
 expect(()=>h.db.prepare("INSERT INTO delivery_attempts(id,message_id,attempt,started_at,outcome) VALUES(?,?,1,?,'submitting')").run(crypto.randomUUID(),thirdMessage,Date.now())).toThrow(/Rolling sending allowance/);
});
it("does not claim failed unsent outreach was contacted and never overrides suppressions",async()=>{
 const first=await draft();await approve(first.id);h.db.prepare("UPDATE messages SET status='failed' WHERE id=?").run(first.id);h.db.prepare("UPDATE transports SET state='failed' WHERE message_id=?").run(first.id);
 const next=await draft();expect((await(await check([next.id])).json()).history).toHaveLength(0);
 h.db.prepare("INSERT INTO suppressions(user_id,address,reason) VALUES(?,'prof@example.com','opt_out')").run(user.id);
 expect((await approve(next.id,{duplicate_acknowledgement:'deliberate'})).status).toBe(409);
});
it("paginates campaign activity and rejects another user's campaign",async()=>{
 const d=await draft();const result=await(await approve(d.id)).json();
 for(let i=0;i<110;i++)h.db.prepare("INSERT INTO audit(id,user_id,action,entity_id) VALUES(?,?,'fixture',?)").run(crypto.randomUUID(),user.id,result.campaign_id);
 const page=await(await h.request(`/campaigns/${result.campaign_id}/activity`,'GET',undefined,user.session)).json();expect(page.activity).toHaveLength(100);expect(page.has_more).toBe(true);
 const next=await(await h.request(`/campaigns/${result.campaign_id}/activity?before=${page.next_cursor}`,'GET',undefined,user.session)).json();expect(next.activity.length).toBeGreaterThan(0);expect(next.has_more).toBe(false);
 const other=await h.user('other@example.com');expect((await h.request(`/campaigns/${result.campaign_id}/activity`,'GET',undefined,other.session)).status).toBe(404);
});
it("fails closed when folder-inclusive Gmail listing fails",async()=>{
 const d=await draft();await approve(d.id);await runLiveJobs(h.env,network() as any);
 const provider=vi.fn(async(input:any)=>String(input).includes('/threads/')?Response.json({messages:[]}):new Response(null,{status:503}));
 expect(await syncReplies(h.env,provider as any,user.id,d.id)).toBe(false);expect(h.db.prepare('SELECT sync_checked_at FROM transports WHERE message_id=?').get(d.id)!.sync_checked_at).toBe(0);
 expect(h.db.prepare('SELECT status FROM messages WHERE id=?').get(d.id)!.status).toBe('sent');
});

it("marks the original recipient Replied when the reply arrives on a follow-up",async()=>{
 const d=await draft();await approve(d.id);await runLiveJobs(h.env,network() as any);
 vi.useFakeTimers({toFake:['Date']});vi.setSystemTime(Date.now()+61000);
 await queueSequence(h.env,network() as any);await runLiveJobs(h.env,network() as any);
 const child=h.db.prepare("SELECT m.id FROM messages m JOIN transports t ON t.message_id=m.id WHERE m.parent_id=? AND t.state='confirmed'").get(d.id)!;expect(child).toBeTruthy();
 await syncReplies(h.env,network([reply(['TRASH'])]) as any,user.id,String(child.id));
 expect(h.db.prepare('SELECT status FROM messages WHERE id=?').get(d.id)!.status).toBe('replied');
 expect(h.db.prepare('SELECT count(*) n FROM followup_steps WHERE cancel_reason IS NULL').get()!.n).toBe(0);
});

it("keeps direct manual/automatic creation unapproved until the shared campaign approval",async()=>{
 const imported=await draft();const r=await h.request('/messages','POST',{professor_id:imported.professor_id,subject:'Separate manual inquiry',body:'Exact content',mode:'manual',authorized:false,scheduled_at:new Date(Date.now()-1000).toISOString(),timezone:'UTC',attachments:[],sending_account_id:connection, without_attachments_acknowledged: true},user.session);
 expect(r.status).toBe(200);const created=await r.json();expect(h.db.prepare('SELECT status,approved FROM messages WHERE id=?').get(created.id)).toMatchObject({status:'draft',approved:0});
 const denied=await h.request('/messages','POST',{professor_id:imported.professor_id,subject:'Direct auto',body:'Exact content',mode:'auto',authorized:true,scheduled_at:new Date(Date.now()-1000).toISOString(),timezone:'UTC',attachments:[],sending_account_id:connection, without_attachments_acknowledged: true},user.session);expect(denied.status).toBe(400);
 const provider=network();await runLiveJobs(h.env,provider as any);expect(provider).not.toHaveBeenCalled();
 expect((await approve(created.id)).status).toBe(200);
});


it("archives and restores a completed campaign without changing history or schedules", async()=>{
 const d=await draft();const approved=await (await approve(d.id)).json();
 const campaign=h.db.prepare("SELECT campaign_id id FROM message_authorizations WHERE message_id=?").get(d.id)!.id as string;
 await runLiveJobs(h.env,network() as any);await syncReplies(h.env,network([reply(["INBOX"])]) as any,user.id,d.id);
 const before=h.db.prepare("SELECT * FROM messages ORDER BY id").all();
 expect((await h.request(`/campaigns/${campaign}/archive`,"POST",{},user.session)).status).toBe(200);
 expect(h.db.prepare("SELECT count(*) n FROM campaign_archives").get()!.n).toBe(1);
 expect(h.db.prepare("SELECT * FROM messages ORDER BY id").all()).toEqual(before);
 expect((await h.request(`/campaigns/${campaign}/archive`,"POST",{},user.session)).status).toBe(200);
 expect(h.db.prepare("SELECT count(*) n FROM audit WHERE action='campaign.archived'").get()!.n).toBe(1);
 expect((await h.request(`/campaigns/${campaign}/restore`,"POST",{},user.session)).status).toBe(200);
 expect(h.db.prepare("SELECT count(*) n FROM campaign_archives").get()!.n).toBe(0);
 expect(h.db.prepare("SELECT * FROM messages ORDER BY id").all()).toEqual(before);
});
it("rejects archiving active initial emails and preserves approved schedules",async()=>{
 const d=await draft();await approve(d.id);
 const campaign=h.db.prepare("SELECT campaign_id id FROM message_authorizations WHERE message_id=?").get(d.id)!.id as string;
 const before=h.db.prepare("SELECT * FROM messages").all();
 expect((await h.request(`/campaigns/${campaign}/archive`,"POST",{},user.session)).status).toBe(409);
 expect(h.db.prepare("SELECT * FROM messages").all()).toEqual(before);
});
it("rejects archiving pending conditional follow-ups",async()=>{
 const d=await draft();await approve(d.id);await runLiveJobs(h.env,network() as any);
 const campaign=h.db.prepare("SELECT campaign_id id FROM message_authorizations WHERE message_id=?").get(d.id)!.id as string;
 expect((await h.request(`/campaigns/${campaign}/archive`,"POST",{},user.session)).status).toBe(409);
});
it("archives cancelled campaigns, rejects other owners and keeps duplicate history",async()=>{
 const d=await draft();await approve(d.id);await runLiveJobs(h.env,network() as any);
 const campaign=h.db.prepare("SELECT campaign_id id FROM message_authorizations WHERE message_id=?").get(d.id)!.id as string;
 expect((await h.request(`/campaigns/${campaign}/cancel`,"POST",{},user.session)).status).toBe(200);
 const other=await h.user("archive-other@example.invalid");
 expect((await h.request(`/campaigns/${campaign}/archive`,"POST",{},other.session)).status).toBe(404);
 expect((await h.request(`/campaigns/${campaign}/restore`,"POST",{},other.session)).status).toBe(404);
 expect((await h.request(`/campaigns/${campaign}/archive`,"POST",{},user.session)).status).toBe(200);
 const next=await draft();const history=await (await check([next.id])).json();
 expect(history.history.some((r:any)=>r.message_id===d.id)).toBe(true);
});
it.each(['leased','submitting','uncertain'])("rejects archiving a cancelled campaign with %s delivery",async(state)=>{
 const d=await draft();await approve(d.id);
 const campaign=h.db.prepare("SELECT campaign_id id FROM message_authorizations WHERE message_id=?").get(d.id)!.id as string;
 await h.request(`/campaigns/${campaign}/cancel`,"POST",{},user.session);
 h.db.prepare("UPDATE transports SET state=? WHERE message_id=?").run(state,d.id);
 expect((await h.request(`/campaigns/${campaign}/archive`,"POST",{},user.session)).status).toBe(409);
});

const campaignFor=(id:string)=>h.db.prepare("SELECT campaign_id id FROM message_authorizations WHERE message_id=?").get(id)!.id as string;
const remove=(id:string,session=user.session,name="Korea GKS Fall 2027")=>h.request(`/campaigns/${id}/delete`,"POST",{confirm_name:name},session);
it("permanently deletes cancelled workspace data but retains immutable audits and Gmail",async()=>{
 const d=await draft();await approve(d.id);const campaign=campaignFor(d.id);
 await h.request(`/campaigns/${campaign}/cancel`,"POST",{},user.session);
 h.db.prepare("INSERT INTO notifications(id,user_id,kind,message,entity_id) VALUES('delete-note',?,'test','fixture',?)").run(user.id,d.id);
 const approvals=h.db.prepare("SELECT * FROM campaign_approvals").all(),auth=h.db.prepare("SELECT * FROM message_authorizations").all();
 expect((await remove(campaign)).status).toBe(200);
 expect(h.db.prepare("SELECT state FROM campaign_workspace_deletions").get()!.state).toBe('deleted');
 expect(h.db.prepare("SELECT count(*) n FROM notifications WHERE id='delete-note'").get()!.n).toBe(0);
 expect(h.db.prepare("SELECT * FROM campaign_approvals").all()).toEqual(approvals);
 expect(h.db.prepare("SELECT * FROM message_authorizations").all()).toEqual(auth);
 expect(h.db.prepare("SELECT count(*) n FROM connections WHERE id=?").get(connection)!.n).toBe(1);
 expect((await remove(campaign)).status).toBe(200);
 expect(h.db.prepare("SELECT count(*) n FROM audit WHERE action='campaign.workspace_deleted'").get()!.n).toBe(1);
 expect((await h.request(`/campaigns/${campaign}/restore`,"POST",{},user.session)).status).toBe(409);
});
it("requires exact deliberate deletion confirmation and rejects cross-user deletion",async()=>{
 const d=await draft();await approve(d.id);const campaign=campaignFor(d.id);
 await h.request(`/campaigns/${campaign}/cancel`,"POST",{},user.session);
 expect((await remove(campaign,user.session,'wrong')).status).toBe(400);
 expect((await h.request(`/campaigns/${campaign}/delete`,"POST",{},user.session)).status).toBe(400);
 const other=await h.user('delete-other@example.invalid');expect((await remove(campaign,other.session)).status).toBe(404);
 expect(h.db.prepare("SELECT count(*) n FROM campaign_workspace_deletions").get()!.n).toBe(0);
});
it("rejects deleting pending emails and conditional follow-ups without cancelling anything",async()=>{
 const d=await draft();await approve(d.id);const campaign=campaignFor(d.id);
 expect((await remove(campaign)).status).toBe(409);
 await runLiveJobs(h.env,network() as any);
 expect((await remove(campaign)).status).toBe(409);
 expect(h.db.prepare("SELECT count(*) n FROM followup_steps WHERE cancel_reason IS NOT NULL").get()!.n).toBe(0);
});
it.each(['leased','submitting','uncertain'])("rejects deleting unresolved %s deliveries",async(state)=>{
 const d=await draft();await approve(d.id);const campaign=campaignFor(d.id);
 await h.request(`/campaigns/${campaign}/cancel`,"POST",{},user.session);
 h.db.prepare("UPDATE transports SET state=? WHERE message_id=?").run(state,d.id);
 expect((await remove(campaign)).status).toBe(409);
});
it("deletes completed workspaces while retaining rolling usage, receipts and duplicate detection",async()=>{
 const d=await draft();await approve(d.id);const campaign=campaignFor(d.id);
 await runLiveJobs(h.env,network() as any);await syncReplies(h.env,network([reply(['INBOX'])]) as any,user.id,d.id);
 const ledger=h.db.prepare("SELECT * FROM outgoing_submissions").all(),receipts=h.db.prepare("SELECT * FROM deliveries").all();
 expect((await remove(campaign)).status).toBe(200);
 expect(h.db.prepare("SELECT * FROM outgoing_submissions").all()).toEqual(ledger);
 expect(h.db.prepare("SELECT * FROM deliveries").all()).toEqual(receipts);
 const next=await draft();expect((await (await check([next.id])).json()).history.some((r:any)=>r.message_id===d.id)).toBe(true);
});
it("bounds cleanup and safely resumes repeated requests",async()=>{
 const d=await draft();await approve(d.id);const campaign=campaignFor(d.id);
 await h.request(`/campaigns/${campaign}/cancel`,"POST",{},user.session);
 for(let n=0;n<230;n++)h.db.prepare("INSERT INTO notifications(id,user_id,kind,message,entity_id) VALUES(?,?,'test','fixture',?)").run('bounded-'+n,user.id,d.id);
 let result=await (await remove(campaign)).json();expect(result.done).toBe(false);
 expect(h.db.prepare("SELECT count(*) n FROM notifications WHERE entity_id=?").get(d.id)!.n).toBe(130);
 result=await (await remove(campaign)).json();expect(result.done).toBe(false);
 result=await (await remove(campaign)).json();expect(result.done).toBe(true);
});
it("rejects concurrent deletion claims and permits expired-lease recovery",async()=>{
 const d=await draft();await approve(d.id);const campaign=campaignFor(d.id);
 await h.request(`/campaigns/${campaign}/cancel`,"POST",{},user.session);
 h.db.prepare("INSERT INTO campaign_workspace_deletions VALUES(?,?,'Korea GKS Fall 2027','deleting','other',?,?,NULL)").run(campaign,user.id,Date.now()+60000,Date.now());
 expect((await remove(campaign)).status).toBe(409);
 h.db.prepare("UPDATE campaign_workspace_deletions SET lease_until=0").run();
 expect((await remove(campaign)).status).toBe(200);
});

it("preserves shared attachments and queues only unreferenced files for cleanup",async()=>{
 const d=await draft();await approve(d.id);const campaign=campaignFor(d.id);
 await h.request(`/campaigns/${campaign}/cancel`,"POST",{},user.session);
 const other=await draft('shared@example.invalid');
 for(const id of ['shared-doc','private-doc']){
  h.db.prepare("INSERT INTO documents(id,user_id,name,object_key,content_type,size,storage_backend,storage_state,expires_at) VALUES(?,?,?,?,'application/pdf',3,'kv','ready',?)").run(id,user.id,id,id,Date.now()+86400000);
  h.bytes.set(id,new Uint8Array([1,2,3]).buffer);
  h.db.prepare("INSERT INTO message_attachments(message_id,document_id,user_id) VALUES(?,?,?)").run(d.id,id,user.id);
 }
 h.db.prepare("INSERT INTO message_attachments(message_id,document_id,user_id) VALUES(?,?,?)").run(other.id,'shared-doc',user.id);
 const result=await (await remove(campaign)).json();expect(result.done).toBe(true);expect(result.attachment_cleanup_pending).toBe(1);
 expect(h.db.prepare("SELECT storage_state FROM documents WHERE id='shared-doc'").get()!.storage_state).toBe('ready');
 expect(h.db.prepare("SELECT storage_state FROM documents WHERE id='private-doc'").get()!.storage_state).toBe('deleting');
 const {cleanDocuments}=await import('../src/storage');await cleanDocuments(h.env);
 expect(h.bytes.has('private-doc')).toBe(false);expect(h.bytes.has('shared-doc')).toBe(true);
 expect(h.db.prepare("SELECT storage_state FROM documents WHERE id='private-doc'").get()!.storage_state).toBe('deleted');
});

it("stops scanning deleted completed workspaces so removed notifications stay removed",async()=>{
 const d=await draft();await approve(d.id);const campaign=campaignFor(d.id);
 await runLiveJobs(h.env,network() as any);await syncReplies(h.env,network([reply(['SPAM'])]) as any,user.id,d.id);
 expect((await remove(campaign)).status).toBe(200);
 const provider=network([reply(['SPAM'])]);await syncReplies(h.env,provider as any,user.id,d.id);
 expect(provider).not.toHaveBeenCalled();
 expect(h.db.prepare("SELECT count(*) n FROM notifications WHERE entity_id=?").get(d.id)!.n).toBe(0);
});

it("reconciles Gmail acceptance after a D1 receipt-write failure without submitting twice",async()=>{
 const d=await draft();await approve(d.id);
 const originalBatch=h.env.DB.batch.bind(h.env.DB);let failReceipt=true;
 h.env.DB.batch=(async(statements:any[])=>{
  if(failReceipt && statements.some(s=>s._sql.includes('INSERT OR IGNORE INTO deliveries'))){failReceipt=false;throw Error("D1_ERROR: Your account has exceeded D1's free tier daily row write limit.");}
  return originalBatch(statements);
 }) as any;
 let sends=0;
 const provider=vi.fn(async(input:any)=>{
  const url=String(input);
  if(url.includes('/messages/send')){sends++;return Response.json({id:'accepted-before-d1-failure',threadId:'thread'});}
  if(url.includes('rfc822msgid'))return Response.json({messages:[{id:'accepted-before-d1-failure'}]});
  if(url.includes('/messages/accepted-before-d1-failure'))return Response.json({id:'accepted-before-d1-failure',threadId:'thread',internalDate:String(Date.now())});
  throw Error('Unexpected fixture request');
 });
 await runLiveJobs(h.env,provider as any);
 expect(h.db.prepare("SELECT state FROM transports WHERE message_id=?").get(d.id)!.state).toBe('uncertain');
 h.db.prepare("UPDATE transports SET next_at=0 WHERE message_id=?").run(d.id);
 await runLiveJobs(h.env,provider as any);
 expect(sends).toBe(1);
 expect(h.db.prepare("SELECT state FROM transports WHERE message_id=?").get(d.id)!.state).toBe('confirmed');
 expect(h.db.prepare("SELECT provider_id FROM deliveries WHERE message_id=?").get(d.id)!.provider_id).toBe(connection+':accepted-before-d1-failure');
});
it("stops a quota-blocked cron before Gmail and does not retry D1 writes in a loop",async()=>{
 const d=await draft();await approve(d.id);let writes=0;
 const original=h.env.DB.prepare.bind(h.env.DB);
 h.env.DB.prepare=((sql:string)=>{
  if(sql.includes('INSERT INTO scheduler_health')){const statement:any={bind:()=>statement,run:async()=>{writes++;throw Error("D1_ERROR: daily row write limit");}};return statement;}
  return original(sql);
 }) as any;
 const worker=(await import('../src/index')).default;
 await expect(worker.scheduled({scheduledTime:Date.now()} as any,h.env)).rejects.toThrow('daily row write limit');
 expect(writes).toBe(1);expect(h.db.prepare("SELECT count(*) n FROM deliveries").get()!.n).toBe(0);
 expect(h.db.prepare("SELECT state FROM transports WHERE message_id=?").get(d.id)!.state).toBe('waiting');
});

it("supports full account erasure after audit-retaining workspace and attachment deletion",async()=>{
 const d=await draft();await approve(d.id);const campaign=campaignFor(d.id);
 await h.request(`/campaigns/${campaign}/cancel`,"POST",{},user.session);
 h.db.prepare("INSERT INTO documents(id,user_id,name,object_key,content_type,size,storage_backend,storage_state,expires_at) VALUES('erasure-doc',?,'private.pdf','erasure-object','application/pdf',3,'kv','ready',?)").run(user.id,Date.now()+86400000);
 h.db.prepare("INSERT INTO message_attachments VALUES(?,'erasure-doc',?)").run(d.id,user.id);
 expect((await remove(campaign)).status).toBe(200);
 const {passwordHash}=await import('../src/passwords');const password='Maple river lantern planets 47';
 h.db.prepare("UPDATE users SET password=? WHERE id=?").run(await passwordHash(password),user.id);
 const other=await h.user('erasure-survivor@example.invalid');

 const response=await h.request('/account/delete','POST',{current_password:password,confirmation:'DELETE MY ACCOUNT'},user.session);
 expect(response.status).toBe(200);
 for(const table of ['campaign_deletion_documents','campaign_workspace_deletions','campaign_approvals','message_authorizations','messages','documents','connections'])expect(h.db.prepare(`SELECT count(*) n FROM ${table}`).get()!.n).toBe(0);
 expect(h.db.prepare('SELECT id FROM users').get()!.id).toBe(other.id);
 expect(h.db.prepare('PRAGMA foreign_key_check').all()).toHaveLength(0);
});

it("requires explicit no-document consent and stores it with the new approval",async()=>{
 const d=await draft();
 expect((await approve(d.id,{without_attachments_acknowledged:false})).status).toBe(409);
 const preview=await (await approve(d.id,{dry_run:true,without_attachments_acknowledged:false})).json();
 expect(preview.missing_attachments).toEqual([{id:d.id,address:"prof@example.com"}]);
 expect(h.db.prepare("SELECT count(*) n FROM campaign_approvals").get()!.n).toBe(0);
 expect((await approve(d.id)).status).toBe(200);
 expect(JSON.parse(h.db.prepare("SELECT selection FROM campaign_approvals").get()!.selection as string)[0].without_attachments_acknowledged).toBe(true);
 expect(h.db.prepare("SELECT count(*) n FROM audit WHERE action='campaign.without_attachments_acknowledged'").get()!.n).toBe(1);
});
it("deletes only explicitly confirmed unapproved draft rows and keeps shared documents",async()=>{
 const d=await draft(),other=await draft("second@example.com");
 const doc=crypto.randomUUID();h.db.prepare("INSERT INTO documents(id,user_id,name,object_key,content_type,size,storage_backend,storage_state,expires_at) VALUES(?,?,'cv.txt',?,'text/plain',1,'kv','ready',?)").run(doc,user.id,doc,Date.now()+86400000);
 for(const m of [d,other])h.db.prepare("INSERT INTO message_attachments(message_id,user_id,document_id) VALUES(?,?,?)").run(m.id,user.id,doc);
 const body={ids:[d.id],confirm_name:"Draft campaign for Professor Fixture"};
 const stranger=await h.user("stranger@example.com");expect((await h.request("/campaigns/delete-draft","POST",body,stranger.session)).status).toBe(404);
 expect((await h.request("/campaigns/delete-draft","POST",{...body,confirm_name:"wrong"},user.session)).status).toBe(400);
 expect((await h.request("/campaigns/delete-draft","POST",body,user.session)).status).toBe(200);
 expect(h.db.prepare("SELECT id FROM messages WHERE id=?").get(d.id)).toBeUndefined();
 expect(h.db.prepare("SELECT id FROM messages WHERE id=?").get(other.id)).toBeDefined();
 expect(h.db.prepare("SELECT storage_state FROM documents WHERE id=?").get(doc)!.storage_state).toBe("ready");
 expect(h.db.prepare("SELECT count(*) n FROM message_attachments WHERE document_id=?").get(doc)!.n).toBe(1);
});
it("blocks draft deletion atomically if any selected message has an approval",async()=>{
 const a=await draft(),b=await draft();await approve(a.id);
 const before=JSON.stringify(h.db.prepare("SELECT * FROM messages ORDER BY id").all());
 expect((await h.request("/campaigns/delete-draft","POST",{ids:[a.id,b.id],confirm_name:"Draft campaign for Professor Fixture"},user.session)).status).toBe(409);
 expect(JSON.stringify(h.db.prepare("SELECT * FROM messages ORDER BY id").all())).toBe(before);
});
it("keeps cancelled imports retired and allows independent replacement identities with duplicate consent",async()=>{
 const a=await draft();await approve(a.id);const old=h.db.prepare("SELECT * FROM campaign_approvals").get()!;
 await h.request(`/campaigns/${old.id}/cancel`,"POST",{},user.session);
 const baseline=JSON.stringify(h.db.prepare("SELECT * FROM message_authorizations").all());
 const b=await draft();expect(b.id).not.toBe(a.id);
 const history=await (await check([b.id])).json();expect(history.history[0]).toMatchObject({status:"cancelled",submitted:0});
 expect((await approve(b.id)).status).toBe(409);expect((await approve(b.id,{duplicate_acknowledgement:history.acknowledgement})).status).toBe(200);
 expect(h.db.prepare("SELECT status FROM messages WHERE id=?").get(a.id)!.status).toBe("cancelled");
 expect(JSON.stringify(h.db.prepare("SELECT * FROM message_authorizations WHERE message_id=?").all(a.id))).toBe(baseline);
 expect(h.db.prepare("SELECT count(DISTINCT campaign_id) n FROM message_authorizations").get()!.n).toBe(2);
});

it("marks a cancelled or deleted import retired without modifying its original jobs",async()=>{
 const import_id=crypto.randomUUID(),rows=[{name:'Reuse fixture',email:'prof@example.com',subject:'Research',body:'Content',scheduled_at:new Date(Date.now()+86400000).toISOString(),timezone:'UTC'}];
 const submit=()=>h.request('/imports/drafts','POST',{import_id,rows},user.session);
 const original=(await (await submit()).json()).drafts[0];await approve(original.id);const c=h.db.prepare('SELECT id FROM campaign_approvals').get()!.id;
 await h.request(`/campaigns/${c}/cancel`,'POST',{},user.session);
 const before=JSON.stringify(h.db.prepare('SELECT * FROM messages').all());
 const retired=await (await submit()).json();expect(retired.can_start_new_import).toBe(true);expect(retired.created).toBe(0);expect(retired.drafts[0].status).toBe('cancelled');
 expect(JSON.stringify(h.db.prepare('SELECT * FROM messages').all())).toBe(before);
 expect((await h.request(`/campaigns/${c}/delete`,'POST',{confirm_name:'Korea GKS Fall 2027'},user.session)).status).toBe(200);
 expect((await (await submit()).json()).can_start_new_import).toBe(true);
 const replacement=await (await h.request('/imports/drafts','POST',{import_id:crypto.randomUUID(),rows},user.session)).json();expect(replacement.created).toBe(1);expect(replacement.drafts[0].id).not.toBe(original.id);
 h.db.prepare("INSERT INTO suppressions(user_id,address,reason) VALUES(?,'prof@example.com','opt_out')").run(user.id);
 expect((await approve(replacement.drafts[0].id)).status).toBe(409);
});
it("warns only for initial emails missing attachments, including follow-up-only selections",async()=>{
 const a=await draft(),b=await draft('second@example.com');h.env.LIVE_TEST_RECIPIENTS='prof@example.com,second@example.com';
 const upload=await h.request('/documents','POST',new FormData(),user.session);expect(upload.status).not.toBe(200);
 const id=crypto.randomUUID();h.db.prepare("INSERT INTO documents(id,user_id,name,object_key,content_type,size,storage_backend,storage_state,checksum,expires_at) VALUES(?,?,'cv.txt',?,'text/plain',1,'kv','ready',?,?)").run(id,user.id,id,await crypto.subtle.digest('SHA-256',new TextEncoder().encode('x')).then(b=>Array.from(new Uint8Array(b),n=>n.toString(16).padStart(2,'0')).join('')),Date.now()+86400000);h.bytes.set(id,new TextEncoder().encode('x').buffer);
 const selection={initial:[],followups:{'1':[id]},recipients:{[a.id]:{initial:[id],followups:{}}}};
 const preview=await (await h.request('/messages/approve','POST',{ids:[a.id,b.id],sending_account_id:connection,authorize_followups:true,dry_run:true,attachment_selection:selection},user.session)).json();
 expect(preview.missing_attachments).toEqual([{id:b.id,address:'second@example.com'}]);
});

it("accounts for approval, cancellation, archive/restore and workspace deletion while preserving immutable history",async()=>{
 const usage=()=>h.db.prepare("SELECT count(*) n FROM active_message_capacity WHERE user_id=?").get(user.id)!.n;
 const d=await draft();expect(usage()).toBe(3);
 expect((await approve(d.id)).status).toBe(200);expect(usage()).toBe(3);
 const campaign=String(h.db.prepare("SELECT id FROM campaign_approvals").get()!.id);
 const approvals=h.db.prepare("SELECT * FROM message_authorizations").all();
 expect((await h.request(`/campaigns/${campaign}/cancel`,"POST",{},user.session)).status).toBe(200);expect(usage()).toBe(0);
 for(const action of ["archive","restore"]){
  expect((await h.request(`/campaigns/${campaign}/${action}`,"POST",{},user.session)).status).toBe(200);expect(usage()).toBe(0);
 }
 expect((await h.request(`/campaigns/${campaign}/delete`,"POST",{confirm_name:"Korea GKS Fall 2027"},user.session)).status).toBe(200);
 expect(usage()).toBe(0);expect(h.db.prepare("SELECT * FROM message_authorizations").all()).toEqual(approvals);
 expect(h.db.prepare("SELECT status FROM messages WHERE id=?").get(d.id)!.status).toBe("cancelled");
 expect(h.db.prepare("SELECT count(*) n FROM followup_steps WHERE cancel_reason IS NOT NULL").get()!.n).toBe(2);
});
it("counts uncertain delivery once and transfers sequence reservation to its queued message at full capacity",async()=>{
 const d=await draft();await approve(d.id);
 await runLiveJobs(h.env,network() as any);
 const usage=()=>h.db.prepare("SELECT count(*) n FROM active_message_capacity WHERE user_id=?").get(user.id)!.n;
 expect(usage()).toBe(2);
 for(let i=0;i<398;i++)h.db.prepare("INSERT INTO messages(id,user_id,professor_id,subject,body,mode,scheduled_at,timezone) VALUES(?,?,?,'s','b','manual','2027-01-01','UTC')").run(crypto.randomUUID(),user.id,d.professor_id);
 expect(usage()).toBe(400);
 vi.useFakeTimers({toFake:["Date"]});vi.setSystemTime(Date.now()+121000);
 await queueSequence(h.env,network() as any);expect(usage()).toBe(400);
 const child=h.db.prepare("SELECT child_id FROM followup_steps WHERE queued=1").get()!;
 expect(child).toBeTruthy();
 h.db.prepare("UPDATE transports SET state='uncertain' WHERE message_id=?").run(child.child_id);expect(usage()).toBe(400);
 expect(h.db.prepare("SELECT count(*) n FROM active_message_capacity WHERE slot=?").get("message:"+child.child_id)!.n).toBe(1);
});

it("continues an hourly background group after a reply so later threads are checked in the same sweep",async()=>{
 h.env.LIVE_TEST_RECIPIENTS="prof@example.com,other@example.com";
 const one=await draft(),two=await draft("other@example.com");
 expect((await approve(one.id)).status).toBe(200);expect((await approve(two.id)).status).toBe(200);
 await runLiveJobs(h.env,network() as any);
 vi.useFakeTimers({toFake:["Date"]});vi.setSystemTime(Date.now()+61000);
 await runLiveJobs(h.env,network() as any);
 h.db.prepare("UPDATE transports SET next_sync=0,sync_checked_at=0 WHERE message_id=?").run(one.id);
 h.db.prepare("UPDATE transports SET next_sync=1,sync_checked_at=0,thread_id='other-thread' WHERE message_id=?").run(two.id);
 await syncReplies(h.env,network([reply(["INBOX"])]) as any,undefined,[one.id,two.id],Date.now()+3600000);
 expect(h.db.prepare("SELECT status FROM messages WHERE id=?").get(one.id)!.status).toBe("replied");
 expect(Number(h.db.prepare("SELECT sync_checked_at FROM transports WHERE message_id=?").get(two.id)!.sync_checked_at)).toBeGreaterThan(0);
});
