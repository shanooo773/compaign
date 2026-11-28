import { followupAttachments } from "./campaign-attachments";
import { type Env } from "./runtime";
import {
  syncReplies,
  allowedRecipient,
  liveEnabled,
  type Snapshot,
} from "./automation";
import { readyDocument } from "./storage";
import { type Fetcher } from "./providers";

export async function queueSequence(env: Env, network: Fetcher = fetch) {
  if (!liveEnabled(env)) return;
  const now = Date.now();
  await env.DB.prepare(
    `UPDATE followup_steps SET due_at=(
    SELECT CAST(round((julianday(base.sent_at)-2440587.5)*86400000) AS INTEGER)
    FROM messages base WHERE base.id=CASE WHEN followup_steps.relative_to='original' OR followup_steps.step=1
    THEN followup_steps.root_id ELSE (SELECT prev.child_id FROM followup_steps prev WHERE prev.root_id=followup_steps.root_id AND prev.step=followup_steps.step-1) END
    AND base.sent_at IS NOT NULL) + delay_value * CASE delay_unit WHEN 'minutes' THEN 60000 WHEN 'hours' THEN 3600000 ELSE 86400000 END
    WHERE due_at IS NULL AND queued=0 AND cancel_reason IS NULL
    AND EXISTS (
      SELECT 1 FROM messages base
      WHERE base.id=CASE WHEN followup_steps.relative_to='original' OR followup_steps.step=1
      THEN followup_steps.root_id ELSE (SELECT prev.child_id FROM followup_steps prev WHERE prev.root_id=followup_steps.root_id AND prev.step=followup_steps.step-1) END
      AND julianday(base.sent_at) IS NOT NULL
    )`,
  ).run();
  const row = await env.DB.prepare(
    `WITH candidates AS MATERIALIZED (
      SELECT child_id FROM followup_steps INDEXED BY followup_active_due WHERE queued=0 AND cancel_reason IS NULL AND due_at<=? AND next_check_at<=?
      UNION SELECT f.child_id FROM current_message_revisions r CROSS JOIN followup_steps f ON f.child_id=r.message_id
        WHERE f.queued=0 AND f.cancel_reason IS NULL AND r.scheduled_at IS NOT NULL
        AND CAST(round((julianday(r.scheduled_at)-2440587.5)*86400000) AS INTEGER)<=? AND f.next_check_at<=?
    ) SELECT f.*,r.snapshot revision_snapshot,COALESCE(r.version,0) revision_version,r.scheduled_at revision_schedule,m.user_id,m.professor_id,m.timezone,COALESCE(root_revision.snapshot,t.snapshot) snapshot,auth.snapshot authorization,t.connection_id,t.thread_id,
    c.status account_status,c.scopes,COALESCE(prev.child_id,m.id) parent_id
    FROM candidates candidate CROSS JOIN followup_steps f ON f.child_id=candidate.child_id JOIN messages m ON m.id=f.root_id JOIN transports t ON t.message_id=m.id
    LEFT JOIN message_authorizations auth ON auth.message_id=m.id
    JOIN connections c ON c.id=t.connection_id JOIN profiles p ON p.user_id=m.user_id
    LEFT JOIN followup_steps prev ON prev.root_id=f.root_id AND prev.step=f.step-1
    LEFT JOIN current_message_revisions r ON r.message_id=f.child_id
    LEFT JOIN current_message_revisions root_revision ON root_revision.message_id=m.id
    WHERE f.queued=0 AND f.cancel_reason IS NULL AND COALESCE(CAST(round((julianday(r.scheduled_at)-2440587.5)*86400000) AS INTEGER),f.due_at)<=? AND f.next_check_at<=? AND m.status='sent' AND c.status='connected'
    AND p.paused=0 AND p.stopped=0 AND (f.step=1 OR EXISTS(SELECT 1 FROM messages prior JOIN transports pt ON pt.message_id=prior.id WHERE prior.id=prev.child_id AND prior.status='sent' AND pt.state='confirmed'))
    ORDER BY f.next_check_at,f.due_at,f.root_id,f.step LIMIT 1`,
  )
    .bind(now, now, now, now, now, now)
    .first<any>();
  if (!row) return;
  // Back off blocked candidates so one failed mailbox cannot starve other campaigns.
  await env.DB.prepare(
    "UPDATE followup_steps SET next_check_at=? WHERE root_id=? AND step=?",
  )
    .bind(now + 60000, row.root_id, row.step)
    .run();
  const original = JSON.parse(row.snapshot) as Snapshot;
  original.attachments = followupAttachments(
    JSON.parse(row.authorization || "null"),
    original.attachments,
    row.step,
  );
  if (!(await allowedRecipient(env, original.recipient, row.user_id))) return;
  if (!/gmail.readonly|Mail.Read/.test(row.scopes)) return;
  const checkedAfter = Date.now();
  await env.DB.prepare(
    "UPDATE transports SET sync_checked_at=0 WHERE message_id=?",
  )
    .bind(row.root_id)
    .run();
  await syncReplies(env, network, row.user_id, row.root_id);
  const root = await env.DB.prepare(
    "SELECT m.status,t.sync_checked_at,t.sync_cursor FROM messages m JOIN transports t ON t.message_id=m.id WHERE m.id=?",
  )
    .bind(row.root_id)
    .first<any>();
  if (
    !root ||
    root.status !== "sent" ||
    root.sync_cursor ||
    root.sync_checked_at < checkedAfter
  )
    return;
  for (const doc of (row.revision_snapshot ? JSON.parse(row.revision_snapshot).attachments : original.attachments))
    await readyDocument(env, row.user_id, doc.id);
  const snapshot = row.revision_snapshot ? JSON.parse(row.revision_snapshot) : {
    ...original,
    subject: row.subject,
    body: row.body,
    key: row.child_id + "@ms-professor-agent.invalid",
    threadId: row.subject === original.subject ? row.thread_id : undefined,
    inReplyTo: original.key,
  };
  if(row.revision_snapshot){snapshot.threadId=snapshot.subject===original.subject?row.thread_id:undefined;snapshot.inReplyTo=original.key;}
  const due = row.revision_schedule || new Date(row.due_at).toISOString();
  await env.DB.batch([
    env.DB.prepare(
      `INSERT OR IGNORE INTO messages(id,user_id,professor_id,subject,body,mode,authorized,approved,status,scheduled_at,timezone,parent_id,live_ready)
      SELECT ?,?,?,?,?,'auto',1,1,'pending',?,?,?,1 WHERE EXISTS(SELECT 1 FROM followup_steps f JOIN messages m ON m.id=f.root_id JOIN connections c ON c.id=? WHERE f.root_id=? AND f.step=? AND f.queued=0 AND f.cancel_reason IS NULL AND m.status='sent' AND c.status='connected' AND COALESCE((SELECT version FROM current_message_revisions r WHERE r.message_id=f.child_id),0)=?)
      AND NOT EXISTS(SELECT 1 FROM suppressions WHERE user_id=? AND address=?)
      AND NOT EXISTS(SELECT 1 FROM professors WHERE id=? AND deleted_at IS NOT NULL)`,
    ).bind(
      row.child_id,
      row.user_id,
      row.professor_id,
      snapshot.subject,
      snapshot.body,
      due,
      row.timezone,
      row.parent_id,
      row.connection_id,
      row.root_id,
      row.step,
      row.revision_version,
      row.user_id,
      original.recipient.toLowerCase(),
      row.professor_id,
    ),
    env.DB.prepare(
      "INSERT OR IGNORE INTO transports(message_id,user_id,connection_id,snapshot) SELECT id,user_id,?,? FROM messages WHERE id=?",
    ).bind(row.connection_id, JSON.stringify(snapshot), row.child_id),
    env.DB.prepare(
      `INSERT OR IGNORE INTO message_authorizations(message_id,user_id,campaign_id,kind,parent_id,snapshot,authorized_at,followup_authorized)
      SELECT m.id,m.user_id,a.campaign_id,'followup',?,json_object('initial',json(?),'sending_account_id',?,'sequence_root',?,'step',?,'condition','only_if_no_reply'),a.authorized_at,0
      FROM messages m JOIN message_authorizations a ON a.message_id=? WHERE m.id=?`,
    ).bind(
      row.root_id,
      JSON.stringify(snapshot),
      row.connection_id,
      row.root_id,
      row.step,
      row.root_id,
      row.child_id,
    ),
    ...snapshot.attachments.map((doc: any) =>
      env.DB.prepare(
        "INSERT OR IGNORE INTO message_attachments(message_id,document_id,user_id) SELECT id,?,user_id FROM messages WHERE id=?",
      ).bind(doc.id, row.child_id),
    ),
    env.DB.prepare(
      "INSERT INTO audit(id,user_id,action,entity_id) SELECT ?,user_id,'sequence.step_queued',id FROM messages WHERE id=? AND EXISTS(SELECT 1 FROM followup_steps WHERE child_id=? AND queued=0)",
    ).bind(crypto.randomUUID(), row.child_id, row.child_id),
    env.DB.prepare(
      "UPDATE followup_steps SET queued=1 WHERE child_id=? AND EXISTS(SELECT 1 FROM transports WHERE message_id=?)",
    ).bind(row.child_id, row.child_id),
  ]);
}
