import { z } from "zod";
import { type Env, HttpError, hash } from "./runtime";
import {
  resolveAttachmentPlan,
  retainApprovalFiles,
  attachmentRetentionUntil,
  type CachedDocument,
} from "./campaign-attachments";
export async function upcomingEmails(env: Env, user: string, campaign: string) {
  const c = await env.DB.prepare(
    "SELECT c.*,EXISTS(SELECT 1 FROM audit WHERE entity_id=c.id AND action='campaign.cancelled') cancelled,EXISTS(SELECT 1 FROM campaign_workspace_deletions WHERE campaign_id=c.id) deleted FROM campaign_approvals c WHERE c.id=? AND c.user_id=?",
  )
    .bind(campaign, user)
    .first<any>();
  if (!c) throw new HttpError(404, "Campaign not found.");
  const roots = (
    await env.DB.prepare(
      "SELECT m.*,p.name professor_name,p.deleted_at,a.snapshot authorization,t.snapshot transport_snapshot,t.thread_id FROM message_authorizations a JOIN messages m ON m.id=a.message_id JOIN professors p ON p.id=m.professor_id JOIN transports t ON t.message_id=m.id WHERE a.campaign_id=? AND a.user_id=? AND a.kind='initial'",
    )
      .bind(campaign, user)
      .all<any>()
  ).results;
  const rootIds = JSON.stringify(roots.map((r) => r.id));
  const messages = (
    await env.DB.prepare(
      "SELECT m.*,t.snapshot transport_snapshot,t.state transport_state,t.attempts,t.lease,EXISTS(SELECT 1 FROM deliveries d WHERE d.message_id=m.id) receipt,EXISTS(SELECT 1 FROM delivery_attempts d WHERE d.message_id=m.id) attempted FROM messages m JOIN transports t ON t.message_id=m.id WHERE m.user_id=? AND (m.id IN (SELECT value FROM json_each(?)) OR m.parent_id IN (SELECT value FROM json_each(?)) OR m.id IN (SELECT child_id FROM followup_steps WHERE root_id IN (SELECT value FROM json_each(?))))",
    )
      .bind(user, rootIds, rootIds, rootIds)
      .all<any>()
  ).results;
  const steps = (
    await env.DB.prepare(
      "SELECT * FROM followup_steps WHERE root_id IN (SELECT value FROM json_each(?))",
    )
      .bind(rootIds)
      .all<any>()
  ).results;
  const revisions = (
    await env.DB.prepare(
      "SELECT * FROM current_message_revisions WHERE user_id=? AND campaign_id=?",
    )
      .bind(user, campaign)
      .all<any>()
  ).results;
  const suppressions = (
    await env.DB.prepare("SELECT address FROM suppressions WHERE user_id=?")
      .bind(user)
      .all<any>()
  ).results;
  const items: any[] = [];
  for (const root of roots) {
    const original = JSON.parse(
        revisions.find((r) => r.message_id === root.id)?.snapshot ||
          root.transport_snapshot,
      ),
      auth = JSON.parse(root.authorization);
    const candidates = [
      { id: root.id, kind: "initial", step: null },
      ...steps
        .filter((f) => f.root_id === root.id)
        .sort((a,b)=>a.step-b.step)
        .map((f) => ({ id: f.child_id, kind: "followup", step: f })),
    ];
    // Legacy follow-ups already materialized are safe to review but kept locked in this phase.
    for (const m of messages.filter(
      (m) => m.parent_id === root.id && !steps.some((f) => f.child_id === m.id),
    ))
      candidates.push({ id: m.id, kind: "legacy_followup", step: null });
    for (const candidate of candidates) {
      const m = messages.find((m) => m.id === candidate.id),
        f = candidate.step,
        r = revisions.find((r) => r.message_id === candidate.id);
      const base = m
        ? JSON.parse(m.transport_snapshot)
        : {
            ...original,
            subject: f.subject,
            body: f.body,
            attachments: auth.attachment_plan
              ? auth.attachment_plan.followups[String(f.step)] || []
              : original.attachments,
            key: candidate.id + "@ms-professor-agent.invalid",
            inReplyTo: original.key,
            threadId:
              f.subject === original.subject ? root.thread_id : undefined,
          };
      const snapshot = r ? JSON.parse(r.snapshot) : base;
      const schedule =
        r?.scheduled_at ??
        m?.scheduled_at ??
        (f?.due_at ? new Date(f.due_at).toISOString() : null);
      const replied = messages.some(
        (m) =>
          m.status === "replied" &&
          (m.id === root.id ||
            m.parent_id === root.id ||
            steps.some((f) => f.root_id === root.id && f.child_id === m.id)),
      );
      let reason = "";
      if (
        c.cancelled ||
        c.deleted ||
        root.deleted_at ||
        f?.cancel_reason ||
        !["pending", "sent"].includes(root.status) ||
        replied
      )
        reason =
          "Campaign or recipient stopped; cancelled messages and replies cannot be reactivated.";
      else if (candidate.kind === "legacy_followup")
        reason =
          "Legacy follow-up editing is unavailable; original authorization remains in effect.";
      else if (
        suppressions.some((s) => s.address === original.recipient.toLowerCase())
      )
        reason = "Recipient is suppressed.";
      else if (
        m &&
        (m.status !== "pending" ||
          m.transport_state !== "waiting" ||
          m.attempts ||
          m.lease ||
          m.receipt ||
          m.attempted)
      )
        reason =
          m.status === "sent" || m.status === "replied"
            ? "Already sent ? read-only."
            : "This email is already being processed and can no longer be edited.";
      else if (!m && (!f || f.queued))
        reason =
          "This email is already being processed and can no longer be edited.";
      else if (schedule && Date.parse(schedule) <= Date.now() + 120000)
        reason =
          "This email is due within two minutes and can no longer be edited.";
      const item = {
        id: candidate.id,
        root_id: root.id,
        kind: candidate.kind,
        professor_name: root.professor_name,
        recipient: snapshot.recipient,
        subject: snapshot.subject,
        body: snapshot.body,
        attachments: snapshot.attachments || [],
        scheduled_at: schedule,
        timezone: root.timezone,
        version: r?.version || 0,
        editable: !reason,
        reason,
        status: m?.status || "conditional",
        sent_at:m?.sent_at||null,
        delay_ms:f?f.delay_value*({minutes:60000,hours:3600000,days:86400000}[f.delay_unit as 'minutes'|'hours'|'days']):0,
        relative_to:f?.relative_to||null,
        step:f?.step||0,
        original: {
          subject: base.subject,
          body: base.body,
          attachments: base.attachments,
          scheduled_at:
            m?.scheduled_at ??
            (f?.due_at ? new Date(f.due_at).toISOString() : null),
        },
        horizon_start: root.sent_at || root.scheduled_at,
      };
      items.push({ ...item, expected: await hash(JSON.stringify(item)) });
    }
  }
  return { campaign_id: campaign, name: c.name, items };
}
const changeSchema = z.object({
  id: z.string().uuid(),
  expected: z.string(),
  subject: z.string().min(1).max(500),
  body: z.string().min(1).max(20000),
  attachments: z.array(z.string().uuid()).max(3),
  scheduled_at: z.string().datetime().nullable(),
});
export async function approveRevision(
  env: Env,
  user: string,
  campaign: string,
  body: unknown,
) {
  const input = z
    .object({
      changes: z.array(changeSchema).min(1).max(25),
      dry_run: z.boolean().default(false),
      confirmed: z.boolean().default(false),
      without_attachments_acknowledged: z.boolean().default(false),
    })
    .parse(body);
  if (new Set(input.changes.map((c) => c.id)).size !== input.changes.length)
    throw new HttpError(400, "Choose each upcoming email only once.");
  const view = await upcomingEmails(env, user, campaign),
    cache = new Map<string, CachedDocument>(),
    plans: any[] = [];
  for (const change of input.changes) {
    const current = view.items.find((i) => i.id === change.id);
    if (!current) throw new HttpError(404, "Upcoming email not found.");
    if (!current.editable) throw new HttpError(409, current.reason);
    if (current.expected !== change.expected)
      throw new HttpError(
        409,
        "Upcoming email changed while this revision was open. Refresh and review again.",
      );
    if (!change.scheduled_at && current.scheduled_at)
      throw new HttpError(400, "A confirmed schedule cannot be removed.");
    if (change.scheduled_at) {
      const time = Date.parse(change.scheduled_at);
      if (time <= Date.now() + 120000)
        throw new HttpError(
          400,
          "Choose a sending time more than two minutes in the future.",
        );
      const end =
        current.kind === "initial"
          ? Date.now() + 60 * 86400000
          : Date.parse(current.horizon_start) + 60 * 86400000;
      if (time > end)
        throw new HttpError(
          400,
          "Revised sending time exceeds the 60-day horizon.",
        );
    }
    const attachments = (
      await resolveAttachmentPlan(env, user, change.attachments, {}, 0, cache)
    ).initial;
    const source = await env.DB.prepare(
      "SELECT COALESCE(r.snapshot,t.snapshot) snapshot FROM transports t LEFT JOIN current_message_revisions r ON r.message_id=t.message_id WHERE t.message_id=?",
    )
      .bind(change.id)
      .first<any>();
    const root = await env.DB.prepare(
      "SELECT COALESCE(r.snapshot,t.snapshot) snapshot,t.thread_id FROM transports t LEFT JOIN current_message_revisions r ON r.message_id=t.message_id WHERE t.message_id=?",
    )
      .bind(current.root_id)
      .first<any>();
    const original = JSON.parse(root.snapshot);
    const snapshot = source
      ? JSON.parse(source.snapshot)
      : {
          ...original,
          key: change.id + "@ms-professor-agent.invalid",
          inReplyTo: original.key,
          threadId:
            change.subject === original.subject ? root.thread_id : undefined,
        };
    Object.assign(snapshot, {
      subject: change.subject,
      body: change.body,
      attachments,
    });
    if (current.kind !== "initial")
      snapshot.threadId =
        change.subject === original.subject ? root.thread_id : undefined;
    plans.push({
      id: change.id,
      root_id: current.root_id,
      version: current.version + 1,
      snapshot: JSON.stringify(snapshot),
      scheduled_at: change.scheduled_at,
      timezone: current.timezone,
      kind: current.kind,
      original: current,
    });
  }
  // Validate the complete prospective sequence, including unchanged fixed dates.
  // Never turn a reschedule into an immediately due follow-up backlog.
  for(const rootId of new Set(view.items.map(i=>i.root_id))){
    const sequence=view.items.filter(i=>i.root_id===rootId).sort((a,b)=>a.step-b.step);
    const initial=sequence.find(i=>i.kind==='initial');
    const rootPlan=plans.find(p=>p.id===rootId);
    const rootTime=Date.parse(initial.sent_at||rootPlan?.scheduled_at||initial.scheduled_at);
    let prior=rootTime;
    for(const item of sequence.filter(i=>i.kind==='followup')){
      const plan=plans.find(p=>p.id===item.id);
      const fixed=plan?.scheduled_at??item.scheduled_at;
      const time=item.sent_at?Date.parse(item.sent_at):fixed?Date.parse(fixed):(item.relative_to==='original'?rootTime:prior)+item.delay_ms;
      if(!item.sent_at && (plan?.scheduled_at!==undefined||rootPlan) && fixed && time<=prior)
        throw new HttpError(400,"A follow-up must be later than the initial and preceding emails. Review their dates together.");
      if(!item.sent_at && fixed && (plan||rootPlan) && time>rootTime+60*86400000)
        throw new HttpError(400,"Revised follow-up exceeds the 60-day horizon from the initial email.");
      prior=time;
    }
  }
  const missing = plans.filter(
    (p) => p.kind === "initial" && !JSON.parse(p.snapshot).attachments.length,
  );
  const review = {
    initial_count: plans.filter((p) => p.kind === "initial").length,
    followup_count: plans.filter((p) => p.kind !== "initial").length,
    missing_attachments: missing.map((p) => ({
      address: JSON.parse(p.snapshot).recipient,
    })),
    plans,
  };
  if (input.dry_run) return Response.json({ ...review, dry_run: true });
  if (!input.confirmed)
    throw new HttpError(400, "Explicitly approve the reviewed revision.");
  if (missing.length && !input.without_attachments_acknowledged)
    throw new HttpError(
      409,
      "Explicitly confirm Continue Without Attachments for revised initial emails without documents.",
    );
  const until = Math.max(
    ...plans.map((p) =>
      attachmentRetentionUntil(p.scheduled_at || new Date().toISOString()),
    ),
  );
  if (cache.size) await retainApprovalFiles(env, cache, until);
  const approval = crypto.randomUUID(),
    now = Date.now(),
    payload = JSON.stringify(plans);
  try {
    await env.DB.batch([
      env.DB.prepare(
        "INSERT INTO revision_approvals(id,user_id,campaign_id,selection,approved_at,without_attachments_acknowledged) VALUES(?,?,?,?,?,?)",
      ).bind(
        approval,
        user,
        campaign,
        payload,
        now,
        +input.without_attachments_acknowledged,
      ),
      env.DB.prepare(
        "INSERT INTO message_revisions(id,approval_id,user_id,campaign_id,message_id,root_id,version,snapshot,scheduled_at,timezone,approved_at) SELECT lower(hex(randomblob(16))),?,?,?,json_extract(value,'$.id'),json_extract(value,'$.root_id'),json_extract(value,'$.version'),json_extract(value,'$.snapshot'),json_extract(value,'$.scheduled_at'),json_extract(value,'$.timezone'),? FROM json_each(?)",
      ).bind(approval, user, campaign, now, payload),
      env.DB.prepare(
        "INSERT INTO campaign_attachment_pins(root_id,document_id,user_id,retained_until) SELECT json_extract(p.value,'$.root_id'),json_extract(d.value,'$.id'),?,? FROM json_each(?) p,json_each(json_extract(p.value,'$.snapshot'),'$.attachments') d WHERE 1 GROUP BY json_extract(p.value,'$.root_id'),json_extract(d.value,'$.id') ON CONFLICT(root_id,document_id) DO UPDATE SET retained_until=excluded.retained_until WHERE campaign_attachment_pins.retained_until<excluded.retained_until",
      ).bind(user, until, payload),
      env.DB.prepare(
        "UPDATE documents SET retained_until=MAX(COALESCE(retained_until,0),?) WHERE id IN (SELECT json_extract(d.value,'$.id') FROM json_each(?) p,json_each(json_extract(p.value,'$.snapshot'),'$.attachments') d) AND COALESCE(retained_until,0)<?",
      ).bind(until, payload, until),
      env.DB.prepare(
        "INSERT INTO audit(id,user_id,action,entity_id) VALUES(?,?,'campaign.revision_approved',?)",
      ).bind(approval, user, campaign),
    ]);
  } catch (error) {
    if (
      error instanceof Error &&
      /Revision stale|UNIQUE constraint/.test(error.message)
    )
      throw new HttpError(
        409,
        "This email is already being processed or changed and can no longer be edited. Refresh upcoming emails.",
      );
    throw error;
  }
  return Response.json({
    ok: true,
    approval_id: approval,
    initial_count: review.initial_count,
    followup_count: review.followup_count,
  });
}
