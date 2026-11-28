import { scheduleWork, backgroundReplies, quotaBlocked, d1QuotaError, backoffQuota } from "./read-quota";
import { messageCapacity } from "./message-capacity";
import { MESSAGE_CAPACITY_ERROR } from "../../../shared/message-capacity";
import {upcomingEmails,approveRevision} from "./message-revisions";
import { deleteDraft } from "./draft-deletion";
import { deleteCampaignWorkspace } from "./campaign-deletion";
import { archiveCampaign, campaignIdleSQL } from "./campaign-archive";
import { campaignNameSQL, duplicatePreview, renameCampaign, sendingUsage } from "./campaign-management";
import { cancelCampaign } from "./campaigns";
import { reimportDeleted } from "./reimport";
import { workspaceAccess, limitedWorkspaceState } from "./workspace-access";
import { approveFollowup } from "./followup-approval";
import { queueSequence } from "./followup-sequence";
import { securityPublic, securityPrivate } from "./security";
import { z } from "zod";
import { recordAction } from "./records";
import { approveGmail, retryGmail } from "./live-approval";
import {
  isLiveOwner,
  hasOutreachAccess,
  productionEnabled,
  activationEvidence,
  changeProductionMode,
  checkGmail,
  testRecipients,
} from "./live-controls";
import {
  spreadsheetDraft,
  normalizeSpreadsheetRow,
} from "../../../shared/spreadsheet";
import { validateSequence } from "../../../shared/followup-sequence";
import {
  accountPublic,
  accountPrivate,
  cleanDeletedAccounts,
} from "./accounts";
import { type Env, HttpError, consume } from "./runtime";
export type { Env } from "./runtime";
import {
  uploadDocument,
  downloadDocument,
  deleteDocument,
  readyDocument,
  cleanDocuments,
} from "./storage";
import { startOAuth, finishOAuth, disconnect, oauthAvailable } from "./oauth";
import {
  runLiveJobs,
  syncReplies,
  queueFollowups,
  transportSnapshot,
  liveEnabled,
} from "./automation";
import { generateDraft, templateDraft } from "./ai";
const id = () => crypto.randomUUID();
const json = (data: unknown, status = 200) => Response.json(data, { status });
const email = z
  .string()
  .email()
  .max(254)
  .transform((v) => v.toLowerCase());
const professorSchema = z.object({
  name: z.string().min(1).max(200),
  email,
  university: z.string().max(300).default(""),
  interests: z.string().max(2000).default(""),
});
const profileSchema = z.object({
  name: z.string().max(200),
  university: z.string().max(300),
  degree: z.string().max(200),
  gpa: z.string().max(30),
  interests: z.string().max(2000),
  timezone: z.string().refine(validTimezone),
});
export function validTimezone(value: string) {
  try {
    new Intl.DateTimeFormat("en", { timeZone: value });
    return true;
  } catch {
    return false;
  }
}
const messageSchema = z.object({
  professor_id: z.string().uuid(),
  subject: z
    .string()
    .min(1)
    .max(500)
    .refine((v) => !/[\r\n]/.test(v)),
  body: z.string().min(1).max(20000),
  mode: z.enum(["manual", "review", "auto"]),
  authorized: z.boolean().default(false),
  scheduled_at: z.string().datetime(),
  timezone: z.string().refine(validTimezone),
  attachments: z.array(z.string().uuid()).max(10).default([]),
  sending_account_id: z.string().uuid().nullable().optional(),
  followup: z
    .object({
      days: z.number().int().min(1).max(60),
      delay_value: z.number().int().min(1).max(86400).optional(),
      delay_unit: z.enum(["minutes", "hours", "days"]).optional(),
      subject: z
        .string()
        .min(1)
        .max(500)
        .refine((v) => !/[\r\n]/.test(v)),
      body: z.string().min(1).max(20000),
      authorized: z.literal(true),
    })
    .optional(),
});
export function canQueue(m: { mode: string; authorized: boolean }) {
  return m.mode === "auto" && m.authorized;
}
async function digest(value: string) {
  return Array.from(
    new Uint8Array(
      await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)),
    ),
    (b) => b.toString(16).padStart(2, "0"),
  ).join("");
}
export { passwordHash } from "./passwords";
const audit = (env: Env, user: string, action: string, entity = "") =>
  env.DB.prepare(
    "INSERT INTO audit(id,user_id,action,entity_id) VALUES(?,?,?,?)",
  ).bind(id(), user, action, entity);
async function authenticated(req: Request, env: Env) {
  const raw = req.headers
    .get("Cookie")
    ?.split(";")
    .map((x) => x.trim())
    .find((x) => x.startsWith("session="))
    ?.slice(8);
  if (!raw) throw new Error("Unauthorized");
  const session = await env.DB.prepare(
    "SELECT user_id FROM sessions WHERE token=? AND expires_at>?",
  )
    .bind(await digest(raw), Date.now())
    .first<{ user_id: string }>();
  if (!session) throw new Error("Unauthorized");
  return session.user_id;
}
async function owned(
  env: Env,
  table: "professors" | "documents" | "messages",
  entity: string,
  user: string,
) {
  const row = await env.DB.prepare(
    `SELECT * FROM ${table} WHERE id=? AND user_id=?`,
  )
    .bind(entity, user)
    .first();
  if (!row) throw new Error("Not found");
  return row;
}
export async function runJobs(env: Env, user?: string) {
  if (env.MOCK_DELIVERY_ENABLED === "false") return;
  // The mock delivery and status transition share one atomic SQL transaction.
  // A UNIQUE message_id is the idempotency boundary, even across overlapping ticks.
  await env.DB.batch([
    env.DB.prepare(
      `INSERT OR IGNORE INTO deliveries(message_id,provider_id)
      SELECT m.id,'mock-' || m.id FROM messages m JOIN profiles p ON p.user_id=m.user_id
      WHERE m.status='pending' AND m.approved=1 AND (m.mode!='auto' OR m.authorized=1)
      AND m.scheduled_at<=? AND p.paused=0 AND p.stopped=0 AND (? IS NULL OR m.user_id=?) AND NOT EXISTS(SELECT 1 FROM transports t WHERE t.message_id=m.id) ORDER BY m.scheduled_at LIMIT 20`,
    ).bind(new Date().toISOString(), user || null, user || null),
    env.DB.prepare(
      `INSERT INTO audit(id,user_id,action,entity_id) SELECT lower(hex(randomblob(16))),user_id,'mock.sent',id FROM messages WHERE status='pending' AND id IN (SELECT message_id FROM deliveries)`,
    ),
    env.DB.prepare(
      `UPDATE messages SET status='sent',sent_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE status='pending' AND id IN (SELECT message_id FROM deliveries)`,
    ),
  ]);
}
async function route(req: Request, env: Env): Promise<Response> {
  const url = new URL(req.url),
    path = url.pathname,
    method = req.method;
  if (path === "/api/health")
    return json({
      ok: true,
      provider: env.MOCK_DELIVERY_ENABLED === "false" ? "gmail" : "mock",
      gmail_ready: !!(await env.DB.prepare(
        "SELECT 1 ok FROM mailbox_checks k JOIN connections c ON c.id=k.connection_id WHERE k.status='ready' AND c.status='connected' AND k.checked_at>? LIMIT 1",
      )
        .bind(Date.now() - 3600000)
        .first()),
      storage: "kv",
      live_email: liveEnabled(env),
    });
  const callback = path.match(/^\/api\/oauth\/(gmail|outlook)\/callback$/);
  if (callback && method === "GET")
    return finishOAuth(env, req, callback[1] as "gmail" | "outlook");
  const publicSecurity = await securityPublic(req, env);
  if (publicSecurity) return publicSecurity;
  const publicAccount = await accountPublic(req, env);
  if (publicAccount) return publicAccount;
  const user = await authenticated(req, env);
  if (path === "/api/auth/logout") {
    if (method !== "POST") return json({ error: "Method not allowed" }, 405);
    const raw = req.headers
      .get("Cookie")
      ?.split(";")
      .map((x) => x.trim())
      .find((x) => x.startsWith("session="))
      ?.slice(8);
    await env.DB.prepare("DELETE FROM sessions WHERE token=?")
      .bind(await digest(raw!))
      .run();
    return new Response("{}", {
      headers: {
        "Set-Cookie": `session=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0${url.protocol === "https:" ? "; Secure" : ""}`,
      },
    });
  }
  const privateSecurity = await securityPrivate(req, env, user);
  if (privateSecurity) return privateSecurity;
  const privateAccount = await accountPrivate(req, env, user);
  if (privateAccount) return privateAccount;
  if (path === "/api/auth/google/start" && method === "POST") {
    z.object({ confirmed: z.literal(true) }).parse(await req.json());
    return startOAuth(env, user, req, "gmail", true, true);
  }
  const limitedWorkspace = await workspaceAccess(req, env, user);
  if (path === "/api/capacity" && method === "GET") return json(await messageCapacity(env,user,url.searchParams.get("import_id")));
  const followupApproval = path.match(
    /^\/api\/messages\/([^/]+)\/approve-followup$/,
  );
  if (followupApproval && method === "POST")
    return approveFollowup(env, user, followupApproval[1], await req.json());
  const recordResponse = await recordAction(req, env, user, path, method);
  if (recordResponse) return recordResponse;
  if (path === "/api/outreach/mode" && method === "POST") {
    const input = z
      .object({ production_enabled: z.boolean(), confirmed: z.literal(true) })
      .parse(await req.json());
    await changeProductionMode(env, user, input.production_enabled);
    return json({ ok: true });
  }
  const retry = path.match(/^\/api\/messages\/([^/]+)\/retry$/);
  if (retry && method === "POST") {
    z.object({ confirmed: z.literal(true) }).parse(await req.json());
    return retryGmail(env, user, retry[1]);
  }
  if (path === "/api/connections/check" && method === "POST") {
    await consume(env, `mailbox-check:${user}`, 5);
    await checkGmail(env, fetch, user);
    return json({ ok: true });
  }
  const connectionStart = path.match(
    /^\/api\/connections\/(gmail|outlook)\/start$/,
  );
  if (connectionStart && method === "POST") {
    const options = z
      .object({ read_replies: z.boolean().default(false) })
      .parse(await req.json());
    return startOAuth(
      env,
      user,
      req,
      connectionStart[1] as "gmail" | "outlook",
      options.read_replies,
    );
  }
  const connectionDelete = path.match(
    /^\/api\/connections\/([^/]+)\/disconnect$/,
  );
  if (connectionDelete && method === "POST")
    return disconnect(env, user, connectionDelete[1]);
  if (path === "/api/connections/sync" && method === "POST") {
    await consume(env, `manual-replies:${user}`, 10);
    await syncReplies(env, fetch, user);
    return json({ ok: true });
  }
  if (path === "/api/notifications/read" && method === "POST") {
    await env.DB.prepare("UPDATE notifications SET read=1 WHERE user_id=?")
      .bind(user)
      .run();
    return json({ ok: true });
  }
  const outcome = path.match(/^\/api\/messages\/([^/]+)\/outcome$/);
  if (outcome && method === "POST") {
    const message = await owned(env, "messages", outcome[1], user);
    const input = z
      .object({ kind: z.enum(["decline", "opt_out", "bounce"]) })
      .parse(await req.json());
    const transport = await env.DB.prepare(
      "SELECT snapshot FROM transports WHERE message_id=? AND user_id=?",
    )
      .bind(outcome[1], user)
      .first<any>();
    const professor = await owned(
      env,
      "professors",
      String(message.professor_id),
      user,
    );
    const address = transport
      ? JSON.parse(transport.snapshot).recipient
      : String(professor.email);
    await env.DB.batch([
      env.DB.prepare(
        "INSERT OR IGNORE INTO suppressions(user_id,address,reason) VALUES(?,?,?)",
      ).bind(user, address.toLowerCase(), input.kind),
      env.DB.prepare(
        "UPDATE messages SET status=?,followup_at=NULL WHERE id=? AND user_id=?",
      ).bind(input.kind === "bounce" ? "failed" : "replied", outcome[1], user),
      audit(env, user, "recipient." + input.kind, outcome[1]),
    ]);
    return json({ ok: true });
  }
  const cancelStep = path.match(
    /^\/api\/messages\/([^/]+)\/sequence\/([1-5])\/cancel$/,
  );
  if (cancelStep && method === "POST") {
    await owned(env, "messages", cancelStep[1], user);
    await env.DB.batch([
      env.DB.prepare(
        "UPDATE followup_steps SET cancel_reason=COALESCE(cancel_reason,'manual') WHERE root_id=? AND step>=?",
      ).bind(cancelStep[1], Number(cancelStep[2])),
      env.DB.prepare(
        "UPDATE messages SET status='cancelled' WHERE status IN ('draft','pending') AND id IN (SELECT child_id FROM followup_steps WHERE root_id=? AND step>=?)",
      ).bind(cancelStep[1], Number(cancelStep[2])),
      audit(env, user, "sequence.cancelled", cancelStep[1]),
    ]);
    return json({ ok: true });
  }
  if(path === "/api/campaigns/delete-draft" && method === "POST") return deleteDraft(env,user,await req.json());
  const upcomingMatch=path.match(/^\/api\/campaigns\/([^/]+)\/upcoming$/);
  if(upcomingMatch && method === "GET")return Response.json(await upcomingEmails(env,user,upcomingMatch[1]));
  if(upcomingMatch && method === "POST")return approveRevision(env,user,upcomingMatch[1],await req.json());
  const deleteCampaignMatch=path.match(/^\/api\/campaigns\/([^/]+)\/delete$/);
  if(deleteCampaignMatch && method === "POST") return deleteCampaignWorkspace(env,user,deleteCampaignMatch[1],await req.json());
  const archiveMatch=path.match(/^\/api\/campaigns\/([^/]+)\/(archive|restore)$/);
  if(archiveMatch && method === "POST") return archiveCampaign(env,user,archiveMatch[1],archiveMatch[2]==='restore');
  if (path === "/api/campaigns/duplicate-check" && method === "POST") return duplicatePreview(env,user,await req.json());
  if (path === "/api/sending/usage" && method === "GET") return Response.json(await sendingUsage(env,user));
  const activityMatch=path.match(/^\/api\/campaigns\/([^/]+)\/activity$/);
  if(activityMatch && method === "GET") {
    const campaign=await env.DB.prepare("SELECT id FROM campaign_approvals WHERE id=? AND user_id=?").bind(activityMatch[1],user).first();
    if(!campaign) throw new HttpError(404,"Campaign not found.");
    const before=z.coerce.number().int().positive().max(Number.MAX_SAFE_INTEGER).parse(new URL(req.url).searchParams.get("before") || Number.MAX_SAFE_INTEGER);
    const rows=await env.DB.prepare(`SELECT rowid cursor,id,action,entity_id,created_at FROM audit WHERE user_id=? AND rowid<? AND (entity_id=? OR entity_id IN (SELECT message_id FROM message_authorizations WHERE user_id=? AND campaign_id=?) OR entity_id IN (SELECT child_id FROM followup_steps WHERE root_id IN (SELECT message_id FROM message_authorizations WHERE user_id=? AND campaign_id=?))) ORDER BY rowid DESC LIMIT 101`).bind(user,before,activityMatch[1],user,activityMatch[1],user,activityMatch[1]).all<any>();
    return Response.json({activity:rows.results.slice(0,100),has_more:rows.results.length>100,next_cursor:rows.results.slice(0,100).at(-1)?.cursor || null});
  }
  const renameMatch=path.match(/^\/api\/campaigns\/([^/]+)\/name$/);
  if(renameMatch && method === "POST") return renameCampaign(env,user,renameMatch[1],await req.json());
  const cancelCampaignMatch = path.match(/^\/api\/campaigns\/([^/]+)\/cancel$/);
  if (cancelCampaignMatch && method === "POST")
    return cancelCampaign(env, user, cancelCampaignMatch[1]);
  const cancelAutomation = path.match(
    /^\/api\/messages\/([^/]+)\/automation\/cancel$/,
  );
  if (cancelAutomation && method === "POST") {
    await owned(env, "messages", cancelAutomation[1], user);
    await env.DB.batch([
      env.DB.prepare(
        "UPDATE followup_steps SET cancel_reason=COALESCE(cancel_reason,'manual') WHERE root_id=?",
      ).bind(cancelAutomation[1]),
      env.DB.prepare(
        "UPDATE messages SET status='cancelled' WHERE user_id=? AND status IN ('draft','pending') AND id IN (SELECT child_id FROM followup_steps WHERE root_id=?)",
      ).bind(user, cancelAutomation[1]),
      env.DB.prepare(
        "UPDATE automation SET generated=1,cancel_reason=COALESCE(cancel_reason,'manual') WHERE message_id=?",
      ).bind(cancelAutomation[1]),
      env.DB.prepare(
        "UPDATE messages SET status='cancelled' WHERE parent_id=? AND user_id=? AND status IN ('draft','pending')",
      ).bind(cancelAutomation[1], user),
    ]);
    return json({ ok: true });
  }
  if (path === "/api/suppressions" && method === "POST") {
    const input = z.object({ address: email }).parse(await req.json());
    await env.DB.prepare(
      "INSERT OR IGNORE INTO suppressions(user_id,address,reason) VALUES(?,?,'manual opt-out')",
    )
      .bind(user, input.address)
      .run();
    return json({ ok: true });
  }
  if (path === "/api/state" && method === "GET") {
    if (limitedWorkspace) return limitedWorkspaceState(env, user);
    const [profile, professors, documents, messages, history, account] =
      await Promise.all([
        env.DB.prepare("SELECT * FROM profiles WHERE user_id=?")
          .bind(user)
          .first(),
        env.DB.prepare(
          "SELECT * FROM professors WHERE user_id=? AND deleted_at IS NULL ORDER BY name",
        )
          .bind(user)
          .all(),
        env.DB.prepare(
          "SELECT id,name,size,content_type,expires_at,retained_until FROM documents WHERE user_id=? AND storage_state='ready' AND (expires_at IS NULL OR MAX(expires_at,COALESCE(retained_until,0))>?)",
        )
          .bind(user, Date.now())
          .all(),
        env.DB.prepare(
          "SELECT m.*,r.snapshot revision_snapshot,r.scheduled_at revision_schedule,r.version revision_version,CASE WHEN a.message_id IS NOT NULL AND a.generated=0 THEN json_object('days',a.days,'subject',a.subject,'body',a.body) END effective_followup,p.name professor_name,COALESCE(CASE WHEN json_valid(t.snapshot) THEN json_extract(t.snapshot,'$.recipient') END,m.approved_recipient,p.email) professor_email FROM messages m JOIN professors p ON p.id=m.professor_id LEFT JOIN transports t ON t.message_id=m.id LEFT JOIN automation a ON a.message_id=m.id LEFT JOIN current_message_revisions r ON r.message_id=m.id WHERE m.user_id=? AND NOT EXISTS(SELECT 1 FROM message_authorizations auth JOIN campaign_workspace_deletions d ON d.campaign_id=auth.campaign_id AND d.user_id=auth.user_id WHERE auth.message_id=m.id AND d.state='deleted') ORDER BY m.created_at DESC",
        )
          .bind(user)
          .all(),
        env.DB.prepare(
          "SELECT * FROM audit WHERE user_id=? ORDER BY created_at DESC,rowid DESC LIMIT 100",
        )
          .bind(user)
          .all(),
        env.DB.prepare(
          "SELECT email,first_name,last_name,display_name,email_verified_at,legacy_access FROM users WHERE id=?",
        )
          .bind(user)
          .first(),
      ]);
    const attachments = await env.DB.prepare(
      "SELECT * FROM message_attachments WHERE user_id=?",
    )
      .bind(user)
      .all();
    return json({
      profile,
      professors: professors.results,
      documents: documents.results,
      messages: messages.results.map((m) => ({
        ...m,
        ...(m.revision_snapshot ? {original_subject:m.subject,original_body:m.body,original_scheduled_at:m.scheduled_at,subject:JSON.parse(m.revision_snapshot as string).subject,body:JSON.parse(m.revision_snapshot as string).body,scheduled_at:m.revision_schedule||m.scheduled_at} : {}),
        followup_proposal: m.followup_proposal || m.effective_followup || null,
        attachments: m.revision_snapshot ? JSON.parse(m.revision_snapshot as string).attachments.map((d:any)=>d.id) : attachments.results
          .filter((a) => a.message_id === m.id)
          .map((a) => a.document_id),
      })),
      audit: history.results,
      account,
      connections: (
        await env.DB.prepare(
          "SELECT id,provider,address,status,scopes FROM connections WHERE user_id=?",
        )
          .bind(user)
          .all()
      ).results,
      capabilities: {
        workspace_limited: false,
        gmail: oauthAvailable(env, "gmail"),
        outlook: oauthAvailable(env, "outlook"),
        live_email: liveEnabled(env) && (await hasOutreachAccess(env, user)),
        mock_delivery: env.MOCK_DELIVERY_ENABLED !== "false",
        live_owner: !!env.LIVE_OWNER_USER_IDS?.trim() && isLiveOwner(env, user),
        production_outreach: await productionEnabled(env, user),
        test_recipients: testRecipients(env),
        activation: await activationEvidence(env, user),
        ai:
          env.AI_PROVIDER === "groq" &&
          env.GROQ_API_KEY &&
          env.GROQ_MODEL &&
          env.GROQ_FREE_PLAN_CONFIRMED === "true"
            ? "groq"
            : "mock",
      },
      notifications: (
        await env.DB.prepare(
          "SELECT id,kind,message,entity_id,created_at,read FROM notifications WHERE user_id=? ORDER BY created_at DESC LIMIT 50",
        )
          .bind(user)
          .all()
      ).results,
      scheduler: await env.DB.prepare(
        "SELECT * FROM scheduler_health WHERE id=1",
      ).first(),
      followup_steps: (
        await env.DB.prepare(
          "SELECT f.root_id,f.step,f.child_id,COALESCE(json_extract(r.snapshot,'$.subject'),f.subject) subject,COALESCE(json_extract(r.snapshot,'$.body'),f.body) body,f.delay_value,f.delay_unit,f.relative_to,f.authorized_at,COALESCE(CAST(round((julianday(r.scheduled_at)-2440587.5)*86400000) AS INTEGER),f.due_at) due_at,f.next_check_at,f.queued,f.cancel_reason,m.status root_status,c.status account_status,t.sync_checked_at,last.status sending_status,ct.state transport_state,ct.provider_id,ct.next_at,last.error FROM followup_steps f JOIN messages m ON m.id=f.root_id JOIN transports t ON t.message_id=m.id JOIN connections c ON c.id=t.connection_id LEFT JOIN messages last ON last.id=f.child_id LEFT JOIN transports ct ON ct.message_id=f.child_id LEFT JOIN current_message_revisions r ON r.message_id=f.child_id WHERE m.user_id=? ORDER BY f.root_id,f.step",
        )
          .bind(user)
          .all()
      ).results,
      automation: (
        await env.DB.prepare(
          "SELECT a.*,m.sent_at,m.status initial_status,m.professor_id,child.id followup_id,child.status child_status,ct.state child_transport_state,ct.provider_id followup_provider_id,t.provider_id initial_provider_id,s.reason suppression_reason FROM automation a JOIN messages m ON m.id=a.message_id LEFT JOIN transports t ON t.message_id=m.id LEFT JOIN messages child ON child.parent_id=m.id LEFT JOIN transports ct ON ct.message_id=child.id LEFT JOIN suppressions s ON s.user_id=m.user_id AND s.address=lower(COALESCE(json_extract(t.snapshot,'$.recipient'),m.approved_recipient)) WHERE m.user_id=?",
        )
          .bind(user)
          .all()
      ).results,
      transports: (
        await env.DB.prepare(
          "SELECT message_id,connection_id,state,provider_id,thread_id,attempts,next_at,sync_checked_at,sync_error FROM transports WHERE user_id=?",
        )
          .bind(user)
          .all()
      ).results,
      mailbox_checks: (
        await env.DB.prepare(
          "SELECT k.* FROM mailbox_checks k JOIN connections c ON c.id=k.connection_id WHERE c.user_id=?",
        )
          .bind(user)
          .all()
      ).results,
      delivery_attempts: (
        await env.DB.prepare(
          "SELECT a.* FROM delivery_attempts a JOIN messages m ON m.id=a.message_id WHERE m.user_id=? ORDER BY a.started_at DESC LIMIT 100",
        )
          .bind(user)
          .all()
      ).results,
      authorizations: (
        await env.DB.prepare(
          "SELECT * FROM message_authorizations WHERE user_id=? ORDER BY authorized_at DESC",
        )
          .bind(user)
          .all()
      ).results,
      sending_usage: await sendingUsage(env,user),
      reply_locations: (await env.DB.prepare("SELECT * FROM reply_locations WHERE user_id=?").bind(user).all()).results,
      campaigns: (
        await env.DB.prepare(
          `SELECT c.id,${campaignNameSQL} name,c.approved_at,c.initial_count,c.followup_count,c.sending_account_id,(SELECT archived_at FROM campaign_archives ar WHERE ar.campaign_id=c.id AND ar.user_id=c.user_id) archived_at,(${campaignIdleSQL}) can_archive,EXISTS(SELECT 1 FROM audit WHERE action='campaign.cancelled' AND entity_id=c.id AND user_id=c.user_id) cancelled FROM campaign_approvals c WHERE c.user_id=? AND NOT EXISTS(SELECT 1 FROM campaign_workspace_deletions d WHERE d.campaign_id=c.id AND d.user_id=c.user_id AND d.state='deleted') ORDER BY c.approved_at DESC`,
        )
          .bind(user)
          .all()
      ).results,
      followup_approvals: (
        await env.DB.prepare("SELECT * FROM followup_approvals WHERE user_id=?")
          .bind(user)
          .all()
      ).results,
      ai_usage: await env.DB.prepare(
        `SELECT COALESCE(SUM(requests),0) requests,COALESCE(SUM(tokens),0) tokens FROM ai_usage WHERE user_id=? AND created_at>=date('now')`,
      )
        .bind(user)
        .first(),
    });
  }
  if (path === "/api/profile" && method === "PUT") {
    const p = profileSchema.parse(await req.json());
    await env.DB.batch([
      env.DB.prepare(
        "UPDATE profiles SET name=?,university=?,degree=?,gpa=?,interests=?,timezone=? WHERE user_id=?",
      ).bind(
        p.name,
        p.university,
        p.degree,
        p.gpa,
        p.interests,
        p.timezone,
        user,
      ),
      audit(env, user, "profile.updated"),
    ]);
    return json({ ok: true });
  }
  const professorEdit = path.match(/^\/api\/professors\/([^/]+)$/);
  if (professorEdit && method === "PUT") {
    const editable = await owned(env, "professors", professorEdit[1], user);
    if (editable.deleted_at)
      throw new HttpError(409, "Deleted professor details cannot be edited.");
    const input = professorSchema.parse(await req.json());
    const duplicate = await env.DB.prepare(
      "SELECT id FROM professors WHERE user_id=? AND email=? AND id!=?",
    )
      .bind(user, input.email, professorEdit[1])
      .first();
    if (duplicate)
      throw new HttpError(
        409,
        "A professor with that email is already on your shortlist.",
      );
    const edited = await env.DB.prepare(
      "UPDATE professors SET name=?,email=?,university=?,interests=?,source_url=NULL,verified_at=NULL WHERE id=? AND user_id=? AND (email=? OR NOT EXISTS(SELECT 1 FROM messages WHERE professor_id=? AND user_id=?)) RETURNING id",
    )
      .bind(
        input.name,
        input.email,
        input.university,
        input.interests,
        professorEdit[1],
        user,
        input.email,
        professorEdit[1],
        user,
      )
      .first();
    if (!edited)
      throw new HttpError(
        409,
        "The email address is fixed once outreach exists. Add a new professor record for a different address.",
      );
    await audit(env, user, "professor.updated", professorEdit[1]).run();
    return json({ ok: true });
  }
  const professorVerify = path.match(/^\/api\/professors\/([^/]+)\/verify$/);
  if (professorVerify && method === "POST") {
    await owned(env, "professors", professorVerify[1], user);
    const source = z
      .object({
        source_url: z
          .string()
          .url()
          .max(2000)
          .refine((v) => {
            const u = new URL(v);
            return u.protocol === "https:" && !u.username && !u.password;
          }),
        confirmed: z.literal(true),
      })
      .parse(await req.json());
    await env.DB.batch([
      env.DB.prepare(
        "UPDATE professors SET source_url=?,verified_at=? WHERE id=? AND user_id=?",
      ).bind(source.source_url, Date.now(), professorVerify[1], user),
      audit(env, user, "professor.source_confirmed", professorVerify[1]),
    ]);
    return json({ ok: true });
  }
  if (path === "/api/professors" && method === "POST") {
    const rows = z
      .array(professorSchema)
      .min(1)
      .max(500)
      .parse(await req.json());
    // One INSERT plus audit, not 501 SQL queries on the Free plan.
    // Bound every JSON parameter well below D1's 2 MB value ceiling.
    const chunks: string[] = [];
    let values: string[] = [],
      size = 2;
    for (const row of rows) {
      const value = JSON.stringify({ id: id(), ...row }),
        bytes = new TextEncoder().encode(value).length;
      if (values.length && size + bytes + 1 > 900000) {
        chunks.push("[" + values.join(",") + "]");
        values = [];
        size = 2;
      }
      values.push(value);
      size += bytes + 1;
    }
    if (values.length) chunks.push("[" + values.join(",") + "]");
    const source = chunks
      .map(() => "SELECT value FROM json_each(?)")
      .join(" UNION ALL ");
    const results = await env.DB.batch([
      ...reimportDeleted(
        env,
        user,
        rows.map((r) => r.email),
      ),
      env.DB.prepare(
        `INSERT OR IGNORE INTO professors(id,user_id,name,email,university,interests) SELECT json_extract(value,'$.id'),?,json_extract(value,'$.name'),json_extract(value,'$.email'),json_extract(value,'$.university'),json_extract(value,'$.interests') FROM (${source})`,
      ).bind(user, ...chunks),
      audit(env, user, "professors.imported"),
    ]);
    return json({ imported: results[results.length - 2].meta.changes });
  }

  if (path === "/api/draft" && method === "POST") {
    const { professor_id, template, tone, manual_template } = z
      .object({
        professor_id: z.string().uuid(),
        template: z.number().int().min(0).max(2).default(0),
        tone: z
          .enum(["professional", "concise", "warm"])
          .default("professional"),
        manual_template: z.boolean().default(false),
      })
      .parse(await req.json());
    const p = await owned(env, "professors", professor_id, user);
    const profile = await env.DB.prepare(
      "SELECT * FROM profiles WHERE user_id=?",
    )
      .bind(user)
      .first();
    const draft =
      manual_template || env.AI_PROVIDER !== "groq"
        ? templateDraft(profile || {}, p, template)
        : await generateDraft(env, user, profile || {}, p);
    if (tone === "concise")
      draft.body = draft.body.replace(
        "I would be grateful to discuss whether my background could contribute to your research and whether funded positions or scholarships may be available.",
        "Could we discuss suitable MS research opportunities?",
      );
    if (tone === "warm")
      draft.body = draft.body.replace(
        "Thank you for your time.",
        "Thank you for considering my inquiry. I appreciate your time.",
      );
    return json(draft);
  }
  const editDraft = path.match(/^\/api\/messages\/([^/]+)$/);
  if (editDraft && method === "PUT") {
    const input = z
      .object({
        subject: z
          .string()
          .min(1)
          .max(500)
          .refine((v) => !/[\r\n]/.test(v)),
        body: z.string().min(1).max(20000),
      })
      .parse(await req.json());
    const result = await env.DB.batch([
      env.DB.prepare(
        "UPDATE messages SET subject=?,body=?,import_key=NULL WHERE id=? AND user_id=? AND status='draft' AND approved=0 AND NOT EXISTS(SELECT 1 FROM transports WHERE message_id=messages.id) AND NOT EXISTS(SELECT 1 FROM message_authorizations WHERE message_id=messages.id)",
      ).bind(input.subject, input.body, editDraft[1], user),
      audit(env, user, "draft.edit_requested", editDraft[1]),
    ]);
    if (!result[0].meta.changes)
      throw new HttpError(
        409,
        "Only an unapproved imported draft can be edited. Refresh its status.",
      );
    return json({ ok: true });
  }
  if (path === "/api/imports/drafts" && method === "POST") {
    const rowSchema = z.array(z.record(z.string(), z.unknown())).min(1).max(25);
    const request = z
      .union([
        rowSchema,
        z.object({ import_id: z.string().uuid(), rows: rowSchema }),
      ])
      .parse(await req.json());
    let input: Record<string, string>[];
    try {
      input = (Array.isArray(request) ? request : request.rows).map(
        normalizeSpreadsheetRow,
      );
    } catch (error) {
      throw new HttpError(400, (error as Error).message);
    }
    const recipientRows = new Map<string, string>();
    for (const row of input) {
      const key = row.email?.trim().toLowerCase() || "";
      const serialized = JSON.stringify(row);
      if (recipientRows.has(key) && recipientRows.get(key) !== serialized)
        throw new HttpError(
          400,
          "Conflicting duplicate campaign recipients are not allowed.",
        );
      recipientRows.set(key, serialized);
    }
    const active = (
      await env.DB.prepare(
        "SELECT id,email FROM professors WHERE user_id=? AND deleted_at IS NULL",
      )
        .bind(user)
        .all<{ id: string; email: string }>()
    ).results;
    const generation = new Map<string, string>();
    const rows = await Promise.all(
      input.map(async (row, i) => {
        let draft;
        try {
          draft = spreadsheetDraft(row, i, true);
        } catch (error) {
          throw new HttpError(400, (error as Error).message);
        }
        professorSchema.parse(draft);
        const professorId =
          active.find((p) => p.email === draft.email)?.id ||
          generation.get(draft.email) ||
          id();
        generation.set(draft.email, professorId);
        return {
          ...draft,
          id: id(),
          professor_id: professorId,
          import_key: "",
        };
      }),
    );
    const normalized = [
      ...new Map(
        rows.map(({ id: messageId, professor_id, import_key, ...draft }) => [
          draft.email,
          draft,
        ]),
      ).values(),
    ].sort((left, right) => left.email.localeCompare(right.email));
    const payloadHash = await digest(JSON.stringify(normalized));
    let importId: string;
    if (Array.isArray(request)) {
      const retired = await env.DB.prepare(
        "SELECT count(*) n FROM campaign_imports campaign WHERE campaign.user_id=? AND campaign.payload_hash=? AND EXISTS(SELECT 1 FROM messages m JOIN professors p ON p.id=m.professor_id WHERE m.user_id=campaign.user_id AND m.campaign_import_id=campaign.id AND (m.status!='draft' OR m.approved=1 OR m.archived_at IS NOT NULL OR m.hidden_at IS NOT NULL OR p.deleted_at IS NOT NULL))",
      )
        .bind(user, payloadHash)
        .first<{ n: number }>();
      importId =
        "legacy:" +
        (await digest(JSON.stringify([payloadHash, retired?.n || 0])));
    } else importId = request.import_id;
    const previous = await env.DB.prepare(
      "SELECT payload_hash, NOT EXISTS(SELECT 1 FROM messages m WHERE m.user_id=campaign_imports.user_id AND m.campaign_import_id=campaign_imports.id AND m.status!='cancelled' AND NOT EXISTS(SELECT 1 FROM message_authorizations a JOIN campaign_workspace_deletions d ON d.campaign_id=a.campaign_id AND d.user_id=a.user_id WHERE a.message_id=m.id AND d.state='deleted')) can_start_new_import FROM campaign_imports WHERE user_id=? AND id=?",
    )
      .bind(user, importId)
      .first<{ payload_hash: string; can_start_new_import: number }>();
    if (previous) {
      if (previous.payload_hash !== payloadHash)
        throw new HttpError(
          409,
          "Import changed; start a new campaign instead of reusing its submission ID.",
        );
      const drafts = (
        await env.DB.prepare(
          "SELECT m.id,m.professor_id,m.status,m.subject,m.body,m.scheduled_at,m.timezone,m.followup_proposal,m.followup_issue,m.followup_draft,m.campaign_import_id,COALESCE(m.approved_recipient,p.deleted_email,p.email) professor_email,p.name professor_name FROM messages m JOIN professors p ON p.id=m.professor_id WHERE m.user_id=? AND m.campaign_import_id=?",
        )
          .bind(user, importId)
          .all()
      ).results;
      return json({
        import_id: importId,
        can_start_new_import: !!previous.can_start_new_import,
        created: 0,
        skipped: rows.length,
        drafts,
        reimported: [],
      });
    }
    for (const row of rows) row.import_key = importId + ":" + row.email;
    // Reserve the bounded import budget before a single atomic transaction. Retries
    // may consume budget but can never create a second copy of the same email.
    await consume(env, `messages:${user}`, 50, rows.length);
    await consume(env, "messages:global", 500, rows.length);
    const reimported = (
      await env.DB.prepare(
        "SELECT email FROM professors WHERE user_id=? AND deleted_at IS NOT NULL AND email IN (SELECT json_extract(value,'$.email') FROM json_each(?))",
      )
        .bind(user, JSON.stringify(rows))
        .all<{ email: string }>()
    ).results.map((r) => r.email);
    const payload = JSON.stringify(rows);
    const results = await env.DB.batch([
      env.DB.prepare(
        "INSERT OR IGNORE INTO campaign_imports(user_id,id,payload_hash,created_at) VALUES(?,?,?,?)",
      ).bind(user, importId, payloadHash, Date.now()),
      ...reimportDeleted(
        env,
        user,
        rows.map((r) => r.email),
      ),
      env.DB.prepare(
        `INSERT INTO professors(id,user_id,name,email,university,interests)
        SELECT json_extract(value,'$.professor_id'),?,json_extract(value,'$.name'),json_extract(value,'$.email'),json_extract(value,'$.university'),json_extract(value,'$.interests') FROM json_each(?) WHERE 1
        ON CONFLICT(user_id,email) DO NOTHING`,
      ).bind(user, payload),
      env.DB.prepare(
        `INSERT INTO messages(id,user_id,professor_id,subject,body,mode,authorized,approved,status,scheduled_at,timezone,followup_proposal,import_key,approved_recipient,followup_issue,followup_draft,campaign_import_id)
        SELECT json_extract(j.value,'$.id'),?,p.id,json_extract(j.value,'$.subject'),json_extract(j.value,'$.body'),'manual',0,0,'draft',json_extract(j.value,'$.scheduled_at'),json_extract(j.value,'$.timezone'),json_extract(j.value,'$.followup_proposal'),json_extract(j.value,'$.import_key'),json_extract(j.value,'$.email'),json_extract(j.value,'$.followup_issue'),json_extract(j.value,'$.followup_draft'),?
        FROM json_each(?) j JOIN professors p ON p.user_id=? AND p.email=json_extract(j.value,'$.email')
        WHERE p.deleted_at IS NULL AND NOT EXISTS(SELECT 1 FROM messages m WHERE m.user_id=p.user_id AND m.campaign_import_id=? AND m.approved_recipient=json_extract(j.value,'$.email'))
        ON CONFLICT DO NOTHING`,
      ).bind(user, importId, payload, user, importId),
      audit(env, user, "spreadsheet.drafts_imported"),
    ]).catch((error) => {
      if (error instanceof Error && error.message.includes("Import changed"))
        throw new HttpError(
          409,
          "Import changed; start a new campaign instead of reusing its submission ID.",
        );
      throw error;
    });
    const created = results[results.length - 2].meta.changes;
    const drafts = (
      await env.DB.prepare(
        "SELECT m.id,m.professor_id,m.status,m.subject,m.body,m.scheduled_at,m.timezone,m.followup_proposal,m.followup_issue,m.followup_draft,m.campaign_import_id,p.email professor_email,p.name professor_name FROM messages m JOIN professors p ON p.id=m.professor_id WHERE m.user_id=? AND m.campaign_import_id=?",
      )
        .bind(user, importId)
        .all()
    ).results;
    return json({
      import_id: importId,
      created,
      skipped: rows.length - created,
      drafts,
      reimported,
    });
  }
  if (path === "/api/messages" && method === "POST") {
    const m = messageSchema.parse(await req.json());
    if (
      m.followup?.delay_unit &&
      (!m.followup.delay_value ||
        m.followup.delay_value *
          { minutes: 60000, hours: 3600000, days: 86400000 }[
            m.followup.delay_unit
          ] >
          60 * 86400000)
    )
      throw new HttpError(
        400,
        "Flexible follow-up delays must be positive and no longer than 60 days.",
      );
    if (env.MOCK_DELIVERY_ENABLED === "false" && m.mode === "auto")
      throw new HttpError(
        400,
        "Save the draft, then approve its exact content in Review before scheduling.",
      );
    const recipient = await owned(env, "professors", m.professor_id, user);
    if (recipient.deleted_at || recipient.archived_at)
      throw new HttpError(
        409,
        "Restore an archived professor before creating mail; deleted professors cannot receive mail.",
      );
    for (const attachment of m.attachments)
      await readyDocument(env, user, attachment);
    await consume(env, `messages:${user}`, 50);
    await consume(env, "messages:global", 500);
    const messageId = id(),
      queued = canQueue(m);
    const modernFollowup = m.followup?.delay_unit
      ? {
          days: 1,
          subject: m.followup.subject,
          body: m.followup.body,
          steps: validateSequence([
            {
              subject: m.followup.subject,
              body: m.followup.body,
              delay_value: m.followup.delay_value,
              delay_unit: m.followup.delay_unit,
              relative_to: "original",
            },
          ]),
        }
      : null;
    if (modernFollowup && queued)
      throw new HttpError(
        400,
        "Save a draft and review the entire flexible sequence before approving.",
      );
    const snapshot = m.sending_account_id
      ? await transportSnapshot(
          env,
          user,
          m.sending_account_id,
          String(recipient.email),
          m.subject,
          m.body,
          m.attachments,
          messageId,
        )
      : null;
    if (m.followup && !snapshot)
      throw new HttpError(
        400,
        "Automatic follow-up requires a connected live test sending account.",
      );
    if (m.followup) {
      const connection = await env.DB.prepare(
        "SELECT scopes FROM connections WHERE id=? AND user_id=?",
      )
        .bind(m.sending_account_id!, user)
        .first<any>();
      if (!/gmail.readonly|Mail.Read/.test(connection?.scopes || ""))
        throw new HttpError(
          409,
          "Automatic follow-up requires reply synchronization access.",
        );
    }
    await env.DB.batch([
      env.DB.prepare(
        "INSERT INTO messages(id,user_id,professor_id,subject,body,mode,authorized,approved,status,scheduled_at,timezone,live_ready,approved_recipient) VALUES(?,?,?,?,?,?,?,?,?,?,?,1,?)",
      ).bind(
        messageId,
        user,
        m.professor_id,
        m.subject,
        m.body,
        m.mode,
        +m.authorized,
        +queued,
        queued ? "pending" : "draft",
        m.scheduled_at,
        m.timezone,
        String(recipient.email),
      ),
      ...(snapshot
        ? [
            env.DB.prepare(
              "INSERT INTO transports(message_id,user_id,connection_id,snapshot) VALUES(?,?,?,?)",
            ).bind(
              messageId,
              user,
              m.sending_account_id!,
              JSON.stringify(snapshot),
            ),
          ]
        : []),
      ...(modernFollowup
        ? [
            env.DB.prepare(
              "UPDATE messages SET followup_proposal=? WHERE id=?",
            ).bind(JSON.stringify(modernFollowup), messageId),
          ]
        : []),
      ...(m.followup && !modernFollowup
        ? [
            env.DB.prepare(
              "INSERT INTO automation(message_id,days,subject,body) VALUES(?,?,?,?)",
            ).bind(
              messageId,
              m.followup.days,
              m.followup.subject,
              m.followup.body,
            ),
          ]
        : []),
      ...Array.from(new Set(m.attachments)).map((doc) =>
        env.DB.prepare(
          "INSERT INTO message_attachments(message_id,document_id,user_id) VALUES(?,?,?)",
        ).bind(messageId, doc, user),
      ),
      audit(
        env,
        user,
        queued ? "auto.explicitly_authorized" : "draft.created",
        messageId,
      ),
    ]);
    return json({ id: messageId });
  }
  if (path === "/api/messages/approve" && method === "POST") {
    const approval = await req.json();
    const dryRun =
      typeof approval === "object" &&
      approval !== null &&
      "dry_run" in approval &&
      approval.dry_run === true;
    if (env.MOCK_DELIVERY_ENABLED === "false" || dryRun)
      return approveGmail(env, user, approval);
    const { ids } = z
      .object({ ids: z.array(z.string().uuid()).min(1).max(500) })
      .parse(approval);
    const uniqueIds = Array.from(new Set(ids)),
      serializedIds = JSON.stringify(uniqueIds);
    const rows = (
      await env.DB.prepare(
        "SELECT * FROM messages WHERE user_id=? AND id IN (SELECT value FROM json_each(?))",
      )
        .bind(user, serializedIds)
        .all<any>()
    ).results;
    if (rows.length !== uniqueIds.length) throw new HttpError(404, "Not found");
    if (
      rows.some((m) => m.status !== "draft" || m.mode === "auto") ||
      (rows.length > 1 && rows.some((m) => m.mode !== "manual"))
    )
      return json(
        {
          error:
            "AI drafts require individual review. Auto mode requires authorization at creation.",
        },
        400,
      );
    await env.DB.batch([
      env.DB.prepare(
        "INSERT INTO audit(id,user_id,action,entity_id) SELECT lower(hex(randomblob(16))),user_id,'draft.approved',id FROM messages WHERE user_id=? AND status='draft' AND id IN (SELECT value FROM json_each(?))",
      ).bind(user, serializedIds),
      env.DB.prepare(
        "UPDATE messages SET approved=1,status='pending' WHERE user_id=? AND status='draft' AND id IN (SELECT value FROM json_each(?))",
      ).bind(user, serializedIds),
    ]);
    return json({ ok: true });
  }
  if (path === "/api/control" && method === "POST") {
    const { action } = z
      .object({ action: z.enum(["pause", "resume", "stop"]) })
      .parse(await req.json());
    await env.DB.batch([
      env.DB.prepare(
        "UPDATE profiles SET paused=?,stopped=? WHERE user_id=?",
      ).bind(action === "pause" ? 1 : 0, action === "stop" ? 1 : 0, user),
      ...(action === "stop"
        ? [
            env.DB.prepare(
              "UPDATE messages SET status='cancelled' WHERE user_id=? AND status IN ('draft','pending')",
            ).bind(user),
          ]
        : []),
      audit(env, user, `outreach.${action}`),
    ]);
    return json({ ok: true });
  }
  const failureMatch = path.match(
    /^\/api\/messages\/([^/]+)\/simulate-failure$/,
  );
  if (failureMatch && method === "POST") {
    if (env.MOCK_DELIVERY_ENABLED === "false")
      throw new HttpError(404, "Not found");
    await owned(env, "messages", failureMatch[1], user);
    await env.DB.batch([
      env.DB.prepare(
        "UPDATE messages SET status='failed',error='Simulated provider failure — no email sent' WHERE id=? AND user_id=? AND status='pending' AND NOT EXISTS(SELECT 1 FROM deliveries WHERE message_id=messages.id)",
      ).bind(failureMatch[1], user),
      audit(env, user, "mock.failure_simulated", failureMatch[1]),
    ]);
    return json({ ok: true });
  }
  const messageMatch = path.match(
    /^\/api\/messages\/([^/]+)\/(cancel|reply|followup)$/,
  );
  if (messageMatch && method === "POST") {
    const [, messageId, action] = messageMatch;
    const m = await owned(env, "messages", messageId, user);
    if (action === "cancel") {
      // Cancellation is idempotent, including when initial mail already sent.
      // Never changes delivery evidence or recalls accepted mail.
      await env.DB.batch([
        env.DB.prepare(
          "UPDATE messages SET status='cancelled' WHERE id=? AND user_id=? AND status IN ('draft','pending')",
        ).bind(messageId, user),
        env.DB.prepare(
          "UPDATE automation SET generated=1,cancel_reason=COALESCE(cancel_reason,'manual') WHERE message_id=?",
        ).bind(messageId),
        env.DB.prepare(
          "UPDATE messages SET status='cancelled' WHERE parent_id=? AND user_id=? AND status IN ('draft','pending')",
        ).bind(messageId, user),
        audit(env, user, "message.cancelled", messageId),
      ]);
    } else if (action === "reply") {
      if (m.status !== "sent") throw new Error("Invalid state");
      await env.DB.batch([
        env.DB.prepare(
          "UPDATE messages SET status='replied',followup_at=NULL WHERE id=? AND user_id=? AND status='sent'",
        ).bind(messageId, user),
        audit(env, user, "reply.manually_recorded", messageId),
      ]);
    } else {
      const { date } = z
        .object({ date: z.string().datetime() })
        .parse(await req.json());
      if (m.status !== "sent") throw new Error("Invalid state");
      await env.DB.batch([
        env.DB.prepare(
          "UPDATE messages SET followup_at=? WHERE id=? AND user_id=? AND status='sent'",
        ).bind(date, messageId, user),
        audit(env, user, "followup.reminder_set", messageId),
      ]);
    }
    return json({ ok: true });
  }
  if (path === "/api/jobs/run" && method === "POST") {
    if (env.MOCK_DELIVERY_ENABLED === "false")
      throw new HttpError(404, "Not found");
    await runJobs(env, user);
    return json({ ok: true });
  }
  if (path === "/api/documents" && method === "POST")
    return uploadDocument(req, env, user);
  const docMatch = path.match(/^\/api\/documents\/([^/]+)$/);
  if (docMatch && method === "GET")
    return downloadDocument(env, user, docMatch[1]);
  const docDelete = path.match(/^\/api\/documents\/([^/]+)\/delete$/);
  if (docDelete && method === "POST")
    return deleteDocument(env, user, docDelete[1]);

  return json({ error: "Not found" }, 404);
}
export default {
  async fetch(req: Request, env: Env) {
    const origin = req.headers.get("Origin");
    let res: Response;
    try {
      let configured = false;
      try {
        const allowed = new URL(env.APP_ORIGIN);
        configured =
          allowed.origin === env.APP_ORIGIN &&
          (allowed.protocol === "https:" ||
            (allowed.protocol === "http:" && allowed.hostname === "localhost"));
      } catch {
        /* Fail closed. */
      }
      if (!configured || !env.DB || !env.DOCUMENTS_KV)
        throw new HttpError(503, "Backend configuration is incomplete.");
      if (origin && origin !== env.APP_ORIGIN)
        res = json({ error: "Origin denied" }, 403);
      else if (req.method === "OPTIONS")
        res = new Response(null, { status: 204 });
      else if (
        !["GET", "HEAD"].includes(req.method) &&
        origin !== env.APP_ORIGIN
      )
        res = json({ error: "Origin required" }, 403);
      else if (
        Number(req.headers.get("Content-Length") || 0) >
        11 * 1024 * 1024
      )
        res = json({ error: "Request too large" }, 413);
      else {
        if (
          !["GET", "HEAD", "OPTIONS"].includes(req.method) &&
          new URL(req.url).pathname !== "/api/documents" &&
          req.body
        ) {
          const path = new URL(req.url).pathname;
          const limit = path.startsWith("/api/auth/")
            ? 65536
            : path === "/api/professors"
              ? 11 * 1024 * 1024
              : path === "/api/messages/approve" || /^\/api\/campaigns\/[^/]+\/upcoming$/.test(path)
                ? 11 * 1024 * 1024
                : path === "/api/imports/drafts"
                  ? 5 * 1024 * 1024
                  : 131072;
          const reader = req.body.getReader(),
            chunks: Uint8Array[] = [];
          let total = 0;
          while (true) {
            const next = await reader.read();
            if (next.done) break;
            total += next.value.length;
            if (total > limit) {
              await reader.cancel();
              throw new HttpError(413, "Request body is too large.");
            }
            chunks.push(next.value);
          }
          const body = new Uint8Array(total);
          let offset = 0;
          for (const chunk of chunks) {
            body.set(chunk, offset);
            offset += chunk.length;
          }
          req = new Request(req, { body });
        }
        res = await route(req, env);
      }
    } catch (e) {
      if (e instanceof HttpError) {
        res = json({ error: e.message }, e.status);
        if (e.retryAfter) res.headers.set("Retry-After", String(e.retryAfter));
      } else if (
        e &&
        typeof e === "object" &&
        "message" in e &&
        typeof e.message === "string" &&
        e.message.includes("Message storage quota reached")
      )
        res = json(
          {
            error:
              MESSAGE_CAPACITY_ERROR,
          },
          429,
        );
      else if (e instanceof SyntaxError)
        res = json({ error: "Invalid JSON request." }, 400);
      else if (e instanceof z.ZodError)
        res = json(
          {
            error: e.issues
              .map((x) => `${x.path.join(".")}: ${x.message}`)
              .join("; "),
          },
          400,
        );
      else {
        const message = e instanceof Error ? e.message : "";
        const status =
          message === "Unauthorized"
            ? 401
            : message === "Not found"
              ? 404
              : message === "Invalid state"
                ? 409
                : 500;
        res = json(
          { error: status === 500 ? "Unable to complete request" : message },
          status,
        );
      }
    }
    const headers = new Headers(res.headers);
    headers.set("Access-Control-Allow-Origin", env.APP_ORIGIN);
    headers.set("Access-Control-Allow-Credentials", "true");
    headers.set("Access-Control-Allow-Headers", "Content-Type");
    headers.set("Access-Control-Allow-Methods", "GET,POST,PUT,OPTIONS");
    headers.set("Vary", "Origin");
    // Every response, including auth failures and origin denial, is uncacheable.
    headers.set("Cache-Control", "private, no-store, max-age=0");
    headers.set("CDN-Cache-Control", "no-store");
    headers.set("Vercel-CDN-Cache-Control", "no-store");
    headers.set("X-Content-Type-Options", "nosniff");
    headers.set("Referrer-Policy", "no-referrer");
    return new Response(res.body, { status: res.status, headers });
  },
  async scheduled(_event: ScheduledEvent, env: Env) {
    if (!env.DB || !env.DOCUMENTS_KV) return;
    if (await quotaBlocked(env)) return;
    try {
    await env.DB.prepare(
      "INSERT INTO scheduler_health(id,started_at,failure) VALUES(1,?,NULL) ON CONFLICT(id) DO UPDATE SET started_at=excluded.started_at,failure=NULL",
    )
      .bind(Date.now())
      .run();
      // Sending and due follow-ups run on every minute tick; stored schedules are untouched.
      await runJobs(env);
      await queueFollowups(env);
      await queueSequence(env);
      await runLiveJobs(env);
      const work = scheduleWork(_event.scheduledTime || Date.now());
      await backgroundReplies(env, _event.scheduledTime || Date.now());
      if (work.maintenance) {
        await checkGmail(env);
        await cleanDocuments(env);
        await cleanDeletedAccounts(env);
        await env.DB.prepare(
          "DELETE FROM oauth_states WHERE state_hash IN (SELECT state_hash FROM oauth_states WHERE expires_at<? LIMIT 20)",
        )
          .bind(Date.now())
          .run();
        await env.DB.prepare(
          `DELETE FROM usage_counters WHERE rowid IN (SELECT rowid FROM usage_counters WHERE period<date('now','-2 days') LIMIT 20)`,
        ).run();
      }
      await env.DB.prepare(
        "UPDATE scheduler_health SET completed_at=? WHERE id=1",
      )
        .bind(Date.now())
        .run();
    } catch (error) {
      if (d1QuotaError(error)) {
        await backoffQuota(env);
        throw error;
      }
      await env.DB.prepare(
        "UPDATE scheduler_health SET failure='Scheduled execution failed; inspect Worker logs' WHERE id=1",
      ).run();
      throw error;
    }
  },
};
