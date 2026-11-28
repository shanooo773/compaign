import { type Env, HttpError, consume, hash } from "./runtime";
import { requireVerified } from "./accounts";
// Exact approved scope; new routes and methods remain verification-gated by default.
export function permittedWorkspaceRoute(path: string, method: string) {
  return (
    (method === "GET" && path === "/api/state") ||
    (method === "PUT" && path === "/api/profile") ||
    (method === "POST" && path === "/api/professors") ||
    (method === "PUT" && /^\/api\/professors\/[^/]+$/.test(path)) ||
    (method === "POST" &&
      /^\/api\/professors\/[^/]+\/(archive|restore|delete|verify)$/.test(
        path,
      )) ||
    (method === "POST" && path === "/api/documents") ||
    (method === "GET" && /^\/api\/documents\/[^/]+$/.test(path)) ||
    (method === "POST" && /^\/api\/documents\/[^/]+\/delete$/.test(path))
  );
}
export async function workspaceAccess(req: Request, env: Env, user: string) {
  const account = await env.DB.prepare(
    "SELECT email_verified_at,legacy_access FROM users WHERE id=?",
  )
    .bind(user)
    .first<any>();
  if (!account) throw new HttpError(401, "Unauthorized");
  if (account.email_verified_at || account.legacy_access) return false;
  if (!permittedWorkspaceRoute(new URL(req.url).pathname, req.method))
    await requireVerified(env, user);
  if (req.method !== "GET") {
    const period = new Date().toISOString().slice(0, 13);
    await consume(env, "limited-workspace:user:" + user, 60, 1, period);
    await consume(
      env,
      "limited-workspace:ip:" +
        (await hash(req.headers.get("CF-Connecting-IP") || "local")),
      120,
      1,
      period,
    );
    await consume(env, "limited-workspace:global", 1000, 1, period);
  }
  return true;
}
export async function limitedWorkspaceState(env: Env, user: string) {
  const [profile, professors, documents, account] = await Promise.all([
    env.DB.prepare("SELECT * FROM profiles WHERE user_id=?").bind(user).first(),
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
      "SELECT email,first_name,last_name,display_name,email_verified_at,legacy_access FROM users WHERE id=?",
    )
      .bind(user)
      .first(),
  ]);
  // Do not expose connection details, mailbox history, approval snapshots or live controls.
  return Response.json({
    profile,
    professors: professors.results,
    documents: documents.results,
    account,
    capabilities: {
      workspace_limited: true,
      gmail: false,
      outlook: false,
      live_email: false,
      mock_delivery: false,
      live_owner: false,
      production_outreach: false,
      test_recipients: [],
      activation: {
        delivered: false,
        reply_detected: false,
        can_activate: false,
      },
      ai: "mock",
    },
    messages: [],
    connections: [],
    audit: [],
    notifications: [],
    automation: [],
    transports: [],
    mailbox_checks: [],
    delivery_attempts: [],
    authorizations: [],
    campaigns: [],
    followup_approvals: [],
    ai_usage: { requests: 0, tokens: 0 },
  });
}
