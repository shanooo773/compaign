import { z } from "zod";
import { type Env, HttpError } from "./runtime";
import { campaignIdleSQL } from "./campaign-archive";
import { campaignNameSQL } from "./campaign-management";

export const deletionRetention = "Immutable approvals and approved message content, sending receipts and attempts, recipient contact and reply history, and audit records are retained. This is workspace deletion, not full account erasure. Gmail messages and the Gmail connection remain.";
const idsSQL = `SELECT a.message_id FROM message_authorizations a WHERE a.campaign_id=? AND a.user_id=?
 UNION SELECT m.id FROM messages m WHERE m.user_id=? AND m.parent_id IN (SELECT message_id FROM message_authorizations WHERE campaign_id=? AND user_id=?)
 UNION SELECT f.child_id FROM followup_steps f JOIN message_authorizations a ON a.message_id=f.root_id WHERE a.campaign_id=? AND a.user_id=?`;
const scoped=(id:string,user:string)=>[id,user,user,id,user,id,user];
export async function deleteCampaignWorkspace(env:Env,user:string,id:string,body:unknown) {
 const input=z.object({confirm_name:z.string().min(1).max(160)}).parse(body);
 const campaign=await env.DB.prepare(`SELECT c.id,COALESCE(d.campaign_name,${campaignNameSQL}) name,d.state,(${campaignIdleSQL}) eligible FROM campaign_approvals c LEFT JOIN campaign_workspace_deletions d ON d.campaign_id=c.id AND d.user_id=c.user_id WHERE c.id=? AND c.user_id=?`).bind(id,user).first<any>();
 if(!campaign) throw new HttpError(404,"Campaign not found.");
 if(input.confirm_name!==campaign.name) throw new HttpError(400,"Type the exact campaign name to confirm permanent workspace deletion.");
 if(campaign.state==='deleted') return Response.json({ok:true,done:true,retained:deletionRetention});
 if(!campaign.eligible) throw new HttpError(409,"Only completed or cancelled campaigns with no pending work, in-flight sends or uncertain deliveries can be permanently deleted. This action never cancels a campaign.");
 const lease=crypto.randomUUID(),now=Date.now();
 const claim=await env.DB.prepare(`INSERT INTO campaign_workspace_deletions(campaign_id,user_id,campaign_name,state,lease,lease_until,started_at)
 SELECT c.id,c.user_id,?,'deleting',?,?,? FROM campaign_approvals c WHERE c.id=? AND c.user_id=? AND (${campaignIdleSQL})
 ON CONFLICT(campaign_id) DO UPDATE SET lease=excluded.lease,lease_until=excluded.lease_until WHERE campaign_workspace_deletions.user_id=excluded.user_id AND campaign_workspace_deletions.state='deleting' AND campaign_workspace_deletions.lease_until<=? RETURNING campaign_id`).bind(campaign.name,lease,now+60000,now,id,user,now).first();
 if(!claim) throw new HttpError(409,"A deletion is already running or the campaign state changed. Refresh and retry after one minute.");
 // At most 100 rows per resource per request. A crashed lease expires safely.
 const scope=scoped(id,user);
 await env.DB.batch([
  env.DB.prepare(`INSERT OR IGNORE INTO campaign_deletion_documents(campaign_id,user_id,document_id) SELECT ?,?,document_id FROM message_attachments WHERE user_id=? AND message_id IN (${idsSQL}) ORDER BY rowid LIMIT 100`).bind(id,user,user,...scope),
  env.DB.prepare(`DELETE FROM message_attachments WHERE rowid IN (SELECT rowid FROM message_attachments WHERE user_id=? AND message_id IN (${idsSQL}) ORDER BY rowid LIMIT 100)`).bind(user,...scope),
  env.DB.prepare(`DELETE FROM campaign_attachment_pins WHERE rowid IN (SELECT rowid FROM campaign_attachment_pins WHERE user_id=? AND root_id IN (${idsSQL}) LIMIT 100)`).bind(user,...scope),
  env.DB.prepare(`DELETE FROM notifications WHERE rowid IN (SELECT rowid FROM notifications WHERE user_id=? AND (entity_id=? OR entity_id IN (${idsSQL})) LIMIT 100)`).bind(user,id,...scope),
  env.DB.prepare("DELETE FROM campaign_display_names WHERE campaign_id=? AND user_id=?").bind(id,user),
  env.DB.prepare("DELETE FROM campaign_archives WHERE campaign_id=? AND user_id=?").bind(id,user),
  // Shared associations or pins prevent file cleanup. Nothing touches OAuth or sending ledgers.
  env.DB.prepare(`UPDATE documents SET storage_state='deleting',purge_after=?,cleanup_after=? WHERE id IN (SELECT d.id FROM documents d JOIN campaign_deletion_documents x ON x.document_id=d.id WHERE x.campaign_id=? AND x.user_id=? AND d.user_id=? AND d.storage_state='ready' AND NOT EXISTS(SELECT 1 FROM message_attachments a WHERE a.document_id=d.id) AND NOT EXISTS(SELECT 1 FROM campaign_attachment_pins p WHERE p.document_id=d.id) LIMIT 10)`).bind(now,now,id,user,user),
 ]);
 const remaining=await env.DB.prepare(`SELECT EXISTS(SELECT 1 FROM message_attachments WHERE user_id=? AND message_id IN (${idsSQL})) OR EXISTS(SELECT 1 FROM campaign_attachment_pins WHERE user_id=? AND root_id IN (${idsSQL})) OR EXISTS(SELECT 1 FROM notifications WHERE user_id=? AND (entity_id=? OR entity_id IN (${idsSQL}))) OR EXISTS(SELECT 1 FROM campaign_deletion_documents x JOIN documents d ON d.id=x.document_id WHERE x.campaign_id=? AND x.user_id=? AND d.storage_state='ready' AND NOT EXISTS(SELECT 1 FROM message_attachments a WHERE a.document_id=d.id) AND NOT EXISTS(SELECT 1 FROM campaign_attachment_pins p WHERE p.document_id=d.id)) pending`).bind(user,...scope,user,...scope,user,id,...scope,id,user).first<any>();
 // Audit insertion and completion are atomic, and completion is conditional on the lease.
 await env.DB.batch([
  env.DB.prepare("INSERT OR IGNORE INTO audit(id,user_id,action,entity_id) SELECT ?,?,'campaign.workspace_deleted',? WHERE ?=0 AND EXISTS(SELECT 1 FROM campaign_workspace_deletions WHERE campaign_id=? AND user_id=? AND lease=?)").bind('workspace-delete:'+id,user,id,remaining.pending,id,user,lease),
  env.DB.prepare("UPDATE campaign_workspace_deletions SET state=CASE WHEN ?=0 THEN 'deleted' ELSE 'deleting' END,completed_at=CASE WHEN ?=0 THEN ? ELSE NULL END,lease=NULL,lease_until=0 WHERE campaign_id=? AND user_id=? AND lease=?").bind(remaining.pending,remaining.pending,now,id,user,lease),
 ]);
 const cleanup=await env.DB.prepare("SELECT count(*) n FROM campaign_deletion_documents x JOIN documents d ON d.id=x.document_id WHERE x.campaign_id=? AND x.user_id=? AND d.storage_state='deleting'").bind(id,user).first<any>();
 return Response.json({ok:true,done:!remaining.pending,attachment_cleanup_pending:cleanup.n,retained:deletionRetention});
}
