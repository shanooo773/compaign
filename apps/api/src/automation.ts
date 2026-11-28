import { campaignNameSQL } from "./campaign-management";
import { followupAttachments } from "./campaign-attachments";
import { type Env, HttpError, consume, notify, random, hash } from "./runtime";
import { accessToken, oauthAvailable } from "./oauth";
import { hasOutreachAccess, productionEnabled } from "./live-controls";
import { MAX_FOLLOWUPS } from "../../../shared/followup-sequence";
import {
  emailProvider,
  ProviderError,
  type ProviderName,
  type Fetcher,
  type Receipt,
} from "./providers";
import { readyDocument, documentBytes, FILE_LIMIT } from "./storage";
export function liveEnabled(env: Env) {
  return (
    env.LIVE_EMAIL_ENABLED === "true" &&
    env.OAUTH_ENABLED === "true" &&
    !!env.TOKEN_ENCRYPTION_KEY &&
    !!env.LIVE_TEST_RECIPIENTS?.trim()
  );
}
export async function allowedRecipient(
  env: Env,
  address: string,
  user?: string,
) {
  if (!liveEnabled(env) || (user && !(await hasOutreachAccess(env, user))))
    return false;
  return (
    (env.LIVE_TEST_RECIPIENTS || "")
      .split(",")
      .map((v) => v.trim().toLowerCase())
      .includes(address.toLowerCase()) ||
    (!!user && (await productionEnabled(env, user)))
  );
}
export type Snapshot = {
  recipient: string;
  subject: string;
  body: string;
  attachments: {
    id: string;
    checksum: string | null;
    size: number;
    name: string;
    content_type: string;
  }[];
  key: string;
  threadId?: string;
  inReplyTo?: string;
};
export async function transportSnapshot(
  env: Env,
  user: string,
  connectionId: string,
  recipient: string,
  subject: string,
  body: string,
  attachments: string[],
  messageId: string,
) {
  if (!(await allowedRecipient(env, recipient, user)))
    throw new HttpError(
      403,
      "Live sending is disabled or this controlled test recipient is not authorized.",
    );
  const connection = await env.DB.prepare(
    "SELECT * FROM connections WHERE id=? AND user_id=? AND status='connected'",
  )
    .bind(connectionId, user)
    .first<any>();
  if (!connection) throw new HttpError(404, "Sending account not found");
  if (connection.provider === "gmail" && !/gmail.send/.test(connection.scopes))
    throw new HttpError(409, "Reconnect Gmail with sending permission.");
  if (
    connection.provider === "outlook" &&
    !/\bMail.Read\b/.test(connection.scopes)
  )
    throw new HttpError(
      409,
      "Reconnect Outlook with reply access to confirm sent messages.",
    );
  if (!oauthAvailable(env, connection.provider))
    throw new HttpError(503, "Sending provider configuration is incomplete.");
  const docs = [];
  let total = 0;
  for (const id of new Set(attachments)) {
    const doc = await readyDocument(env, user, id);
    total += doc.size;
    docs.push({
      id,
      checksum: doc.checksum,
      size: doc.size,
      name: doc.name,
      content_type: doc.content_type,
    });
  }
  if (total > FILE_LIMIT || docs.length > 3)
    throw new HttpError(
      400,
      "Live email supports at most 3 attachments totaling 2 MiB.",
    );
  return {
    recipient,
    subject,
    body,
    attachments: docs,
    key: messageId + "@ms-professor-agent.invalid",
  } satisfies Snapshot;
}
async function receipt(env: Env, row: any, result: Receipt) {
  if (!result.id) return;
  const acceptedAt = result.acceptedAt || new Date().toISOString();
  await env.DB.batch([
    env.DB.prepare(
      "INSERT OR IGNORE INTO deliveries(message_id,provider,provider_id) VALUES(?,?,?)",
    ).bind(row.message_id, row.provider, row.connection_id + ":" + result.id),
    env.DB.prepare(
      "UPDATE delivery_attempts SET outcome='accepted' WHERE message_id=? AND attempt=(SELECT attempts FROM transports WHERE message_id=?)",
    ).bind(row.message_id, row.message_id),
    env.DB.prepare(
      "UPDATE transports SET state='confirmed',provider_id=?,thread_id=?,lease=NULL,lease_until=0,next_sync=? WHERE message_id=?",
    ).bind(result.id, result.threadId, Date.now() + 300000, row.message_id),
    env.DB.prepare(
      "UPDATE messages SET status='sent',sent_at=? WHERE id=? AND status='pending'",
    ).bind(acceptedAt, row.message_id),
    env.DB.prepare(
      "UPDATE automation SET due_at=?+days*86400000 WHERE message_id=? AND due_at IS NULL",
    ).bind(Date.parse(acceptedAt), row.message_id),
    env.DB.prepare(
      "INSERT INTO audit(id,user_id,action,entity_id) VALUES(?,?,'provider.sent_confirmed',?)",
    ).bind(crypto.randomUUID(), row.user_id, row.message_id),
  ]);

}
async function fail(env: Env, row: any, kind: string) {
  await env.DB.batch([
    env.DB.prepare(
      "UPDATE transports SET state='failed',lease=NULL WHERE message_id=?",
    ).bind(row.message_id),
    env.DB.prepare(
      "UPDATE messages SET status='failed',error=? WHERE id=? AND status='pending'",
    ).bind(
      kind === "reconnect"
        ? "Reconnect your sending account."
        : "Email could not be sent. Review the notification.",
      row.message_id,
    ),
  ]);
  await notify(
    env,
    row.user_id,
    kind,
    kind === "reconnect"
      ? "Reconnect your mailbox before scheduling new mail."
      : "Email failed before confirmed delivery. Review before trying again.",
    row.message_id,
  );
}
export async function runLiveJobs(env: Env, network: Fetcher = fetch) {
  if (env.OAUTH_ENABLED !== "true" || !env.TOKEN_ENCRYPTION_KEY) return;
  const maySend = liveEnabled(env);
  const now = Date.now();
  await env.DB.prepare(
    "UPDATE transports SET state='uncertain',next_at=?,lease=NULL WHERE state='submitting' AND lease_until<?",
  )
    .bind(now, now)
    .run();
  await env.DB.prepare(
    "UPDATE transports SET state='waiting',lease=NULL WHERE state='leased' AND lease_until<?",
  )
    .bind(now)
    .run();
  const rows = await env.DB.prepare(
    `SELECT t.*,r.snapshot revision_snapshot,COALESCE(r.version,0) revision_version,c.provider,c.address,c.subject AS account_subject,c.status AS account_status,c.scopes,c.tokens,c.expires_at,c.refresh_until,c.refresh_lease,m.status AS message_status,m.parent_id FROM transports t JOIN messages m ON m.id=t.message_id JOIN connections c ON c.id=t.connection_id JOIN profiles p ON p.user_id=t.user_id LEFT JOIN current_message_revisions r ON r.message_id=t.message_id WHERE t.state IN ('waiting','uncertain') AND t.next_at<=? AND ((t.state='uncertain') OR (?=1 AND m.status='pending' AND m.live_ready=1 AND NOT EXISTS(SELECT 1 FROM professors pr WHERE pr.id=m.professor_id AND pr.deleted_at IS NOT NULL) AND m.approved=1 AND (m.mode!='auto' OR m.authorized=1) AND COALESCE(r.scheduled_at,m.scheduled_at)<=? AND p.paused=0 AND p.stopped=0)) ORDER BY t.next_at,t.message_id LIMIT 1`,
  )
    .bind(now, +maySend, new Date().toISOString())
    .all<any>();
  for (const row of rows.results) {
    const snapshot = JSON.parse(row.revision_snapshot || row.snapshot) as Snapshot;
    const sequence = await env.DB.prepare(
      "SELECT * FROM followup_steps WHERE child_id=?",
    )
      .bind(row.message_id)
      .first<any>();
    const replyParent = sequence?.root_id || row.parent_id;
    if (sequence && row.state !== "uncertain" && sequence.cancel_reason)
      continue;
    if (
      row.state !== "uncertain" &&
      !(await allowedRecipient(env, snapshot.recipient, row.user_id))
    )
      continue;
    if (!oauthAvailable(env, row.provider)) continue;
    if (row.account_status !== "connected") {
      if (row.state !== "uncertain") await fail(env, row, "reconnect");
      continue;
    }
    const connection = {
      ...row,
      id: row.connection_id,
      status: row.account_status,
    };
    const provider = emailProvider(row.provider as ProviderName, network);
    if (row.state === "uncertain") {
      const lease = random();
      const claimed = await env.DB.prepare(
        "UPDATE transports SET next_at=?,lease=? WHERE message_id=? AND state='uncertain' AND next_at<=? RETURNING message_id",
      )
        .bind(now + 300000, lease, row.message_id, now)
        .first();
      if (!claimed) continue;
      try {
        const token = await accessToken(env, connection, network);
        const found = await provider.reconcile(token, snapshot.key);
        if (found?.id) await receipt(env, row, found);
      } catch (error) {
        if (error instanceof ProviderError && error.kind === "reconnect") {
          await env.DB.prepare(
            "UPDATE connections SET status='reconnect',tokens=NULL WHERE id=?",
          )
            .bind(row.connection_id)
            .run();
          await notify(
            env,
            row.user_id,
            "reconnect",
            "Reconnect with reply access to reconcile the uncertain delivery. It will not be automatically resent.",
            row.message_id,
          );
        }
        /* Never retry a send because reconciliation failed or found nothing. */
      }
      continue;
    }
    if (row.parent_id && !sequence) {
      // A queued child may wait through quota backoff. Recheck its parent thread
      // at submission time; a failed/partial read must invalidate old evidence.
      const checkedAfter = Date.now();
      await env.DB.prepare(
        "UPDATE transports SET sync_checked_at=0 WHERE message_id=?",
      )
        .bind(replyParent)
        .run();
      await syncReplies(env, network, row.user_id, replyParent);
      const parent = await env.DB.prepare(
        "SELECT m.status,t.sync_checked_at,t.sync_cursor FROM messages m JOIN transports t ON t.message_id=m.id WHERE m.id=? AND m.user_id=?",
      )
        .bind(replyParent, row.user_id)
        .first<any>();
      if (
        !parent ||
        parent.status !== "sent" ||
        parent.sync_cursor ||
        parent.sync_checked_at < checkedAfter
      )
        continue;
    }
    const suppressed = await env.DB.prepare(
      "SELECT address FROM suppressions WHERE user_id=? AND address=?",
    )
      .bind(row.user_id, snapshot.recipient.toLowerCase())
      .first();
    if (suppressed) {
      await fail(env, row, "suppressed");
      continue;
    }
    if (row.attempts >= row.max_attempts) {
      await fail(env, row, "failed");
      continue;
    }
    const lease = random();
    const claimed = await env.DB.prepare(
      `UPDATE transports SET state='leased',lease=?,lease_until=? WHERE message_id=? AND state='waiting' AND next_at<=? AND COALESCE((SELECT version FROM current_message_revisions r WHERE r.message_id=transports.message_id),0)=? AND EXISTS(SELECT 1 FROM messages m LEFT JOIN current_message_revisions r ON r.message_id=m.id WHERE m.id=transports.message_id AND m.status='pending' AND COALESCE(r.scheduled_at,m.scheduled_at)<=?) RETURNING message_id`,
    )
      .bind(lease, now + 120000, row.message_id, now, row.revision_version, new Date(now).toISOString())
      .first();
    if (!claimed) continue;
    let submitted = false, attemptRecorded = false;
    try {
      await consume(
        env,
        `send:${row.user_id}:minute`,
        1,
        1,
        new Date().toISOString().slice(0, 16),
      );
      await consume(env, "send:global:day", 100);
      // Same provider identity shares a budget even across application users.
      const mailbox = await hash(row.provider + ":" + row.account_subject);
      await consume(
        env,
        `send:mailbox:${mailbox}:minute`,
        1,
        1,
        new Date().toISOString().slice(0, 16),
      );
      const token = await accessToken(env, connection, network),
        attachments = [];
      for (const attachment of snapshot.attachments) {
        const doc = await readyDocument(env, row.user_id, attachment.id);
        if (
          doc.checksum !== attachment.checksum ||
          doc.size !== attachment.size
        )
          throw new HttpError(409, "Approved attachment changed.");
        attachments.push({
          name: attachment.name,
          type: attachment.content_type,
          bytes: await documentBytes(env, doc),
        });
      }
      if (sequence && row.revision_snapshot) {
        const parent=await env.DB.prepare("SELECT COALESCE(r.snapshot,t.snapshot) snapshot,t.thread_id FROM transports t LEFT JOIN current_message_revisions r ON r.message_id=t.message_id WHERE t.message_id=?").bind(sequence.root_id).first<any>();
        if(parent){const original=JSON.parse(parent.snapshot);snapshot.threadId=snapshot.subject===original.subject?parent.thread_id:undefined;snapshot.inReplyTo=original.key;}
      }
      if (sequence) {
        const prior = await env.DB.prepare(
          "SELECT t.message_id,t.thread_id FROM transports t JOIN messages m ON m.id=t.message_id WHERE t.state='confirmed' AND t.thread_id IS NOT NULL AND (m.id=? OR m.id IN (SELECT child_id FROM followup_steps WHERE root_id=?)) ORDER BY m.sent_at,t.message_id",
        )
          .bind(sequence.root_id, sequence.root_id)
          .all<any>();
        const threads = new Set<string>(),
          messageIds: string[] = [];
        for (const previous of prior.results) {
          if (!threads.has(previous.thread_id)) {
            threads.add(previous.thread_id);
            messageIds.push(previous.message_id);
          }
        }
        if (
          !threads.size ||
          !(await syncReplies(env, network, row.user_id, messageIds))
        )
          throw new HttpError(
            503,
            "A complete reply check of every earlier Gmail thread is required before sending.",
          );
      } else if (row.parent_id) {
        const checkedAfter = Date.now();
        await env.DB.prepare(
          "UPDATE transports SET sync_checked_at=0 WHERE message_id=?",
        )
          .bind(replyParent)
          .run();
        await syncReplies(env, network, row.user_id, replyParent);
        const parent = await env.DB.prepare(
          "SELECT m.status,t.sync_checked_at,t.sync_cursor FROM messages m JOIN transports t ON t.message_id=m.id WHERE m.id=? AND m.user_id=?",
        )
          .bind(replyParent, row.user_id)
          .first<any>();
        if (
          !parent ||
          parent.status !== "sent" ||
          parent.sync_cursor ||
          parent.sync_checked_at < checkedAfter
        )
          throw new HttpError(
            503,
            "A fresh complete reply check is required before sending.",
          );
      }
      // Last D1 fence before the external side effect; do not trust stale approval/account state.
      const fenced = await env.DB.prepare(
        `UPDATE transports SET state='submitting',attempts=attempts+1 WHERE message_id=? AND lease=? AND state='leased' AND EXISTS(SELECT 1 FROM messages m JOIN profiles p ON p.user_id=m.user_id JOIN connections c ON c.id=? WHERE m.id=? AND m.status='pending' AND m.live_ready=1 AND NOT EXISTS(SELECT 1 FROM professors pr WHERE pr.id=m.professor_id AND pr.deleted_at IS NOT NULL) AND m.approved=1 AND (m.mode!='auto' OR m.authorized=1) AND p.paused=0 AND p.stopped=0 AND c.status='connected' AND (m.parent_id IS NULL OR EXISTS(SELECT 1 FROM messages parent WHERE parent.id=m.parent_id AND parent.status='sent'))) AND NOT EXISTS(SELECT 1 FROM suppressions WHERE user_id=? AND address=?) RETURNING message_id`,
      )
        .bind(
          row.message_id,
          lease,
          row.connection_id,
          row.message_id,
          row.user_id,
          snapshot.recipient.toLowerCase(),
        )
        .first();
      if (!fenced) {
        await env.DB.prepare(
          "UPDATE transports SET state='waiting',lease=NULL,next_at=? WHERE message_id=? AND lease=? AND state='leased'",
        )
          .bind(now + 60000, row.message_id, lease)
          .run();
        continue;
      }
      try {
      await env.DB.prepare(
        "INSERT INTO delivery_attempts(id,message_id,attempt,started_at,outcome) SELECT ?,message_id,attempts,?,'submitting' FROM transports WHERE message_id=?",
      )
        .bind(crypto.randomUUID(), Date.now(), row.message_id)
        .run();
        attemptRecorded = true;
      } catch (error) {
        if(error instanceof Error && /Rolling sending allowance exhausted/.test(error.message)) {
          await env.DB.prepare("UPDATE transports SET attempts=MAX(0,attempts-1) WHERE message_id=? AND lease=?").bind(row.message_id,lease).run();
          throw new HttpError(429,"Rolling sending allowance exhausted; approved message postponed.");
        }
        throw error;
      }
      submitted = true;
      const result = await provider.send(token, {
        ...snapshot,
        messageKey: snapshot.key,
        attachments,
      });
      if (result.id) await receipt(env, row, result);
      else {
        await env.DB.prepare(
          "UPDATE transports SET state='uncertain',next_at=?,lease=NULL WHERE message_id=?",
        )
          .bind(now + 60000, row.message_id)
          .run();
        await notify(
          env,
          row.user_id,
          "uncertain",
          "Provider accepted the request; sent-message confirmation is pending. No automatic resend will occur.",
          row.message_id,
        );
      }
    } catch (error) {
      if(attemptRecorded) await env.DB.prepare(
        "UPDATE delivery_attempts SET outcome=? WHERE message_id=? AND attempt=(SELECT attempts FROM transports WHERE message_id=?)",
      )
        .bind(
          submitted &&
            (!(error instanceof ProviderError) || error.kind === "uncertain")
            ? "uncertain"
            : error instanceof ProviderError
              ? error.kind
              : "failed_before_send",
          row.message_id,
          row.message_id,
        )
        .run();
      if (
        submitted &&
        (!(error instanceof ProviderError) || error.kind === "uncertain")
      ) {
        await env.DB.prepare(
          "UPDATE transports SET state='uncertain',next_at=?,lease=NULL WHERE message_id=?",
        )
          .bind(now + 300000, row.message_id)
          .run();
        await notify(
          env,
          row.user_id,
          "uncertain",
          "Delivery outcome is uncertain. Reconciliation will run before any further action; this email will not be blindly retried.",
          row.message_id,
        );
      } else if (
        (error instanceof ProviderError && error.kind === "retry") ||
        (error instanceof HttpError && [429, 503].includes(error.status))
      ) {
        const delay = Math.max(
          60000,
          Math.min(
            3600000,
            (error instanceof ProviderError ? error.retryAfter * 1000 : 60000) *
              2 ** row.attempts,
          ),
        );
        await env.DB.prepare(
          "UPDATE transports SET state='waiting',next_at=?,lease=NULL WHERE message_id=? AND lease=?",
        )
          .bind(
            now + delay + Math.floor(Math.random() * 1000),
            row.message_id,
            lease,
          )
          .run();
      } else {
        if (error instanceof ProviderError && error.kind === "reconnect") {
          await env.DB.prepare(
            "UPDATE connections SET status='reconnect',tokens=NULL WHERE id=?",
          )
            .bind(row.connection_id)
            .run();
        }
        await fail(
          env,
          row,
          error instanceof ProviderError ? error.kind : "failed",
        );
      }
    }
  }
}
export async function syncReplies(
  env: Env,
  network: Fetcher = fetch,
  user?: string,
  messageId?: string | string[],
  backgroundNextSync?: number,
) {
  if (env.OAUTH_ENABLED !== "true" || !env.TOKEN_ENCRYPTION_KEY) return false;
  let complete = true;
  const ids = messageId
    ? Array.isArray(messageId)
      ? messageId
      : [messageId]
    : null;
  const grouped = Array.isArray(messageId);
  if (ids && (!ids.length || ids.length > MAX_FOLLOWUPS + 1)) return false;
  const encodedIds = ids ? JSON.stringify(ids) : null;
  const now = Date.now();
  const nextSync = backgroundNextSync ?? now + 3600000;
  const rows = await env.DB.prepare(
    `SELECT t.*,m.sent_at,c.provider,c.status AS account_status,c.scopes,c.tokens,c.expires_at,c.refresh_until,c.refresh_lease FROM transports t JOIN messages m ON m.id=t.message_id JOIN connections c ON c.id=t.connection_id WHERE t.state='confirmed' AND t.thread_id IS NOT NULL AND ${ids ? 't.message_id IN (SELECT value FROM json_each(?))' : 't.next_sync<=?'} AND c.status='connected' AND NOT EXISTS(SELECT 1 FROM message_authorizations auth JOIN campaign_workspace_deletions d ON d.campaign_id=auth.campaign_id AND d.user_id=auth.user_id WHERE auth.message_id=m.id AND d.state='deleted') AND m.sent_at>? AND (? IS NULL OR t.user_id=?) AND (? IS NULL OR t.message_id IN (SELECT value FROM json_each(?))) ORDER BY t.next_sync LIMIT ?`,
  )
    .bind(
      ids ? encodedIds : now,
      ids
        ? "1970-01-01T00:00:00.000Z"
        : new Date(now - 67 * 86400000).toISOString(),
      user || null,
      user || null,
      encodedIds,
      encodedIds,
      ids ? ids.length : user ? 2 : 5,
    )
    .all<any>();
  if (!rows.results.length || (ids && rows.results.length !== ids.length))
    return false;
  // One bounded quota reservation for all prior threads avoids per-thread D1 overhead.
  if (grouped) {
    try {
      await consume(env, "mailbox:global:polls", 20000, rows.results.length);
    } catch {
      await env.DB.prepare(
        "UPDATE transports SET sync_checked_at=0,sync_error='Mailbox polling limit reached; sending postponed' WHERE message_id IN (SELECT value FROM json_each(?))",
      )
        .bind(encodedIds)
        .run();
      return false;
    }
  }
  const groupedUpdates: {
    id: string;
    cursor: string | null;
    checked: number;
    partial: number;
  }[] = [];
  const replyProviders=new Map<string,ReturnType<typeof emailProvider>>();
  const searchSince=rows.results.map(r=>r.sent_at).sort()[0];
  for (const row of rows.results) {
    if (!oauthAvailable(env, row.provider)) {
      complete = false;
      continue;
    }
    if (!grouped)
      await env.DB.prepare(
        "UPDATE transports SET next_sync=? WHERE message_id=?",
      )
        .bind(nextSync, row.message_id)
        .run();
    if (!/gmail.readonly|Mail.Read/.test(row.scopes)) {
      complete = false;
      continue;
    }
    try {
      if (!grouped) await consume(env, "mailbox:global:polls", 20000);
      const token = await accessToken(
        env,
        { ...row, id: row.connection_id, status: row.account_status },
        network,
      );
      const snapshot = JSON.parse(row.snapshot) as Snapshot;
      if(!replyProviders.has(row.connection_id)) replyProviders.set(row.connection_id,emailProvider(row.provider,network));
      const result = await replyProviders.get(row.connection_id)!.replies(
        token,
        row.thread_id,
        row.sync_cursor,
        {recipient:snapshot.recipient,key:snapshot.key,sentAt:searchSince},
      );
      const known = new Set(
        (result.events.length
          ? (
              await env.DB.prepare(
                "SELECT provider_id FROM mailbox_events WHERE connection_id=? AND message_id=? ORDER BY rowid DESC LIMIT 200",
              )
                .bind(row.connection_id, row.message_id)
                .all<any>()
            ).results
          : []
        ).map((event) => event.provider_id),
      );
      let processed = 0,
        partial = false;
      for (const event of result.events) {
        const sender = (event.sender.match(/<([^>]+)>/)?.[1] || event.sender)
          .trim()
          .toLowerCase();
        if (
          !event.id ||
          !Number.isFinite(Date.parse(event.receivedAt)) ||
          Date.parse(event.receivedAt) <= Date.parse(row.sent_at)
        )
          continue;
        if (!event.bounce && (event.labels?.includes("SENT") || sender !== snapshot.recipient.trim().toLowerCase()))
          continue;
        const replyDescription = !event.bounce && event.labels ? await recordReplyLocation(env,row,event) : "A reply was received. Follow-up automation has stopped.";
        if (known.has(event.id)) continue;
        if (processed >= 1) {
          partial = true;
          break;
        }
        processed++;
        const kind = event.bounce
          ? "bounce"
          : /\b(unsubscribe|opt.out|do not contact|not interested|decline|no positions|no openings)\b/i.test(
                event.text,
              )
            ? "decline"
            : "reply";
        await env.DB.batch([
          env.DB.prepare(
            "INSERT OR IGNORE INTO mailbox_events(connection_id,provider_id,message_id,kind,received_at) VALUES(?,?,?,?,?)",
          ).bind(
            row.connection_id,
            event.id,
            row.message_id,
            kind,
            event.receivedAt,
          ),
          env.DB.prepare(
            "UPDATE messages SET status=CASE WHEN ?='bounce' THEN 'failed' ELSE 'replied' END,followup_at=NULL WHERE user_id=? AND status='sent' AND (id=? OR (?!='bounce' AND (id IN (SELECT root_id FROM followup_steps WHERE child_id=?) OR id=(SELECT parent_id FROM messages WHERE id=?))))",
          ).bind(kind,row.user_id,row.message_id,kind,row.message_id,row.message_id),
          env.DB.prepare(
            "UPDATE automation SET generated=1 WHERE message_id=?",
          ).bind(row.message_id),
          env.DB.prepare(
            "UPDATE messages SET status='cancelled' WHERE parent_id=? AND status IN ('draft','pending')",
          ).bind(row.message_id),
          ...(kind !== "reply"
            ? [
                env.DB.prepare(
                  "INSERT OR IGNORE INTO suppressions(user_id,address,reason) VALUES(?,?,?)",
                ).bind(row.user_id, snapshot.recipient.toLowerCase(), kind),
              ]
            : []),
          env.DB.prepare(
            "INSERT OR IGNORE INTO notifications(id,user_id,kind,message,entity_id) VALUES(?,?,?,?,?)",
          ).bind(
            "event:" + row.connection_id + ":" + event.id,
            row.user_id,
            kind,
            kind === "reply"
              ? replyDescription
              : "A decline, opt-out or bounce was detected. Further sending to this recipient is blocked.",
            row.message_id,
          ),
        ]);
      }
      if (grouped)
        groupedUpdates.push({
          id: row.message_id,
          cursor: partial ? row.sync_cursor : result.cursor,
          checked: partial || result.cursor ? 0 : Date.now(),
          partial: +(partial || !!result.cursor),
        });
      else
        await env.DB.prepare(
          "UPDATE transports SET sync_cursor=?,sync_checked_at=?,sync_error=CASE WHEN ?=1 THEN 'Incomplete mailbox check; sending postponed' ELSE NULL END,next_sync=? WHERE message_id=?",
        )
          .bind(
            partial ? row.sync_cursor : result.cursor,
            partial || result.cursor ? 0 : Date.now(),
            +(partial || !!result.cursor),
            nextSync,
            row.message_id,
          )
          .run();
      complete = complete && !partial && !result.cursor && processed === 0;
      if (grouped && !complete && backgroundNextSync === undefined) break;
    } catch (error) {
      complete = false;
      await env.DB.prepare(
        "UPDATE transports SET sync_checked_at=0,sync_error='Reply check failed; sending postponed until a complete check succeeds' WHERE message_id=?",
      )
        .bind(row.message_id)
        .run();
      if (error instanceof ProviderError && error.kind === "reconnect") {
        await env.DB.prepare(
          "UPDATE connections SET status='reconnect',tokens=NULL WHERE id=?",
        )
          .bind(row.connection_id)
          .run();
        await notify(
          env,
          row.user_id,
          "reconnect",
          "Reply synchronization needs mailbox reconnection.",
          row.connection_id,
        );
      }
    }
  }
  if (groupedUpdates.length)
    await env.DB.prepare(
      "UPDATE transports SET sync_cursor=(SELECT json_extract(value,'$.cursor') FROM json_each(?) WHERE json_extract(value,'$.id')=transports.message_id),sync_checked_at=(SELECT json_extract(value,'$.checked') FROM json_each(?) WHERE json_extract(value,'$.id')=transports.message_id),sync_error=CASE WHEN (SELECT json_extract(value,'$.partial') FROM json_each(?) WHERE json_extract(value,'$.id')=transports.message_id)=1 THEN 'Incomplete mailbox check; sending postponed' ELSE NULL END,next_sync=? WHERE message_id IN (SELECT json_extract(value,'$.id') FROM json_each(?))",
    )
      .bind(
        JSON.stringify(groupedUpdates),
        JSON.stringify(groupedUpdates),
        JSON.stringify(groupedUpdates),
        nextSync,
        JSON.stringify(groupedUpdates),
      )
      .run();
  return complete;
}
export async function queueFollowups(env: Env, network: Fetcher = fetch) {
  if (!liveEnabled(env)) return;
  const rows = await env.DB.prepare(
    `SELECT a.*,(SELECT snapshot FROM message_authorizations auth WHERE auth.message_id=m.id) authorization,m.user_id,m.professor_id,m.timezone,m.sent_at,t.connection_id,t.thread_id,t.snapshot,t.sync_checked_at,t.sync_cursor,c.status AS account_status,c.scopes FROM automation a JOIN messages m ON m.id=a.message_id JOIN transports t ON t.message_id=m.id JOIN connections c ON c.id=t.connection_id JOIN profiles p ON p.user_id=m.user_id WHERE a.generated=0 AND NOT EXISTS(SELECT 1 FROM professors pr WHERE pr.id=m.professor_id AND pr.deleted_at IS NOT NULL) AND m.live_ready=1 AND m.parent_id IS NULL AND m.status='sent' AND p.paused=0 AND p.stopped=0 AND c.status='connected' AND COALESCE(a.due_at,CAST((julianday(m.sent_at)-2440587.5)*86400000 AS INTEGER)+a.days*86400000)<=? ORDER BY COALESCE(a.due_at,0),a.message_id LIMIT 1`,
  )
    .bind(Date.now())
    .all<any>();
  for (const row of rows.results) {
    const snapshot = JSON.parse(row.snapshot) as Snapshot;
    snapshot.attachments = followupAttachments(
      JSON.parse(row.authorization || "null"),
      snapshot.attachments,
      1,
    );
    if (row.sync_checked_at <= Date.now() - 60000 || row.sync_cursor) {
      const checkedAfter = Date.now();
      await env.DB.prepare(
        "UPDATE transports SET sync_checked_at=0 WHERE message_id=?",
      )
        .bind(row.message_id)
        .run();
      await syncReplies(env, network, row.user_id, row.message_id);
      const parent = await env.DB.prepare(
        "SELECT m.status,t.sync_checked_at,t.sync_cursor FROM messages m JOIN transports t ON t.message_id=m.id WHERE m.id=?",
      )
        .bind(row.message_id)
        .first<any>();
      if (
        !parent ||
        parent.status !== "sent" ||
        parent.sync_cursor ||
        parent.sync_checked_at < checkedAfter
      )
        continue;
    }
    if (
      !(await allowedRecipient(env, snapshot.recipient, row.user_id)) ||
      !/gmail.readonly|Mail.Read/.test(row.scopes)
    )
      continue;
    const suppression = await env.DB.prepare(
      "SELECT address FROM suppressions WHERE user_id=? AND address=?",
    )
      .bind(row.user_id, snapshot.recipient)
      .first();
    if (suppression) continue;
    try {
      for (const doc of snapshot.attachments)
        await readyDocument(env, row.user_id, doc.id);
    } catch {
      await env.DB.prepare(
        "UPDATE automation SET generated=1 WHERE message_id=?",
      )
        .bind(row.message_id)
        .run();
      await notify(
        env,
        row.user_id,
        "followup",
        "Follow-up stopped because an attachment is unavailable.",
        row.message_id,
      );
      continue;
    }
    const id = crypto.randomUUID(),
      now = new Date(
        row.due_at ?? Date.parse(row.sent_at) + row.days * 86400000,
      ).toISOString(),
      next = {
        ...snapshot,
        subject: row.subject,
        body: row.body,
        key: id + "@ms-professor-agent.invalid",
        threadId: row.subject === snapshot.subject ? row.thread_id : undefined,
        inReplyTo: snapshot.key,
      };
    try {
      await env.DB.batch([
        env.DB.prepare(
          `INSERT OR IGNORE INTO messages(id,user_id,professor_id,subject,body,mode,authorized,approved,status,scheduled_at,timezone,parent_id,live_ready) SELECT ?,?,?,?,?,'auto',1,1,'pending',?,?,?,1 WHERE EXISTS(SELECT 1 FROM messages m JOIN automation a ON a.message_id=m.id JOIN connections c ON c.id=? WHERE m.id=? AND m.status='sent' AND a.generated=0 AND c.status='connected') AND NOT EXISTS(SELECT 1 FROM suppressions WHERE user_id=? AND address=?)`,
        ).bind(
          id,
          row.user_id,
          row.professor_id,
          row.subject,
          row.body,
          now,
          row.timezone,
          row.message_id,
          row.connection_id,
          row.message_id,
          row.user_id,
          snapshot.recipient,
        ),
        env.DB.prepare(
          "INSERT INTO transports(message_id,user_id,connection_id,snapshot) SELECT id,user_id,?,? FROM messages WHERE id=?",
        ).bind(row.connection_id, JSON.stringify(next), id),
        env.DB.prepare(
          "INSERT INTO message_authorizations(message_id,user_id,campaign_id,kind,parent_id,snapshot,authorized_at,followup_authorized) SELECT m.id,m.user_id,a.campaign_id,'followup',?,json_object('initial',json(?),'sending_account_id',?,'scheduled_at',m.scheduled_at,'timezone',m.timezone,'parent_authorization',a.message_id,'followup',NULL,'condition','only_if_no_reply','maximum_followups',0),a.authorized_at,0 FROM messages m JOIN message_authorizations a ON a.message_id=m.parent_id WHERE m.id=? AND a.followup_authorized=1",
        ).bind(row.message_id, JSON.stringify(next), row.connection_id, id),
        env.DB.prepare(
          "INSERT INTO message_authorizations(message_id,user_id,campaign_id,kind,parent_id,snapshot,authorized_at,followup_authorized) SELECT m.id,m.user_id,'separate:' || f.message_id,'followup',m.parent_id,json_object('initial',json(?),'sending_account_id',?,'parent_authorization',f.message_id,'followup',NULL,'condition','only_if_no_reply','maximum_followups',0),f.authorized_at,0 FROM messages m JOIN followup_approvals f ON f.message_id=m.parent_id WHERE m.id=? AND NOT EXISTS(SELECT 1 FROM message_authorizations WHERE message_id=m.id)",
        ).bind(JSON.stringify(next), row.connection_id, id),
        ...snapshot.attachments.map((doc) =>
          env.DB.prepare(
            "INSERT INTO message_attachments(message_id,document_id,user_id) SELECT id,?,user_id FROM messages WHERE id=?",
          ).bind(doc.id, id),
        ),
        env.DB.prepare(
          "INSERT INTO audit(id,user_id,action,entity_id) SELECT ?,user_id,'followup.preapproved_queued',id FROM messages WHERE id=?",
        ).bind(crypto.randomUUID(), id),
        env.DB.prepare(
          "UPDATE automation SET generated=1 WHERE message_id=? AND EXISTS(SELECT 1 FROM messages WHERE parent_id=?)",
        ).bind(row.message_id, row.message_id),
      ]);
    } catch (error) {
      if (
        error &&
        typeof error === "object" &&
        "message" in error &&
        typeof error.message === "string" &&
        error.message.includes("Message storage quota reached")
      ) {
        await env.DB.prepare(
          "UPDATE automation SET generated=1 WHERE message_id=?",
        )
          .bind(row.message_id)
          .run();
        await notify(
          env,
          row.user_id,
          "followup",
          "Automatic follow-up could not be queued because active workspace capacity was reached. The plan has stopped; review active drafts and follow-ups.",
          row.message_id,
        );
      } else throw error;
    }
  }
}

export function replyLocation(labels:string[]) {
 if(labels.includes("TRASH")) return "Trash";
 if(labels.includes("SPAM")) return "Spam";
 if(labels.includes("INBOX")) return "Inbox";
 return labels.some(label=>label.startsWith("Label_")) ? "Custom label / Archived" : "Archived / All Mail";
}
async function recordReplyLocation(env:Env,row:any,event:import("./providers").MailEvent){
 const location=replyLocation(event.labels || []);
 const detail=await env.DB.prepare(`SELECT p.name,${campaignNameSQL} campaign_name FROM messages m JOIN professors p ON p.id=m.professor_id LEFT JOIN message_authorizations a ON a.message_id=m.id LEFT JOIN campaign_approvals c ON c.id=a.campaign_id AND c.user_id=m.user_id WHERE m.id=? AND m.user_id=?`).bind(row.message_id,row.user_id).first<any>();
 const professor=detail?.name || "Professor", campaign=detail?.campaign_name || "Outreach campaign";
 const warning=location==="Spam" || location==="Trash";
 const id="event:"+row.connection_id+":"+event.id;
 await env.DB.batch([
 env.DB.prepare("INSERT INTO reply_locations(connection_id,provider_id,user_id,message_id,location,labels,checked_at) VALUES(?,?,?,?,?,?,?) ON CONFLICT(connection_id,provider_id) DO UPDATE SET location=excluded.location,labels=excluded.labels,checked_at=excluded.checked_at WHERE reply_locations.user_id=excluded.user_id AND (reply_locations.location IS NOT excluded.location OR reply_locations.labels IS NOT excluded.labels)").bind(row.connection_id,event.id,row.user_id,row.message_id,location,JSON.stringify(event.labels),Date.now()),
 ...(warning ? [env.DB.prepare("INSERT INTO notifications(id,user_id,kind,message,entity_id) VALUES(?,?,'reply_warning',?,?) ON CONFLICT(id) DO UPDATE SET kind=excluded.kind,message=excluded.message WHERE notifications.user_id=excluded.user_id AND (notifications.kind IS NOT excluded.kind OR notifications.message IS NOT excluded.message)").bind("location:"+id,row.user_id,`Reply received in ${location} from ${professor} ? ${campaign}. Check your connected Gmail ${location} folder.`,row.message_id)] : [env.DB.prepare("UPDATE notifications SET kind='reply_location',message=? WHERE id=? AND user_id=?").bind(`Reply from ${professor} ? ${campaign}. Location: ${location}.`,"location:"+id,row.user_id)]),
 ]);
 return `${professor} replied to your email ? ${campaign}.`;
}
