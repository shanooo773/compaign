import { type Env, HttpError } from "./runtime";
import { z } from "zod";
import { liveEnabled, allowedRecipient } from "./automation";
import { syncReplies } from "./automation";
export async function approveFollowup(
  env: Env,
  user: string,
  id: string,
  body: unknown,
) {
  const input = z
    .object({
      confirmed: z.literal(true),
      days: z.number().int().min(1).max(60),
      subject: z
        .string()
        .min(1)
        .max(500)
        .refine((v) => !/[\r\n]/.test(v)),
      body: z.string().min(1).max(20000),
    })
    .parse(body);
  if (!liveEnabled(env))
    throw new HttpError(409, "Live sending is unavailable.");
  const row = await env.DB.prepare(
    "SELECT m.*,t.snapshot,t.connection_id,c.scopes,c.status account_status FROM messages m JOIN transports t ON t.message_id=m.id JOIN connections c ON c.id=t.connection_id WHERE m.id=? AND m.user_id=? AND m.parent_id IS NULL AND t.state='confirmed'",
  )
    .bind(id, user)
    .first<any>();
  if (
    !row ||
    row.status !== "sent" ||
    row.account_status !== "connected" ||
    !/gmail.readonly/.test(row.scopes)
  )
    throw new HttpError(
      409,
      "Only an unanswered confirmed email with reply access can receive a follow-up approval.",
    );
  const proposal = JSON.parse(row.followup_proposal || "null");
  if (proposal?.steps)
    throw new HttpError(
      409,
      "Multistep proposals require complete campaign approval before the initial message. Review a new draft campaign.",
    );
  if (
    !proposal ||
    proposal.days !== input.days ||
    proposal.subject !== input.subject ||
    proposal.body !== input.body
  )
    throw new HttpError(
      409,
      "The proposal changed. Review its exact content again.",
    );
  const snapshot = JSON.parse(row.snapshot);
  if (!(await allowedRecipient(env, snapshot.recipient, user)))
    throw new HttpError(403, "Recipient is outside the current sending mode.");
  await syncReplies(env, fetch, user, id);
  const now = Date.now(),
    due = Date.parse(row.sent_at) + input.days * 86400000;
  try {
    const applied = await env.DB.batch([
      env.DB.prepare(
        "INSERT INTO followup_approvals(message_id,user_id,snapshot,authorized_at) SELECT m.id,m.user_id,?,? FROM messages m JOIN transports t ON t.message_id=m.id WHERE m.id=? AND m.user_id=? AND m.status='sent' AND t.sync_cursor IS NULL AND t.sync_checked_at>? AND NOT EXISTS(SELECT 1 FROM automation WHERE message_id=m.id) AND NOT EXISTS(SELECT 1 FROM suppressions WHERE user_id=m.user_id AND address=?)",
      ).bind(
        JSON.stringify({
          days: input.days,
          subject: input.subject,
          body: input.body,
        }),
        now,
        id,
        user,
        now - 60000,
        snapshot.recipient.toLowerCase(),
      ),
      env.DB.prepare(
        "INSERT INTO automation(message_id,days,subject,body,due_at) SELECT message_id,json_extract(snapshot,'$.days'),json_extract(snapshot,'$.subject'),json_extract(snapshot,'$.body'),? FROM followup_approvals WHERE message_id=? AND user_id=? AND authorized_at=?",
      ).bind(due, id, user, now),
      env.DB.prepare(
        "INSERT INTO audit(id,user_id,action,entity_id) SELECT ?,user_id,'followup.separately_approved',message_id FROM followup_approvals WHERE message_id=? AND authorized_at=?",
      ).bind(crypto.randomUUID(), id, now),
    ]);
    if (!applied[0].meta.changes)
      throw new HttpError(409, "Follow-up approval was not applied.");
  } catch (error) {
    if (error instanceof Error && error.message.includes("Message storage quota reached")) throw error;
    throw new HttpError(
      409,
      "Follow-up is already approved or unavailable. Refresh its status.",
    );
  }
  const approved = await env.DB.prepare(
    "SELECT authorized_at FROM followup_approvals WHERE message_id=? AND user_id=?",
  )
    .bind(id, user)
    .first();
  if (!approved)
    throw new HttpError(
      409,
      "A reply or incomplete mailbox check prevented approval. Refresh and try again.",
    );
  return Response.json({ ok: true, due_at: due });
}
