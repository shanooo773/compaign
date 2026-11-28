import { type Env, HttpError } from "./runtime";

// Include both materialized children and approved, as-yet unmaterialized steps.
export const campaignIdleSQL = `NOT EXISTS (
 SELECT 1 FROM messages m WHERE m.user_id=c.user_id AND
 m.id IN (
 SELECT message_id FROM message_authorizations WHERE user_id=c.user_id AND campaign_id=c.id
 UNION SELECT child.id FROM message_authorizations a JOIN messages child ON child.parent_id=a.message_id WHERE a.user_id=c.user_id AND a.campaign_id=c.id
 UNION SELECT f.child_id FROM followup_steps f JOIN message_authorizations a ON a.message_id=f.root_id WHERE a.user_id=c.user_id AND a.campaign_id=c.id)
 AND (m.status IN ('draft','pending') OR EXISTS (SELECT 1 FROM transports t WHERE t.message_id=m.id AND t.state IN ('leased','submitting','uncertain')))
) AND NOT EXISTS (
 SELECT 1 FROM followup_steps f JOIN message_authorizations a ON a.message_id=f.root_id
 WHERE a.user_id=c.user_id AND a.campaign_id=c.id AND f.cancel_reason IS NULL
 AND (f.queued=0 OR NOT EXISTS(SELECT 1 FROM messages child WHERE child.id=f.child_id AND child.status IN ('sent','replied','failed','cancelled')))
) AND NOT EXISTS (
 SELECT 1 FROM automation f JOIN message_authorizations a ON a.message_id=f.message_id
 WHERE a.user_id=c.user_id AND a.campaign_id=c.id AND f.generated=0 AND f.cancel_reason IS NULL
)`;

export async function archiveCampaign(env: Env, user: string, id: string, restore: boolean) {
 const campaign = await env.DB.prepare(`SELECT c.id,(${campaignIdleSQL}) can_archive FROM campaign_approvals c WHERE c.id=? AND c.user_id=?`).bind(id,user).first<any>();
 const deleted=await env.DB.prepare("SELECT 1 ok FROM campaign_workspace_deletions WHERE campaign_id=? AND user_id=?").bind(id,user).first();
 if(deleted) throw new HttpError(409,"Permanently deleted campaign workspaces cannot be archived or restored.");
 if(!campaign) throw new HttpError(404,"Campaign not found.");
 if(!restore && !campaign.can_archive) throw new HttpError(409,"Resolve pending emails, follow-ups and uncertain deliveries before archiving. Archiving never cancels sending.");
 // Recheck eligibility in the mutation to close the read/mutation race.
 const mutation=restore ? env.DB.prepare("DELETE FROM campaign_archives WHERE campaign_id=? AND user_id=?").bind(id,user)
 : env.DB.prepare(`INSERT OR IGNORE INTO campaign_archives(campaign_id,user_id,archived_at) SELECT c.id,c.user_id,? FROM campaign_approvals c WHERE c.id=? AND c.user_id=? AND (${campaignIdleSQL}) AND NOT EXISTS(SELECT 1 FROM campaign_workspace_deletions d WHERE d.campaign_id=c.id AND d.user_id=c.user_id)`).bind(Date.now(),id,user);
 const results=await env.DB.batch([mutation,env.DB.prepare("INSERT INTO audit(id,user_id,action,entity_id) SELECT ?,?,?,? WHERE changes()>0").bind(crypto.randomUUID(),user,restore?'campaign.restored':'campaign.archived',id)]);
 if(!restore && !results[0].meta.changes) {
  const archived=await env.DB.prepare("SELECT 1 ok FROM campaign_archives WHERE campaign_id=? AND user_id=?").bind(id,user).first();
  if(!archived) throw new HttpError(409,"Campaign sending state changed. Refresh before archiving.");
 }
 return Response.json({ok:true,archived:!restore});
}
