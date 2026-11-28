import { duplicateHistory } from "./campaign-management";
import {
  campaignAttachmentsSchema,
  resolveAttachmentPlan,
  retainApprovalFiles,
  attachmentRetentionUntil,
  type CachedDocument,
} from "./campaign-attachments";
import { z } from "zod";
import { type Env, HttpError, hash } from "./runtime";
import { transportSnapshot, allowedRecipient, liveEnabled } from "./automation";
import {
  productionEnabled,
  hasOutreachAccess,
  testRecipients,
} from "./live-controls";
import { oauthAvailable } from "./oauth";
import {
  validateSequence,
  type FollowupStep,
} from "../../../shared/followup-sequence";
export async function approveGmail(env: Env, user: string, body: unknown) {
  const input = z
    .object({
      ids: z.array(z.string().uuid()).min(1).max(25),
      name: z
        .string()
        .trim()
        .min(1)
        .max(160)
        .default("Professor outreach campaign"),
      sending_account_id: z.string().uuid(),
      authorize_followups: z.boolean().default(false),
      dry_run: z.boolean().default(false),
      without_attachments_acknowledged: z.boolean().default(false),
      duplicate_acknowledgement: z.string().optional(),
      attachment_selection: campaignAttachmentsSchema.optional(),
      reviewed_messages: z
        .array(
          z.object({
            id: z.string().uuid(),
            recipient: z.string(),
            subject: z.string(),
            body: z.string(),
            scheduled_at: z.string(),
            timezone: z.string(),
            followup_proposal: z.string().nullable(),
          }),
        )
        .max(25)
        .optional(),
    })
    .parse(body);
  const ids = [...new Set(input.ids)];
  const rows = await env.DB.prepare(
    "SELECT m.*,p.deleted_at,p.archived_at professor_archived_at,CASE WHEN a.message_id IS NOT NULL AND a.generated=0 THEN json_object('days',a.days,'subject',a.subject,'body',a.body) ELSE m.followup_proposal END effective_followup,COALESCE(m.approved_recipient,p.email) recipient,t.connection_id,t.snapshot,t.state transport_state FROM messages m JOIN professors p ON p.id=m.professor_id LEFT JOIN transports t ON t.message_id=m.id LEFT JOIN automation a ON a.message_id=m.id WHERE m.user_id=? AND m.id IN (SELECT value FROM json_each(?))",
  )
    .bind(user, JSON.stringify(ids))
    .all<any>();
  if (rows.results.length !== ids.length)
    throw new HttpError(404, "Message not found.");
  if (input.reviewed_messages) {
    if (input.reviewed_messages.length !== ids.length)
      throw new HttpError(
        409,
        "Campaign selection changed. Review the entire campaign again.",
      );
    for (const row of rows.results) {
      const reviewed = input.reviewed_messages.find(
        (item) => item.id === row.id,
      );
      if (
        !reviewed ||
        reviewed.recipient.toLowerCase() !== row.recipient.toLowerCase() ||
        reviewed.subject !== row.subject ||
        reviewed.body !== row.body ||
        reviewed.scheduled_at !== row.scheduled_at ||
        reviewed.timezone !== row.timezone ||
        reviewed.followup_proposal !== (row.followup_proposal || null)
      )
        throw new HttpError(
          409,
          "Campaign content, recipient or timing changed. Review the entire campaign again.",
        );
    }
  }
  const connection = await env.DB.prepare(
    "SELECT provider,scopes,status FROM connections WHERE id=? AND user_id=?",
  )
    .bind(input.sending_account_id, user)
    .first<any>();
  if (
    connection?.provider !== "gmail" ||
    connection.status !== "connected" ||
    !/gmail.send/.test(connection.scopes)
  )
    throw new HttpError(
      409,
      "Choose a connected Gmail account with sending permission.",
    );
  const readiness = await env.DB.prepare(
    "SELECT status,checked_at FROM mailbox_checks WHERE connection_id=?",
  )
    .bind(input.sending_account_id)
    .first<any>();
  if (
    readiness?.status !== "ready" ||
    readiness.checked_at < Date.now() - 3600000
  )
    throw new HttpError(
      409,
      "Gmail provider verification is not ready. Open Settings, resolve the displayed issue and click Verify Gmail connection before approving.",
    );
  const attachments = await env.DB.prepare(
    "SELECT message_id,document_id FROM message_attachments WHERE user_id=? AND message_id IN (SELECT value FROM json_each(?))",
  )
    .bind(user, JSON.stringify(ids))
    .all<any>();
  if (
    input.attachment_selection &&
    Object.keys(input.attachment_selection.recipients).some(
      (id) => !ids.includes(id),
    )
  )
    throw new HttpError(
      400,
      "Attachment overrides must refer to selected campaign recipients.",
    );
  const attachmentCache = new Map<string, CachedDocument>();
  if (
    !liveEnabled(env) ||
    !(await hasOutreachAccess(env, user)) ||
    !oauthAvailable(env, "gmail")
  )
    throw new HttpError(
      403,
      "Gmail sending is not available for this account.",
    );
  const production = await productionEnabled(env, user),
    permitted = testRecipients(env);
  const suppressed = await env.DB.prepare(
    "SELECT address FROM suppressions WHERE user_id=?",
  )
    .bind(user)
    .all<{ address: string }>();
  const plans = [];
  const selectedRecipients = new Set<string>();
  for (const m of rows.results) {
    if (m.deleted_at)
      throw new HttpError(409, "A deleted professor cannot receive email.");
    if (
      !(m.status === "draft" || (m.status === "pending" && !m.live_ready)) ||
      ["uncertain", "submitting", "leased", "confirmed"].includes(
        m.transport_state,
      )
    )
      throw new HttpError(
        409,
        "Message is already scheduled, cancelled or awaiting reconciliation. Refresh before approving.",
      );
    if (m.connection_id && m.connection_id !== input.sending_account_id)
      throw new HttpError(
        409,
        "This draft is bound to its reviewed sending account.",
      );
    const recipient = m.snapshot
      ? JSON.parse(m.snapshot).recipient
      : m.recipient;
    if (selectedRecipients.has(recipient.toLowerCase()))
      throw new HttpError(
        400,
        "A campaign may contain only one initial message per recipient. Review the duplicate selection.",
      );
    selectedRecipients.add(recipient.toLowerCase());
    if (suppressed.results.some((r) => r.address === recipient.toLowerCase()))
      throw new HttpError(409, "A selected recipient is deleted or opted out.");
    if (!production && !permitted.includes(recipient.toLowerCase()))
      throw new HttpError(
        403,
        "Recipient is outside the current sending mode.",
      );
    const docs = attachments.results
      .filter((a) => a.message_id === m.id)
      .map((a) => a.document_id);
    const snapshot = m.snapshot
      ? JSON.parse(m.snapshot)
      : {
          recipient,
          subject: m.subject,
          body: m.body,
          attachments: [],
          key: m.id + "@ms-professor-agent.invalid",
        };
    let followup: {
      days: number;
      subject: string;
      body: string;
      steps?: FollowupStep[];
    } | null = null;
    if (input.authorize_followups) {
      if (!m.effective_followup && m.followup_issue)
        throw new HttpError(
          400,
          "Missing follow-up content for " +
            recipient +
            ". Supply its exact subject, body and 1-60 day delay, or choose initial emails only.",
        );
      if (m.effective_followup) {
        const proposed = JSON.parse(m.effective_followup);
        if (proposed.steps) {
          let steps: FollowupStep[];
          try {
            steps = validateSequence(proposed.steps);
          } catch (error) {
            throw new HttpError(400, (error as Error).message);
          }
          followup = {
            days: 1,
            subject: steps[0].subject,
            body: steps[0].body,
            steps,
          };
        } else
          followup = z
            .object({
              days: z.number().int().min(1).max(60),
              subject: z
                .string()
                .min(1)
                .max(500)
                .refine((v) => !/[\r\n]/.test(v)),
              body: z.string().min(1).max(20000),
            })
            .parse(proposed);
      }
    }
    if (followup && !/gmail.readonly/.test(connection.scopes))
      throw new HttpError(
        409,
        "Reconnect Gmail with reply access before authorizing a follow-up.",
      );
    const selection =
      input.attachment_selection?.recipients[m.id] ||
      input.attachment_selection;
    const attachmentPlan = await resolveAttachmentPlan(
      env,
      user,
      selection?.initial || docs,
      selection?.followups || {},
      followup?.steps?.length || (followup ? 1 : 0),
      attachmentCache,
    );
    // Newly approved campaigns default to initial-only attachments. Old authorizations are untouched.
    snapshot.attachments = attachmentPlan.initial;
    plans.push({
      attachment_plan: attachmentPlan,
      without_attachments_acknowledged: !attachmentPlan.initial.length && input.without_attachments_acknowledged,
      retention_until: attachmentRetentionUntil(m.scheduled_at),
      id: m.id,
      snapshot,
      followup,
      scheduled_at: m.scheduled_at,
      timezone: m.timezone,
      fingerprint: await hash(
        JSON.stringify([
          m.campaign_import_id || m.id,
          snapshot.recipient.toLowerCase(),
          snapshot.subject,
          snapshot.body,
          m.scheduled_at,
        ]),
      ),
    });
  }
  const missingAttachments = plans.filter(plan => !plan.attachment_plan.initial.length).map(plan => ({id:plan.id, address:plan.snapshot.recipient}));
  if (!input.dry_run && missingAttachments.length && !input.without_attachments_acknowledged)
    throw new HttpError(409, "No documents attached. Review affected initial emails and explicitly confirm Continue Without Attachments.");
  const duplicateReview = await duplicateHistory(env, user, ids);
  const repeatAcknowledged = duplicateReview.history.length > 0 && input.duplicate_acknowledgement === duplicateReview.acknowledgement;
  if (!input.dry_run && duplicateReview.history.length && !repeatAcknowledged)
    throw new HttpError(409, "Previously contacted or scheduled recipients require a fresh duplicate review and separate Approve Anyway confirmation.");
  // Validate the identical plan without creating authorizations, transports or schedules.
  // A later real approval reruns every check; this response never grants permission to send.
  if (input.dry_run) {
    const followups = plans.reduce(
      (count, plan) =>
        count + (plan.followup?.steps?.length || (plan.followup ? 1 : 0)),
      0,
    );
    return Response.json({
      ok: true,
      dry_run: true,
      duplicate_review: duplicateReview,
      missing_attachments: missingAttachments,
      scheduled: 0,
      authorized_followups: 0,
      would_schedule: plans.length,
      would_authorize_followups: followups,
      total_messages: plans.length + followups,
      attachment_plans: plans.map((plan) => ({
        message_id: plan.id,
        ...plan.attachment_plan,
      })),
      recipients: plans.map((plan) => ({
        address: plan.snapshot.recipient,
        controlled_test: permitted.includes(
          plan.snapshot.recipient.toLowerCase(),
        ),
        followup_steps: plan.followup?.steps || [],
      })),
    });
  }
  if (attachmentCache.size)
    await retainApprovalFiles(
      env,
      attachmentCache,
      Math.max(...plans.map((plan) => plan.retention_until)),
    );
  const payload = JSON.stringify(plans),
    campaignId = crypto.randomUUID(),
    authorizedAt = Date.now();
  try {
    await env.DB.batch([
      env.DB.prepare("INSERT INTO campaign_duplicate_reviews(campaign_id,user_id,history,acknowledged,created_at) VALUES(?,?,?,?,?)").bind(campaignId,user,JSON.stringify(duplicateReview.history),+repeatAcknowledged,authorizedAt),
      ...(missingAttachments.length ? [env.DB.prepare("INSERT INTO audit(id,user_id,action,entity_id) VALUES(?,?,'campaign.without_attachments_acknowledged',?)").bind(crypto.randomUUID(),user,campaignId)] : []),
      ...(repeatAcknowledged ? [env.DB.prepare("INSERT INTO audit(id,user_id,action,entity_id) VALUES(?,?,'campaign.duplicate_override',?)").bind(crypto.randomUUID(),user,campaignId)] : []),
      env.DB.prepare(
        "INSERT INTO campaign_approvals(id,user_id,approved_at,initial_count,followup_count,sending_account_id,selection,name) VALUES(?,?,?,?,?,?,?,?)",
      ).bind(
        campaignId,
        user,
        authorizedAt,
        ids.length,
        plans.reduce(
          (count, p) =>
            count + (p.followup?.steps?.length || (p.followup ? 1 : 0)),
          0,
        ),
        input.sending_account_id,
        payload,
        input.name,
      ),
      env.DB.prepare(
        "UPDATE messages SET approved=1,authorized=CASE WHEN mode='auto' THEN 1 ELSE authorized END,status='pending',live_ready=1,error=NULL,live_fingerprint=(SELECT json_extract(value,'$.fingerprint') FROM json_each(?) WHERE json_extract(value,'$.id')=messages.id) WHERE user_id=? AND id IN (SELECT json_extract(value,'$.id') FROM json_each(?)) AND (status='draft' OR (status='pending' AND live_ready=0))",
      ).bind(payload, user, payload),
      env.DB.prepare(
        "INSERT INTO transports(message_id,user_id,connection_id,snapshot) SELECT m.id,m.user_id,?,json_extract(j.value,'$.snapshot') FROM json_each(?) j JOIN messages m ON m.id=json_extract(j.value,'$.id') WHERE m.user_id=? AND m.status='pending' AND m.live_ready=1 ON CONFLICT(message_id) DO UPDATE SET snapshot=excluded.snapshot,connection_id=excluded.connection_id",
      ).bind(input.sending_account_id, payload, user),
      env.DB.prepare(
        "UPDATE automation SET generated=1,cancel_reason='initial_only' WHERE message_id IN (SELECT json_extract(value,'$.id') FROM json_each(?)) AND ?=0",
      ).bind(payload, +input.authorize_followups),
      env.DB.prepare(
        "INSERT INTO automation(message_id,days,subject,body) SELECT m.id,json_extract(j.value,'$.followup.days'),json_extract(j.value,'$.followup.subject'),json_extract(j.value,'$.followup.body') FROM json_each(?) j JOIN messages m ON m.id=json_extract(j.value,'$.id') WHERE m.user_id=? AND m.status='pending' AND m.live_ready=1 AND json_extract(j.value,'$.followup') IS NOT NULL AND json_extract(j.value,'$.followup.steps') IS NULL ON CONFLICT(message_id) DO UPDATE SET generated=0,cancel_reason=NULL,days=excluded.days,subject=excluded.subject,body=excluded.body",
      ).bind(payload, user),
      env.DB.prepare(
        "INSERT INTO message_authorizations(message_id,user_id,campaign_id,snapshot,authorized_at,followup_authorized) SELECT json_extract(value,'$.id'),?,?,json_object('initial',json(json_extract(value,'$.snapshot')),'sending_account_id',?,'scheduled_at',json_extract(value,'$.scheduled_at'),'timezone',json_extract(value,'$.timezone'),'attachment_plan',json(json_extract(value,'$.attachment_plan')),'followup',json(json_extract(value,'$.followup')),'condition','only_if_no_reply','maximum_followups',CASE WHEN json_extract(value,'$.followup') IS NULL THEN 0 ELSE COALESCE(json_array_length(json_extract(value,'$.followup.steps')),1) END),?,CASE WHEN json_extract(value,'$.followup') IS NULL THEN 0 ELSE 1 END FROM json_each(?)",
      ).bind(user, campaignId, input.sending_account_id, authorizedAt, payload),
      env.DB.prepare(
        "DELETE FROM message_attachments WHERE message_id IN (SELECT json_extract(value,'$.id') FROM json_each(?)) AND user_id=?",
      ).bind(payload, user),
      env.DB.prepare(
        "INSERT OR IGNORE INTO message_attachments(message_id,document_id,user_id) SELECT json_extract(plan.value,'$.id'),json_extract(doc.value,'$.id'),? FROM json_each(?) plan,json_each(plan.value,'$.attachment_plan.initial') doc",
      ).bind(user, payload),
      env.DB.prepare(
        "INSERT INTO campaign_attachment_pins(root_id,document_id,user_id,retained_until) SELECT json_extract(plan.value,'$.id'),json_extract(doc.value,'$.id'),?,json_extract(plan.value,'$.retention_until') FROM json_each(?) plan,json_tree(plan.value,'$.attachment_plan') doc WHERE doc.type='object' AND json_extract(doc.value,'$.id') IS NOT NULL GROUP BY json_extract(plan.value,'$.id'),json_extract(doc.value,'$.id')",
      ).bind(user, payload),
      env.DB.prepare(
        "UPDATE documents SET retained_until=MAX(COALESCE(retained_until,0),(SELECT MAX(retained_until) FROM campaign_attachment_pins WHERE document_id=documents.id)) WHERE id IN (SELECT document_id FROM campaign_attachment_pins WHERE root_id IN (SELECT json_extract(value,'$.id') FROM json_each(?)))",
      ).bind(payload),
      env.DB.prepare(
        "INSERT INTO followup_steps(root_id,step,child_id,subject,body,delay_value,delay_unit,relative_to,authorized_at) SELECT json_extract(value,'$.root_id'),json_extract(value,'$.step'),json_extract(value,'$.child_id'),json_extract(value,'$.subject'),json_extract(value,'$.body'),json_extract(value,'$.delay_value'),json_extract(value,'$.delay_unit'),json_extract(value,'$.relative_to'),? FROM json_each(?)",
      ).bind(
        authorizedAt,
        JSON.stringify(
          plans.flatMap((plan) =>
            (plan.followup?.steps || []).map((step, index) => ({
              ...step,
              root_id: plan.id,
              step: index + 1,
              child_id: crypto.randomUUID(),
            })),
          ),
        ),
      ),
      env.DB.prepare(
        "INSERT INTO audit(id,user_id,action,entity_id) SELECT lower(hex(randomblob(16))),?,? ,json_extract(value,'$.id') FROM json_each(?)",
      ).bind(
        user,
        input.authorize_followups
          ? "gmail.approved_with_exact_followup"
          : "gmail.approved",
        payload,
      ),
    ]);
  } catch (error) {
    if (error instanceof Error && /Duplicate history changed/.test(error.message)) throw new HttpError(409,"Duplicate history changed during approval. Check recipients again and explicitly confirm the updated list.");
    if (
      error instanceof Error &&
      /live_fingerprint|message_authorizations|Campaign changed/.test(
        error.message,
      )
    )
      throw new HttpError(
        409,
        "An identical recipient, message and schedule is already approved. Review the existing message instead.",
      );
    throw error;
  }
  return Response.json({
    ok: true,
    scheduled: ids.length,
    campaign_id: campaignId,
    name: input.name,
    authorized_followups: plans.reduce(
      (count, p) => count + (p.followup?.steps?.length || (p.followup ? 1 : 0)),
      0,
    ),
    total_messages:
      ids.length +
      plans.reduce(
        (count, p) =>
          count + (p.followup?.steps?.length || (p.followup ? 1 : 0)),
        0,
      ),
  });
}
export async function retryGmail(env: Env, user: string, id: string) {
  const row = await env.DB.prepare(
    "SELECT t.*,m.status message_status,c.status connection_status FROM transports t JOIN messages m ON m.id=t.message_id JOIN connections c ON c.id=t.connection_id WHERE t.message_id=? AND t.user_id=? AND NOT EXISTS(SELECT 1 FROM deliveries WHERE message_id=m.id)",
  )
    .bind(id, user)
    .first<any>();
  if (
    !row ||
    row.message_status !== "failed" ||
    row.state !== "failed" ||
    row.connection_status !== "connected"
  )
    throw new HttpError(
      409,
      "Only a proven failed send with no receipt can be retried. Uncertain messages are never resent.",
    );
  const snapshot = JSON.parse(row.snapshot);
  if (!(await allowedRecipient(env, snapshot.recipient, user)))
    throw new HttpError(403, "Recipient is outside the current sending mode.");
  const suppressed = await env.DB.prepare(
    "SELECT 1 ok FROM suppressions WHERE user_id=? AND address=?",
  )
    .bind(user, snapshot.recipient.toLowerCase())
    .first();
  if (suppressed) throw new HttpError(409, "This recipient is suppressed.");
  if (
    (
      await env.DB.prepare("SELECT parent_id FROM messages WHERE id=?")
        .bind(id)
        .first<any>()
    )?.parent_id
  )
    throw new HttpError(
      409,
      "Failed follow-ups require a separately approved new message.",
    );
  await env.DB.batch([
    env.DB.prepare(
      "UPDATE messages SET status='pending',error=NULL,approved=1,live_ready=1 WHERE id=? AND user_id=? AND status='failed'",
    ).bind(id, user),
    env.DB.prepare(
      "UPDATE transports SET state='waiting',next_at=0,max_attempts=attempts+3 WHERE message_id=? AND user_id=? AND state='failed'",
    ).bind(id, user),
    env.DB.prepare(
      "INSERT INTO audit(id,user_id,action,entity_id) VALUES(?,?,'gmail.retry_authorized',?)",
    ).bind(crypto.randomUUID(), user, id),
  ]);
  return Response.json({ ok: true });
}
