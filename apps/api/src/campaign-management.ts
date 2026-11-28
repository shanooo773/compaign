import { z } from "zod";
import { type Env, HttpError, hash } from "./runtime";
export const campaignNameSQL = "COALESCE((SELECT n.name FROM campaign_display_names n WHERE n.campaign_id=c.id AND n.user_id=c.user_id),NULLIF(NULLIF(trim(c.name),''),'Professor outreach campaign'),'Existing Campaign ? ' || date(c.approved_at/1000,'unixepoch'))";
export async function duplicateHistory(env: Env,user: string,ids: string[]) {
 const rows = await env.DB.prepare(`SELECT old.*,COALESCE(${campaignNameSQL},'Previous outreach') campaign_name,p.name professor_name,
 EXISTS(SELECT 1 FROM followup_steps f WHERE f.root_id=old.message_id AND f.cancel_reason IS NULL AND f.queued=0) active_followups
 FROM contacted_initials old LEFT JOIN campaign_approvals c ON c.id=old.campaign_id AND c.user_id=old.user_id JOIN messages m ON m.id=old.message_id JOIN professors p ON p.id=m.professor_id
 WHERE old.user_id=? AND (old.submitted=1 OR old.status IN ('pending','cancelled')) AND old.message_id NOT IN (SELECT value FROM json_each(?))
 AND old.address IN (SELECT lower(trim(COALESCE(m.approved_recipient,p.email))) FROM messages m JOIN professors p ON p.id=m.professor_id WHERE m.user_id=? AND m.id IN (SELECT value FROM json_each(?))) ORDER BY old.address,old.message_id`)
 .bind(user,JSON.stringify(ids),user,JSON.stringify(ids)).all<any>();
 const history=rows.results;
 return {history, acknowledgement:await hash(JSON.stringify(history))};
}
export async function duplicatePreview(env:Env,user:string,body:unknown){
 const {ids}=z.object({ids:z.array(z.string().uuid()).min(1).max(25)}).parse(body);
 const count=await env.DB.prepare("SELECT count(*) n FROM messages WHERE user_id=? AND id IN (SELECT value FROM json_each(?))").bind(user,JSON.stringify([...new Set(ids)])).first<any>();
 if(count.n!==new Set(ids).size) throw new HttpError(404,"Message not found.");
 return Response.json(await duplicateHistory(env,user,ids));
}
export async function renameCampaign(env:Env,user:string,id:string,body:unknown){
 const deleted=await env.DB.prepare("SELECT 1 ok FROM campaign_workspace_deletions WHERE campaign_id=? AND user_id=?").bind(id,user).first();
 if(deleted) throw new HttpError(409,"A deleted campaign workspace cannot be renamed.");
 const {name}=z.object({name:z.string().trim().min(1).max(160)}).parse(body);
 const exists=await env.DB.prepare("SELECT 1 ok FROM campaign_approvals WHERE id=? AND user_id=?").bind(id,user).first();
 if(!exists) throw new HttpError(404,"Campaign not found.");
 await env.DB.batch([
 env.DB.prepare("INSERT INTO campaign_display_names(campaign_id,user_id,name,updated_at) VALUES(?,?,?,?) ON CONFLICT(campaign_id) DO UPDATE SET name=excluded.name,updated_at=excluded.updated_at WHERE campaign_display_names.user_id=excluded.user_id").bind(id,user,name,Date.now()),
 env.DB.prepare("INSERT INTO audit(id,user_id,action,entity_id) VALUES(?,?,'campaign.renamed',?)").bind(crypto.randomUUID(),user,id)]);
 return Response.json({ok:true,name});
}
export async function sendingUsage(env:Env,user:string){
 const now=Date.now();
 const accounts=await env.DB.prepare(`SELECT c.id,c.address,c.provider,c.subject FROM connections c WHERE c.user_id=? AND c.status='connected'`).bind(user).all<any>();
 const usage=await env.DB.prepare("SELECT count(*) sent,MIN(started_at)+86400000 next_available_at,MAX(started_at)+60000 pacing_available_at FROM outgoing_submissions WHERE user_id=? AND started_at>?").bind(user,now-86400000).first<any>();
 const mailboxes=[];
 for(const c of accounts.results){
 const row=await env.DB.prepare("SELECT count(*) sent,MIN(started_at)+86400000 next_available_at,MAX(started_at)+60000 pacing_available_at FROM outgoing_submissions WHERE provider=? AND mailbox=? AND started_at>?").bind(c.provider,c.subject,now-86400000).first<any>();
 mailboxes.push({connection_id:c.id,address:c.address,...row,remaining:Math.max(0,50-row.sent)});
 }
 return {limit:50,window_hours:24,...usage,remaining:Math.max(0,50-usage.sent),mailboxes};
}
