import { z } from "zod";
import { type Env, HttpError } from "./runtime";
export async function deleteDraft(env: Env, user: string, body: unknown) {
  const input = z
    .object({
      ids: z.array(z.string().uuid()).min(1).max(25),
      confirm_name: z.string().min(1).max(240),
    })
    .parse(body);
  const ids = [...new Set(input.ids)],
    payload = JSON.stringify(ids);
  const first = await env.DB.prepare(
    "SELECT p.name,COALESCE(m.campaign_import_id,m.id) draft_identity FROM messages m JOIN professors p ON p.id=m.professor_id WHERE m.id=? AND m.user_id=?",
  )
    .bind(ids[0], user)
    .first<any>();
  if (!first) throw new HttpError(404, "Draft not found.");
  if (input.confirm_name !== "Draft campaign for " + first.name)
    throw new HttpError(400, "Confirm the exact draft campaign name.");
  const safe = `SELECT m.id FROM messages m WHERE m.user_id=? AND m.id IN (SELECT value FROM json_each(?)) AND COALESCE(m.campaign_import_id,m.id)=? AND m.status='draft' AND m.approved=0 AND m.live_ready=0 AND m.parent_id IS NULL
 AND NOT EXISTS(SELECT 1 FROM messages sibling WHERE sibling.user_id=m.user_id AND sibling.campaign_import_id=m.campaign_import_id AND (sibling.approved=1 OR sibling.live_ready=1 OR EXISTS(SELECT 1 FROM message_authorizations a WHERE a.message_id=sibling.id) OR EXISTS(SELECT 1 FROM transports t WHERE t.message_id=sibling.id)))
 AND NOT EXISTS(SELECT 1 FROM message_authorizations a WHERE a.message_id=m.id)
 AND NOT EXISTS(SELECT 1 FROM transports t WHERE t.message_id=m.id)
 AND NOT EXISTS(SELECT 1 FROM followup_approvals f WHERE f.message_id=m.id)
 AND NOT EXISTS(SELECT 1 FROM followup_steps f WHERE f.root_id=m.id OR f.child_id=m.id)
 AND NOT EXISTS(SELECT 1 FROM automation a WHERE a.message_id=m.id AND a.generated=0)
 AND NOT EXISTS(SELECT 1 FROM deliveries d WHERE d.message_id=m.id)
 AND NOT EXISTS(SELECT 1 FROM campaign_attachment_pins p WHERE p.root_id=m.id)`;
  const receipt = crypto.randomUUID();
  const results = await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO audit(id,user_id,action,entity_id) SELECT ?,?,'campaign.draft_deleted',? WHERE (SELECT count(*) FROM (${safe}))=?`,
    ).bind(
      receipt,
      user,
      payload,
      user,
      payload,
      first.draft_identity,
      ids.length,
    ),
    env.DB.prepare(
      "DELETE FROM message_attachments WHERE user_id=? AND message_id IN (SELECT value FROM json_each(?)) AND EXISTS(SELECT 1 FROM audit WHERE id=?)",
    ).bind(user, payload, receipt),
    env.DB.prepare(
      "DELETE FROM automation WHERE message_id IN (SELECT value FROM json_each(?)) AND EXISTS(SELECT 1 FROM audit WHERE id=?)",
    ).bind(payload, receipt),
    env.DB.prepare(
      "DELETE FROM messages WHERE user_id=? AND id IN (SELECT value FROM json_each(?)) AND EXISTS(SELECT 1 FROM audit WHERE id=?)",
    ).bind(user, payload, receipt),
  ]);
  if (!results[0].meta.changes)
    throw new HttpError(
      409,
      "Draft deletion blocked: an approval, active job or changed message exists. Refresh and inspect this campaign.",
    );
  return Response.json({
    ok: true,
    deleted: ids.length,
    documents_preserved: true,
  });
}
