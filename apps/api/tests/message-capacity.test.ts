import { beforeEach, afterEach, it, expect, vi } from "vitest";
import { harness } from "./harness";
import { readFileSync } from "node:fs";
import { MESSAGE_CAPACITY } from "../../../shared/message-capacity";
let h:ReturnType<typeof harness>, user:any;
beforeEach(async()=>{h=harness();user=await h.user();h.db.prepare("UPDATE users SET email_verified_at=? WHERE id=?").run(Date.now(),user.id);vi.stubGlobal("fetch",()=>{throw Error("Network forbidden");});});
afterEach(()=>{h.db.close();vi.unstubAllGlobals();});
function seed(count:number,status="draft",owner=user.id){
 const p=crypto.randomUUID();h.db.prepare("INSERT INTO professors(id,user_id,name,email) VALUES(?,?,?,?)").run(p,owner,"Fixture",p+"@example.com");
 const insert=h.db.prepare("INSERT INTO messages(id,user_id,professor_id,subject,body,mode,status,scheduled_at,timezone) VALUES(?,?,?,'Subject','Body','manual',?,'2027-01-01T00:00:00Z','UTC')");
 for(let i=0;i<count;i++)insert.run(crypto.randomUUID(),owner,p,status);
}
const usage=()=>h.db.prepare("SELECT count(*) n FROM active_message_capacity WHERE user_id=?").get(user.id)!.n;
const rows=()=>Array.from({length:16},(_,i)=>({name:"Professor "+i,email:"prof"+i+"@example.com",subject:"Research inquiry",body:"Fixture content",scheduled_at:"2027-01-01T00:00:00Z",timezone:"UTC",follow_up_sequence:JSON.stringify(Array.from({length:5},()=>({subject:"Follow-up",body:"Fixture follow-up",delay_value:1,delay_unit:"days",relative_to:"previous"})))}));
it("reproduces the original 100-row blocker then imports 96 potential messages with historical rows intact",async()=>{
 // Restore only the original policy to reproduce the reported rejection.
 h.db.exec("DROP TRIGGER message_capacity; CREATE TRIGGER message_capacity BEFORE INSERT ON messages WHEN (SELECT count(*) FROM messages WHERE user_id=NEW.user_id)>=100 OR (SELECT count(*) FROM messages)>=1000 BEGIN SELECT RAISE(ABORT,'Message storage quota reached'); END;");
 seed(100,"sent");
 const input={import_id:crypto.randomUUID(),rows:rows()};
 expect((await h.request("/imports/drafts","POST",input,user.session)).status).toBe(429);
 expect(h.db.prepare("SELECT count(*) n FROM messages").get()!.n).toBe(100);
 h.db.exec("DROP VIEW active_message_capacity; DROP TRIGGER message_capacity_update; DROP TRIGGER followup_steps_capacity; DROP TRIGGER automation_capacity; DROP TRIGGER automation_capacity_update;");
 h.db.exec(readFileSync(new URL("../migrations/0018_active_message_capacity.sql",import.meta.url),"utf8"));
 const response=await h.request("/imports/drafts","POST",input,user.session);expect(response.status).toBe(200);
 expect((await response.json()).drafts).toHaveLength(16);expect(usage()).toBe(96);
 expect(h.db.prepare("SELECT count(*) n FROM messages WHERE status='sent'").get()!.n).toBe(100);
 expect((await h.request("/imports/drafts","POST",input,user.session)).status).toBe(200);expect(usage()).toBe(96);
});
it("allows 100 existing active messages plus a 96-message import",async()=>{seed(100);expect((await h.request("/imports/drafts","POST",{import_id:crypto.randomUUID(),rows:rows()},user.session)).status).toBe(200);expect(usage()).toBe(196);});
it("accepts 400 and rejects 401 atomically, with independent student capacity",async()=>{
 seed(400);expect(usage()).toBe(400);expect(()=>seed(1)).toThrow("Message storage quota reached");
 const other=await h.user("other@example.com");seed(400,"draft",other.id);expect(usage()).toBe(400);
 const r=await h.request("/capacity","GET",undefined,user.session);expect(r.status).toBe(200);expect(await r.json()).toMatchObject({student:400,global:4000,student_used:400,student_available:0,global_used:800});
});
it("reserves all follow-ups and rolls back an import exceeding 400",async()=>{seed(305);const before=h.db.prepare("SELECT count(*) n FROM professors").get()!.n;expect((await h.request("/imports/drafts","POST",{import_id:crypto.randomUUID(),rows:rows()},user.session)).status).toBe(429);expect(usage()).toBe(305);expect(h.db.prepare("SELECT count(*) n FROM professors").get()!.n).toBe(before);});
it("enforces a finite global 4000 limit across ten full accounts",async()=>{
 seed(400);for(let i=0;i<9;i++){const u=await h.user("student"+i+"@example.com");seed(400,"draft",u.id);}
 const extra=await h.user("eleventh@example.com");expect(()=>seed(1,"draft",extra.id)).toThrow("Message storage quota reached");expect(h.db.prepare("SELECT count(*) n FROM active_message_capacity").get()!.n).toBe(4000);
},120000);
it.each(["sent","replied","failed","cancelled"])("retains %s history without consuming active capacity",status=>{seed(100,status);expect(usage()).toBe(0);seed(400);expect(usage()).toBe(400);});
it("draft deletion and cancellation free slots without deleting history",()=>{seed(400);h.db.exec("UPDATE messages SET status='cancelled' WHERE id=(SELECT id FROM messages LIMIT 1)");expect(usage()).toBe(399);seed(1);h.db.exec("DELETE FROM messages WHERE id=(SELECT id FROM messages WHERE status='draft' LIMIT 1)");expect(usage()).toBe(399);expect(h.db.prepare("SELECT count(*) n FROM messages WHERE status='cancelled'").get()!.n).toBe(1);});
it("keeps the generated database policy consistent with shared public limits",()=>{const sql=readFileSync(new URL("../migrations/0018_active_message_capacity.sql",import.meta.url),"utf8");expect(sql).toContain(")>"+MESSAGE_CAPACITY.student);expect(sql).toContain(")>"+MESSAGE_CAPACITY.global);});

it("the frontend preflight enforces available student/global capacity and permits idempotent retry", async()=>{
 const {checkMessageCapacity}=await import("../../../shared/message-capacity");
 expect(()=>checkMessageCapacity({student_available:96,global_available:96},96)).not.toThrow();
 expect(()=>checkMessageCapacity({student_available:95,global_available:4000},96)).toThrow("Active message capacity");
 expect(()=>checkMessageCapacity({student_available:400,global_available:95},96)).toThrow("Active message capacity");
 expect(()=>checkMessageCapacity({student_available:0,global_available:0,existing_import:true},96)).not.toThrow();
 const input={import_id:crypto.randomUUID(),rows:rows()};await h.request("/imports/drafts","POST",input,user.session);
 expect(await (await h.request("/capacity?import_id="+input.import_id,"GET",undefined,user.session)).json()).toMatchObject({existing_import:true,student_used:96});
 const other=await h.user("isolated@example.com");h.db.prepare("UPDATE users SET email_verified_at=? WHERE id=?").run(Date.now(),other.id);
 expect(await (await h.request("/capacity?import_id="+input.import_id,"GET",undefined,other.session)).json()).toMatchObject({existing_import:false,student_used:0});
});
