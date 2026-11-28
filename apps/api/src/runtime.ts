export interface Env {
  DB: D1Database;
  TURNSTILE_ENABLED?: string;
  TURNSTILE_SITE_KEY?: string;
  TURNSTILE_SECRET_KEY?: string;
  MAIL_PROVIDER?: string;
  MAIL_DELIVERY_ENABLED?: string;
  MAIL_FREE_PLAN_CONFIRMED?: string;
  MAIL_FROM?: string;
  MAIL_SENDER_VERIFIED?: string;
  BREVO_API_KEY?: string;
  DOCUMENTS_KV?: KVNamespace;
  DOCUMENTS?: R2Bucket; // Optional legacy adapter, not a production dependency.
  APP_ORIGIN: string;
  OAUTH_ENABLED?: string;
  OAUTH_ADMIN_TEST_USER_IDS?: string; // Server-only account IDs; OAuth start budget only.
  LIVE_EMAIL_ENABLED?: string;
  LIVE_OWNER_USER_IDS?: string;
  MOCK_DELIVERY_ENABLED?: string;
  LIVE_TEST_RECIPIENTS?: string;
  TOKEN_ENCRYPTION_KEY?: string;
  GMAIL_CLIENT_ID?: string;
  GMAIL_CLIENT_SECRET?: string;
  OUTLOOK_CLIENT_ID?: string;
  OUTLOOK_CLIENT_SECRET?: string;
  AI_PROVIDER?: string;
  GROQ_API_KEY?: string;
  GROQ_MODEL?: string;
  GROQ_FREE_PLAN_CONFIRMED?: string;
}
export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
    public retryAfter?: number,
  ) {
    super(message);
  }
}
export async function hash(value: string | ArrayBuffer): Promise<string> {
  const bytes =
    typeof value === "string" ? new TextEncoder().encode(value) : value;
  return [...new Uint8Array(await crypto.subtle.digest("SHA-256", bytes))]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}
export function base64(bytes: Uint8Array): string {
  let text = "";
  for (let i = 0; i < bytes.length; i += 8192)
    text += String.fromCharCode(...bytes.subarray(i, i + 8192));
  return btoa(text);
}
export const unbase64 = (value: string) =>
  Uint8Array.from(atob(value), (c) => c.charCodeAt(0));
export const base64url = (bytes: Uint8Array) =>
  base64(bytes).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
export const random = () =>
  base64url(crypto.getRandomValues(new Uint8Array(32)));
export async function notify(
  env: Env,
  user: string,
  kind: string,
  message: string,
  entity = "",
) {
  const id = crypto.randomUUID();
  await env.DB.batch([
    env.DB.prepare(
      "INSERT OR IGNORE INTO notifications(id,user_id,kind,message,entity_id) VALUES(?,?,?,?,?)",
    ).bind(id, user, kind, message, entity),
    env.DB.prepare(
      "INSERT INTO audit(id,user_id,action,entity_id) VALUES(?,?,?,?)",
    ).bind(crypto.randomUUID(), user, "notification." + kind, entity),
  ]);
}
// A single conditional UPSERT is serialized by D1; KV is never used for quotas.
export async function consume(
  env: Env,
  scope: string,
  limit: number,
  amount = 1,
  period = new Date().toISOString().slice(0, 10),
) {
  const row = await env.DB.prepare(
    `INSERT INTO usage_counters(scope,period,amount) SELECT ?,?,? WHERE ?<=? ON CONFLICT(scope,period) DO UPDATE SET amount=amount+excluded.amount WHERE amount+excluded.amount<=? RETURNING amount`,
  )
    .bind(scope, period, amount, amount, limit, limit)
    .first();
  if (!row) {
    // Callers use UTC calendar-day or calendar-minute windows; never promise a
    // one-minute retry for a quota that only changes at the next UTC day.
    const end = /^\d{4}-\d{2}-\d{2}$/.test(period)
      ? Date.parse(period + "T00:00:00.000Z") + 86400000
      : /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(period)
        ? Date.parse(period + ":00.000Z") + 60000
        : /^\d{4}-\d{2}-\d{2}T\d{2}$/.test(period)
          ? Date.parse(period + ":00:00.000Z") + 3600000
          : NaN;
    const retry = Number.isFinite(end)
      ? Math.max(1, Math.ceil((end - Date.now()) / 1000))
      : 60;
    throw new HttpError(
      429,
      "Daily or interval quota reached. Try later.",
      retry,
    );
  }
}
