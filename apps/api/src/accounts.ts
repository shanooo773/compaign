import { turnstileConfigured, verifyTurnstile } from "./turnstile";
import {
  mailReady,
  sendAccountLink,
  sendPasswordChanged,
} from "./account-mail";
export { mailReady, sendAccountLink } from "./account-mail";
import { revokeMailboxTokens, oauthAvailable } from "./oauth";
import { z } from "zod";
import { type Env, HttpError, hash, random, consume } from "./runtime";
import { passwordHash, validPassword, equalHash } from "./passwords";
import { documentStore } from "./storage";
const mail = z
  .string()
  .email()
  .max(254)
  .transform((v) => v.toLowerCase());
const generic =
  "If the account is eligible, a message has been requested. Check your inbox and spam folder.";
const ok = () => Response.json({ ok: true, message: generic });
const clear = (req: Request) =>
  `session=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0${new URL(req.url).protocol === "https:" ? "; Secure" : ""}`;
async function limits(req: Request, env: Env, action: string, address: string) {
  const period = new Date().toISOString().slice(0, 13);
  await consume(env, `account:${action}:global`, 100, 1, period);
  await consume(
    env,
    `account:${action}:ip:${await hash(req.headers.get("CF-Connecting-IP") || "local")}`,
    15,
    1,
    period,
  );
  await consume(
    env,
    `account:${action}:address:${await hash(address)}`,
    3,
    1,
    period,
  );
}
export async function accountPublic(
  req: Request,
  env: Env,
): Promise<Response | null> {
  const path = new URL(req.url).pathname;
  if (path === "/api/auth/config" && req.method === "GET")
    return Response.json({
      turnstile_site_key: turnstileConfigured(env)
        ? env.TURNSTILE_SITE_KEY
        : null,
      turnstile_required: env.TURNSTILE_ENABLED === "true",
    });
  if (
    ![
      "/api/auth/signup",
      "/api/auth/login",
      "/api/auth/forgot-password",
      "/api/auth/reset-password",
      "/api/auth/verify-email",
    ].includes(path)
  )
    return null;
  if (req.method !== "POST") throw new HttpError(405, "Method not allowed");
  const data = await req.json();
  if (path.endsWith("signup")) {
    const input = z
      .object({
        email: mail,
        password: z.string().max(128),
        confirm_password: z.string(),
        first_name: z.string().trim().min(1).max(80),
        last_name: z.string().trim().min(1).max(80),
        display_name: z.string().trim().max(160).optional(),
        accept_terms: z.literal(true),
      })
      .parse(data);
    if (input.password !== input.confirm_password)
      throw new HttpError(400, "Passwords do not match.");
    validPassword(input.password, input.email);
    await consume(env, "signup:global", 50);
    await consume(
      env,
      "signup:" + (await hash(req.headers.get("CF-Connecting-IP") || "local")),
      10,
    );
    await verifyTurnstile(
      req,
      env,
      z.object({ turnstile_token: z.string().max(2048).optional() }).parse(data)
        .turnstile_token,
    );
    const digest = await passwordHash(input.password),
      user = await env.DB.prepare("SELECT id,email FROM users WHERE email=?")
        .bind(input.email)
        .first<any>();
    if (!user) {
      const id = crypto.randomUUID(),
        name = input.display_name || `${input.first_name} ${input.last_name}`;
      await env.DB.batch([
        env.DB.prepare(
          "INSERT OR IGNORE INTO users(id,email,password,first_name,last_name,display_name,legacy_access,terms_accepted_at) VALUES(?,?,?,?,?,?,0,?)",
        ).bind(
          id,
          input.email,
          digest,
          input.first_name,
          input.last_name,
          name,
          Date.now(),
        ),
        env.DB.prepare(
          "INSERT OR IGNORE INTO profiles(user_id,name) SELECT id,? FROM users WHERE id=?",
        ).bind(name, id),
      ]);
      const created = await env.DB.prepare(
        "SELECT id,email FROM users WHERE id=?",
      )
        .bind(id)
        .first<{ id: string; email: string }>();
      if (created) await sendAccountLink(env, created, "verify");
    }
    return Response.json({
      ok: true,
      message:
        "Account request complete. Sign in with your password, then choose Verify with Google & Connect Gmail using your matching Google email. Your account remains unverified until ownership is confirmed.",
    });
  }
  if (path.endsWith("login")) {
    const input = z
      .object({ email: mail, password: z.string().min(1).max(128) })
      .parse(data);
    const key = await hash(
        (req.headers.get("CF-Connecting-IP") || "local") + ":" + input.email,
      ),
      now = Date.now();
    await env.DB.prepare(
      "INSERT INTO login_attempts(key,count,reset_at) VALUES(?,1,?) ON CONFLICT(key) DO UPDATE SET count=CASE WHEN reset_at<? THEN 1 ELSE count+1 END,reset_at=CASE WHEN reset_at<? THEN excluded.reset_at ELSE reset_at END",
    )
      .bind(key, now + 900000, now, now)
      .run();
    const count = await env.DB.prepare(
      "SELECT count FROM login_attempts WHERE key=?",
    )
      .bind(key)
      .first<any>();
    if (count.count > 15)
      throw new HttpError(
        429,
        "Too many attempts. Try again in 15 minutes.",
        900,
      );
    const user = await env.DB.prepare(
      "SELECT id,password FROM users WHERE email=?",
    )
      .bind(input.email)
      .first<any>();
    const computed = await passwordHash(
      input.password,
      user?.password.split(":")[0] || "missing-account-timing-salt",
    );
    if (!user || !equalHash(computed, user.password))
      throw new HttpError(401, "Invalid email or password");
    const token = random();
    await env.DB.prepare(
      "INSERT INTO sessions(token,user_id,expires_at) VALUES(?,?,?)",
    )
      .bind(await hash(token), user.id, now + 604800000)
      .run();
    return Response.json(
      { ok: true },
      {
        headers: {
          "Set-Cookie": `session=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=604800${new URL(req.url).protocol === "https:" ? "; Secure" : ""}`,
        },
      },
    );
  }
  if (path.endsWith("forgot-password")) {
    const input = z.object({ email: mail }).parse(data);
    await limits(req, env, "reset", input.email);
    const user = await env.DB.prepare(
      "SELECT id,email FROM users WHERE email=?",
    )
      .bind(input.email)
      .first<{ id: string; email: string }>();
    if (user) await sendAccountLink(env, user, "reset");
    if (!mailReady(env))
      return Response.json({
        ok: true,
        message:
          "Email recovery is unavailable. Sign in with a registered passkey or recover with a saved recovery code.",
      });
    return ok();
  }
  const input = z
    .object({
      token: z.string().min(40).max(128),
      password: z.string().max(128).optional(),
      confirm_password: z.string().optional(),
    })
    .parse(data);
  const purpose = path.endsWith("verify-email") ? "verify" : "reset";
  await consume(
    env,
    "account:redeem:ip:" +
      (await hash(req.headers.get("CF-Connecting-IP") || "local")),
    30,
    1,
    new Date().toISOString().slice(0, 13),
  );
  let password = "";
  if (purpose === "reset") {
    if (!input.password || input.password !== input.confirm_password)
      throw new HttpError(400, "Passwords do not match.");
    validPassword(input.password);
    password = await passwordHash(input.password);
  }
  const digest = await hash(input.token),
    now = Date.now();
  const lookup =
    "SELECT user_id FROM account_tokens WHERE token_hash=? AND purpose=? AND expires_at>?";
  // All effects and token consumption share one D1 transaction. A failure leaves
  // the link usable; concurrent redemption cannot apply the operation twice.
  const statements =
    purpose === "verify"
      ? [
          env.DB.prepare(
            `UPDATE users SET email_verified_at=COALESCE(email_verified_at,?) WHERE id=(${lookup})`,
          ).bind(now, digest, purpose, now),
        ]
      : [
          env.DB.prepare(
            `UPDATE users SET password=? WHERE id=(${lookup})`,
          ).bind(password, digest, purpose, now),
          env.DB.prepare(`DELETE FROM sessions WHERE user_id=(${lookup})`).bind(
            digest,
            purpose,
            now,
          ),
          env.DB.prepare(
            `DELETE FROM oauth_states WHERE user_id=(${lookup})`,
          ).bind(digest, purpose, now),
        ];
  const recipient =
    purpose === "reset"
      ? await env.DB.prepare(`SELECT id,email FROM users WHERE id=(${lookup})`)
          .bind(digest, purpose, now)
          .first<any>()
      : null;
  statements.push(
    env.DB.prepare(
      `DELETE FROM account_tokens WHERE user_id=(${lookup})${purpose === "verify" ? " AND purpose='verify'" : ""}`,
    ).bind(digest, purpose, now),
  );
  const applied = await env.DB.batch(statements);
  if (!applied[0].meta.changes)
    throw new HttpError(
      400,
      "This link is invalid, expired, or already used. Request a new link.",
    );
  if (recipient) await sendPasswordChanged(env, recipient);
  return Response.json(
    { ok: true },
    { headers: purpose === "reset" ? { "Set-Cookie": clear(req) } : {} },
  );
}
export async function accountPrivate(
  req: Request,
  env: Env,
  user: string,
): Promise<Response | null> {
  const path = new URL(req.url).pathname,
    method = req.method;
  if (path === "/api/auth/me" && method === "GET") {
    const account = await env.DB.prepare(
      "SELECT email,first_name,last_name,display_name,email_verified_at,legacy_access FROM users WHERE id=?",
    )
      .bind(user)
      .first();
    return Response.json({
      account,
      mail_delivery_ready: mailReady(env),
      google_activation_ready: oauthAvailable(env, "gmail"),
    });
  }
  if (path === "/api/auth/resend-verification" && method === "POST") {
    const row = await env.DB.prepare(
      "SELECT id,email,email_verified_at FROM users WHERE id=?",
    )
      .bind(user)
      .first<any>();
    await limits(req, env, "verify", row.email);
    if (!mailReady(env))
      return Response.json({
        ok: false,
        available: false,
        message:
          "Verification email delivery is currently unavailable. Your private workspace remains accessible; sensitive mailbox actions require verified ownership.",
      });
    if (!row.email_verified_at) await sendAccountLink(env, row, "verify");
    return ok();
  }
  if (path === "/api/account/profile" && method === "PUT") {
    const input = z
      .object({
        first_name: z.string().trim().min(1).max(80),
        last_name: z.string().trim().min(1).max(80),
        display_name: z.string().trim().min(1).max(160),
      })
      .parse(await req.json());
    await env.DB.batch([
      env.DB.prepare(
        "UPDATE users SET first_name=?,last_name=?,display_name=? WHERE id=?",
      ).bind(input.first_name, input.last_name, input.display_name, user),
      env.DB.prepare("UPDATE profiles SET name=? WHERE user_id=?").bind(
        input.display_name,
        user,
      ),
    ]);
    return Response.json({ ok: true });
  }
  if (path === "/api/auth/logout-all" && method === "POST") {
    await env.DB.batch([
      env.DB.prepare("DELETE FROM sessions WHERE user_id=?").bind(user),
      env.DB.prepare("DELETE FROM oauth_states WHERE user_id=?").bind(user),
    ]);
    return Response.json(
      { ok: true },
      { headers: { "Set-Cookie": clear(req) } },
    );
  }
  if (
    (path === "/api/auth/change-password" || path === "/api/account/delete") &&
    method === "POST"
  ) {
    await consume(
      env,
      "account:reauth:" + user,
      10,
      1,
      new Date().toISOString().slice(0, 13),
    );
    const input = z
      .object({
        current_password: z.string().max(128),
        password: z.string().max(128).optional(),
        confirm_password: z.string().optional(),
        confirmation: z.string().optional(),
      })
      .parse(await req.json());
    const row = await env.DB.prepare("SELECT password FROM users WHERE id=?")
      .bind(user)
      .first<any>();
    if (
      !row ||
      !equalHash(
        await passwordHash(input.current_password, row.password.split(":")[0]),
        row.password,
      )
    )
      throw new HttpError(401, "Reauthentication failed.");
    if (path.endsWith("change-password")) {
      if (!input.password || input.password !== input.confirm_password)
        throw new HttpError(400, "Passwords do not match.");
      validPassword(input.password);
      await env.DB.batch([
        env.DB.prepare(
          "UPDATE users SET password=? WHERE id=? AND password=?",
        ).bind(await passwordHash(input.password), user, row.password),
        env.DB.prepare("DELETE FROM sessions WHERE user_id=?").bind(user),
        env.DB.prepare("DELETE FROM oauth_states WHERE user_id=?").bind(user),
        env.DB.prepare("DELETE FROM account_tokens WHERE user_id=?").bind(user),
        env.DB.prepare("DELETE FROM auth_challenges WHERE user_id=?").bind(
          user,
        ),
      ]);
    } else {
      if (input.confirmation !== "DELETE MY ACCOUNT")
        throw new HttpError(
          400,
          "Type DELETE MY ACCOUNT to confirm permanent deletion.",
        );
      const mailboxes = await env.DB.prepare(
        "SELECT provider,tokens FROM connections WHERE user_id=?",
      )
        .bind(user)
        .all<{ provider: string; tokens: string | null }>();
      // One atomic transaction removes all private data and enqueues opaque storage cleanup.
      await env.DB.batch([
        env.DB.prepare(
          "INSERT OR IGNORE INTO account_deletion_objects(object_key,backend,size,expires_at,next_at) SELECT object_key,storage_backend,size,MAX(COALESCE(expires_at,?),COALESCE(retained_until,0),COALESCE(object_expires_at,0)),? FROM documents WHERE user_id=?",
        ).bind(Date.now() + 30 * 86400000, Date.now() + 120000, user),
        env.DB.prepare("UPDATE profiles SET stopped=1 WHERE user_id=?").bind(
          user,
        ),
        ...[
          "recovery_codes",
          "passkeys",
          "auth_challenges",
          "sessions",
          "oauth_states",
          "account_tokens",
          "mailbox_events",
          "followup_steps",
          "campaign_deletion_documents",
          "message_attachments",
          "transports",
          "automation",
          "deliveries",
          "messages",
          "connections",
          "professors",
          "documents",
          "notifications",
          "suppressions",
          "ai_usage",
          "audit",
          "profiles",
        ].map((table) => {
          const sql =
            table === "followup_steps"
              ? `DELETE FROM followup_steps WHERE root_id IN (SELECT id FROM messages WHERE user_id=?)`
              : table === "mailbox_events"
              ? `DELETE FROM mailbox_events WHERE connection_id IN (SELECT id FROM connections WHERE user_id=?)`
              : ["automation", "deliveries"].includes(table)
                ? `DELETE FROM ${table} WHERE message_id IN (SELECT id FROM messages WHERE user_id=?)`
                : `DELETE FROM ${table} WHERE user_id=?`;
          return env.DB.prepare(sql).bind(user);
        }),
        env.DB.prepare("DELETE FROM users WHERE id=?").bind(user),
      ]);
      // Local access is already revoked; provider consent removal is best effort, never a send.
      for (const mailbox of mailboxes.results)
        await revokeMailboxTokens(env, user, mailbox);
    }
    return Response.json(
      { ok: true, cleanup_pending: path.endsWith("/delete") },
      { headers: { "Set-Cookie": clear(req) } },
    );
  }
  return null;
}
export async function requireVerified(env: Env, user: string) {
  const account = await env.DB.prepare(
    "SELECT email_verified_at,legacy_access FROM users WHERE id=?",
  )
    .bind(user)
    .first<any>();
  if (!account) throw new HttpError(401, "Unauthorized");
  if (!account.email_verified_at && !account.legacy_access)
    throw new HttpError(
      403,
      "Verify your email before using mailbox, outreach or other restricted features.",
    );
}
export async function cleanDeletedAccounts(env: Env) {
  const now = Date.now();
  const rows = await env.DB.prepare(
    "SELECT object_key,backend,expires_at,purged FROM account_deletion_objects WHERE next_at<=? LIMIT 2",
  )
    .bind(now)
    .all<any>();
  for (const row of rows.results) {
    try {
      if (!row.purged) {
        await consume(env, "kv-delete:global", 100);
        await documentStore(env, row.backend).delete(row.object_key);
      }
      if (row.expires_at <= now)
        await env.DB.prepare(
          "DELETE FROM account_deletion_objects WHERE object_key=?",
        )
          .bind(row.object_key)
          .run();
      else
        await env.DB.prepare(
          "UPDATE account_deletion_objects SET purged=1,next_at=? WHERE object_key=?",
        )
          .bind(row.expires_at, row.object_key)
          .run();
    } catch {
      await env.DB.prepare(
        "UPDATE account_deletion_objects SET attempts=attempts+1,next_at=? WHERE object_key=?",
      )
        .bind(now + 3600000, row.object_key)
        .run();
    }
  }
  await env.DB.prepare(
    "DELETE FROM account_tokens WHERE token_hash IN (SELECT token_hash FROM account_tokens WHERE expires_at<=? LIMIT 20)",
  )
    .bind(now)
    .run();
}
