import { type Env, HttpError } from "./runtime";
export async function cancelCampaign(env: Env, user: string, id: string) {
  const campaign = await env.DB.prepare(
    "SELECT id FROM campaign_approvals WHERE id=? AND user_id=?",
  )
    .bind(id, user)
    .first();
  if (!campaign) throw new HttpError(404, "Campaign not found.");
  const roots =
    "SELECT message_id FROM message_authorizations WHERE campaign_id=? AND user_id=?";
  await env.DB.batch([
    env.DB.prepare(
      `UPDATE followup_steps SET cancel_reason=COALESCE(cancel_reason,'campaign_cancelled') WHERE root_id IN (${roots})`,
    ).bind(id, user),
    env.DB.prepare(
      `UPDATE automation SET generated=1,cancel_reason=COALESCE(cancel_reason,'campaign_cancelled') WHERE message_id IN (${roots})`,
    ).bind(id, user),
    env.DB.prepare(
      `UPDATE messages SET status='cancelled' WHERE user_id=? AND status IN ('draft','pending') AND (id IN (${roots}) OR parent_id IN (${roots}) OR id IN (SELECT child_id FROM followup_steps WHERE root_id IN (${roots})))`,
    ).bind(user, id, user, id, user, id, user),
    env.DB.prepare(
      "INSERT OR IGNORE INTO audit(id,user_id,action,entity_id) VALUES(?,?,'campaign.cancelled',?)",
    ).bind("campaign-cancel:" + id, user, id),
  ]);
  return Response.json({ ok: true, recalls_delivered_mail: false });
}
