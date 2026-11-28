import {
  isActivationProof,
  verifiedGoogleIdentity,
  commitGoogleActivation,
  type GoogleActivationProof,
} from "./google-activation";
import {
  type Env,
  HttpError,
  base64,
  unbase64,
  base64url,
  hash,
  random,
  consume,
  notify,
} from "./runtime";
import {
  oauthConfig,
  scopes,
  type ProviderName,
  type TokenSet,
  providerRequest,
  oauthTokenRequest,
  ProviderError,
  type Fetcher,
} from "./providers";
export function cookie(req: Request, name: string) {
  return (
    req.headers
      .get("Cookie")
      ?.split(";")
      .map((v) => v.trim())
      .find((v) => v.startsWith(name + "="))
      ?.slice(name.length + 1) || ""
  );
}
function keyConfig(env: Env) {
  if (!env.TOKEN_ENCRYPTION_KEY)
    throw new HttpError(503, "OAuth encryption is not configured.");
  let bytes: Uint8Array;
  try {
    bytes = unbase64(env.TOKEN_ENCRYPTION_KEY);
  } catch {
    throw new HttpError(503, "OAuth encryption is not configured.");
  }
  if (bytes.byteLength !== 32)
    throw new HttpError(503, "OAuth encryption is not configured.");
  return bytes;
}
export async function encrypt(env: Env, context: string, value: unknown) {
  const key = await crypto.subtle.importKey(
    "raw",
    keyConfig(env),
    "AES-GCM",
    false,
    ["encrypt"],
  );
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const bytes = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv, additionalData: new TextEncoder().encode(context) },
    key,
    new TextEncoder().encode(JSON.stringify(value)),
  );
  return JSON.stringify({
    v: 1,
    iv: base64(iv),
    data: base64(new Uint8Array(bytes)),
  });
}
export async function decrypt<T>(
  env: Env,
  context: string,
  ciphertext: string,
): Promise<T> {
  try {
    const data = JSON.parse(ciphertext);
    if (data.v !== 1) throw new Error();
    const key = await crypto.subtle.importKey(
      "raw",
      keyConfig(env),
      "AES-GCM",
      false,
      ["decrypt"],
    );
    const bytes = await crypto.subtle.decrypt(
      {
        name: "AES-GCM",
        iv: unbase64(data.iv),
        additionalData: new TextEncoder().encode(context),
      },
      key,
      unbase64(data.data),
    );
    return JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    throw new HttpError(
      503,
      "Stored credentials could not be decrypted; administrator action required.",
    );
  }
}
function credentials(env: Env, provider: ProviderName) {
  const client =
      provider === "gmail" ? env.GMAIL_CLIENT_ID : env.OUTLOOK_CLIENT_ID,
    secret =
      provider === "gmail"
        ? env.GMAIL_CLIENT_SECRET
        : env.OUTLOOK_CLIENT_SECRET;
  if (
    env.OAUTH_ENABLED !== "true" ||
    !client ||
    !secret ||
    !env.APP_ORIGIN.startsWith("https://")
  )
    throw new HttpError(503, "This OAuth provider is not configured.");
  keyConfig(env);
  return {
    client,
    secret,
    redirect: env.APP_ORIGIN + `/api/oauth/${provider}/callback`,
  };
}
export function oauthAvailable(env: Env, provider: ProviderName) {
  try {
    credentials(env, provider);
    return true;
  } catch {
    return false;
  }
}
const context = (user: string, provider: string) =>
  `${user}:${provider}:tokens:v1`;
export async function startOAuth(
  env: Env,
  user: string,
  req: Request,
  provider: ProviderName,
  readReplies: boolean,
  activation = false,
) {
  const config = credentials(env, provider),
    state = random(),
    verifier = random(),
    binding = random();
  let activationProof: GoogleActivationProof | null = null;
  if (activation) {
    if (provider !== "gmail" || !readReplies)
      throw new HttpError(
        400,
        "Google activation requires Gmail sending and reply permissions.",
      );
    const account = await env.DB.prepare(
      "SELECT email,email_verified_at,legacy_access FROM users WHERE id=?",
    )
      .bind(user)
      .first<{
        email: string;
        email_verified_at: number | null;
        legacy_access: number;
      }>();
    if (!account || account.email_verified_at || account.legacy_access)
      throw new HttpError(
        409,
        "This activation action is for new unverified accounts. Existing accounts should use their normal Gmail connection controls.",
      );
    activationProof = {
      purpose: "google_activation",
      verifier,
      nonce: random(),
      email: account.email.toLowerCase(),
    };
  }
  // Identity comes from the authenticated session, never request/profile fields.
  // Removing an ID restores the normal limit without deleting its usage row.
  const accountLimit = (env.OAUTH_ADMIN_TEST_USER_IDS || "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean)
    .includes(user)
    ? 15
    : 5;
  const period = new Date().toISOString().slice(0, 10);
  const reset = new Date(
    Date.parse(period + "T00:00:00.000Z") + 86400000,
  ).toISOString();
  for (const [scope, limit, category, label] of [
    [
      `oauth:${user}`,
      accountLimit,
      "account_quota",
      "per account (shared by Gmail and Outlook)",
    ],
    ["oauth:global", 50, "global_quota", "application-wide"],
  ] as const) {
    try {
      await consume(env, scope, limit, 1, period);
    } catch (error) {
      if (error instanceof HttpError && error.status === 429) {
        console.warn("oauth_start_failure", category);
        throw new HttpError(
          429,
          `OAuth connection attempt limit reached: ${limit} starts ${label} per UTC day. Resets at ${reset}. Failed or cancelled attempts count.`,
          error.retryAfter,
        );
      }
      throw error;
    }
  }
  const challenge = base64url(
    new Uint8Array(
      await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier)),
    ),
  );
  // A provider-wide cookie is overwritten by a second tab/Connect attempt.
  const stateHash = await hash(state);
  await env.DB.prepare(
    "INSERT INTO oauth_states(state_hash,user_id,provider,session_hash,binding_hash,verifier,read_replies,expires_at) VALUES(?,?,?,?,?,?,?,?)",
  )
    .bind(
      stateHash,
      user,
      provider,
      await hash(cookie(req, "session")),
      await hash(binding),
      await encrypt(
        env,
        `${user}:${provider}:pkce`,
        activationProof || verifier,
      ),
      +readReplies,
      Date.now() + 600000,
    )
    .run();
  const url = new URL(oauthConfig(provider).authorization);
  url.search = new URLSearchParams({
    client_id: config.client,
    response_type: "code",
    redirect_uri: config.redirect,
    scope: scopes(provider, readReplies).join(" "),
    state,
    ...(activationProof
      ? { nonce: activationProof.nonce, login_hint: activationProof.email }
      : {}),
    code_challenge: challenge,
    code_challenge_method: "S256",
    ...(provider === "gmail"
      ? {
          access_type: "offline",
          prompt: activation ? "consent select_account" : "consent",
        }
      : { response_mode: "query" }),
  }).toString();
  return Response.json(
    { url: url.href },
    {
      headers: {
        "Set-Cookie": `oauth_${provider}_${stateHash}=${binding}; HttpOnly; Secure; SameSite=Lax; Path=/api/oauth/${provider}/callback; Max-Age=600`,
      },
    },
  );
}
export async function finishOAuth(
  env: Env,
  req: Request,
  provider: ProviderName,
  network: Fetcher = fetch,
) {
  let category = "configuration";
  let activationCallback = false;
  try {
    const config = credentials(env, provider),
      url = new URL(req.url),
      state = url.searchParams.get("state") || "";
    category = "state_missing";
    if (!state) throw new HttpError(400, "Invalid or expired OAuth state.");
    const stateHash = await hash(state);
    category = "state_lookup";
    const row = await env.DB.prepare(
      "SELECT * FROM oauth_states WHERE state_hash=? AND provider=?",
    )
      .bind(stateHash, provider)
      .first<any>();
    category = "state_not_found";
    if (!row) throw new HttpError(400, "Invalid or expired OAuth state.");
    category = "state_expired";
    if (row.expires_at <= Date.now())
      throw new HttpError(400, "Invalid or expired OAuth state.");
    const binding = cookie(req, `oauth_${provider}_${stateHash}`);
    category = "binding_cookie_missing";
    if (!binding) throw new HttpError(400, "Invalid or expired OAuth state.");
    category = "binding_cookie_mismatch";
    if (row.binding_hash !== (await hash(binding)))
      throw new HttpError(400, "Invalid or expired OAuth state.");
    category = "session_validation";
    const active = await env.DB.prepare(
      "SELECT user_id FROM sessions WHERE token=? AND user_id=? AND expires_at>?",
    )
      .bind(row.session_hash, row.user_id, Date.now())
      .first();
    if (!active)
      throw new HttpError(401, "Session expired; sign in and reconnect.");
    category = "pkce_decryption";
    const earlyProof = await decrypt<string | GoogleActivationProof>(
      env,
      `${row.user_id}:${provider}:pkce`,
      row.verifier,
    );
    activationCallback = isActivationProof(earlyProof);
    category = "state_consumption";
    const consumed = await env.DB.prepare(
      "DELETE FROM oauth_states WHERE state_hash=? RETURNING state_hash",
    )
      .bind(stateHash)
      .first();
    if (!consumed) throw new HttpError(400, "OAuth state already used.");
    category = "authorization_incomplete";
    if (url.searchParams.has("error") || !url.searchParams.get("code"))
      throw new HttpError(400, "Account authorization was not completed.");
    category = "pkce_decryption";
    const storedProof = await decrypt<string | GoogleActivationProof>(
      env,
      `${row.user_id}:${provider}:pkce`,
      row.verifier,
    );
    const activationProof = isActivationProof(storedProof) ? storedProof : null;
    if (typeof storedProof !== "string" && !activationProof)
      throw new HttpError(400, "Invalid OAuth proof.");
    const verifier = activationProof
      ? activationProof.verifier
      : (storedProof as string);
    category = "token_exchange";
    const tokens = (await oauthTokenRequest(
      oauthConfig(provider).token,
      {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          client_id: config.client,
          client_secret: config.secret,
          redirect_uri: config.redirect,
          grant_type: "authorization_code",
          code: url.searchParams.get("code")!,
          code_verifier: verifier,
        }),
      },
      network,
    )) as TokenSet;
    category = "offline_access_missing";
    if (
      !tokens.access_token ||
      !tokens.refresh_token ||
      !Number.isFinite(tokens.expires_in)
    )
      throw new HttpError(
        400,
        "Offline access was not granted; reconnect with consent.",
      );
    category = "mailbox_scopes_missing";
    const granted = (tokens.scope || "").split(" ");
    const required = scopes(provider, !!row.read_replies).filter(
      (s) => !["openid", "email", "offline_access"].includes(s),
    );
    if (
      required.some(
        (s) =>
          !granted.includes(s) &&
          !granted.includes("https://graph.microsoft.com/" + s),
      )
    )
      throw new HttpError(400, "Required mailbox scopes were not granted.");
    if (activationProof) {
      category = "google_activation_identity";
      if (provider !== "gmail")
        throw new HttpError(400, "Invalid Google activation provider.");
      const requiredIdentity = [
        "openid",
        "https://www.googleapis.com/auth/userinfo.email",
      ];
      if (
        !granted.includes("openid") ||
        !(granted.includes("email") || granted.includes(requiredIdentity[1]))
      )
        throw new HttpError(400, "Google identity scopes were not granted.");
      const identity = await verifiedGoogleIdentity(
        env,
        tokens,
        activationProof,
        network,
      );
      // ID tokens are short-lived identity evidence, not stored mailbox credentials.
      const mailboxTokens = {
        access_token: tokens.access_token,
        refresh_token: tokens.refresh_token,
        expires_in: tokens.expires_in,
        scope: tokens.scope,
      };
      const encrypted = await encrypt(
        env,
        context(row.user_id, provider),
        mailboxTokens,
      );
      category = "google_activation_commit";
      const response = await commitGoogleActivation(
        env,
        row,
        identity,
        granted.join(" "),
        encrypted,
        tokens.expires_in,
      );
      response.headers.append(
        "Set-Cookie",
        `oauth_${provider}_${stateHash}=; HttpOnly; Secure; SameSite=Lax; Path=/api/oauth/${provider}/callback; Max-Age=0`,
      );
      return response;
    }
    category = "identity_request";
    const identity = await providerRequest(
      provider === "gmail"
        ? "https://openidconnect.googleapis.com/v1/userinfo"
        : "https://graph.microsoft.com/v1.0/me?$select=id,mail,userPrincipalName",
      { headers: { Authorization: `Bearer ${tokens.access_token}` } },
      network,
    );
    category = "identity_unverified";
    const address = String(
        provider === "gmail"
          ? identity.email
          : identity.mail || identity.userPrincipalName,
      ).toLowerCase(),
      subject = String(provider === "gmail" ? identity.sub : identity.id);
    if (
      !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(address) ||
      !subject ||
      (provider === "gmail" && !identity.email_verified)
    )
      throw new HttpError(400, "Mailbox identity could not be verified.");
    category = "token_encryption";
    const encrypted = await encrypt(
      env,
      context(row.user_id, provider),
      tokens,
    );
    category = "connection_save";
    const saved = await env.DB.prepare(
      `INSERT INTO connections(id,user_id,provider,address,subject,status,scopes,tokens,expires_at) SELECT ?,?,?,?,?,'connected',?,?,? WHERE EXISTS(SELECT 1 FROM sessions WHERE token=? AND user_id=? AND expires_at>?) ON CONFLICT(user_id,provider,subject) DO UPDATE SET address=excluded.address,status='connected',scopes=excluded.scopes,tokens=excluded.tokens,expires_at=excluded.expires_at,refresh_lease=NULL,refresh_until=0 RETURNING id`,
    )
      .bind(
        crypto.randomUUID(),
        row.user_id,
        provider,
        address,
        subject,
        granted.join(" "),
        encrypted,
        Date.now() + tokens.expires_in * 1000,
        row.session_hash,
        row.user_id,
        Date.now(),
      )
      .first();
    if (!saved) {
      category = "session_revoked_before_save";
      throw new HttpError(401, "Session expired; sign in and reconnect.");
    }
    await notify(
      env,
      row.user_id,
      "connection",
      "Mailbox connected; live sending remains controlled by server configuration.",
    );
    return new Response(null, {
      status: 303,
      headers: {
        Location: env.APP_ORIGIN + "/?connection=connected",
        "Set-Cookie": `oauth_${provider}_${stateHash}=; HttpOnly; Secure; SameSite=Lax; Path=/api/oauth/${provider}/callback; Max-Age=0`,
      },
    });
  } catch (error) {
    // Fixed categories only: never serialize errors, requests, headers or provider payloads.
    console.warn("oauth_callback_failure", category);
    if (activationCallback) {
      const message =
        error instanceof HttpError
          ? error.message
          : "Google verification could not be completed. Your account remains restricted. Return to the dashboard and retry. Google may require OAuth test-user access or application verification.";
      return new Response(null, {
        status: 303,
        headers: {
          Location:
            env.APP_ORIGIN +
            "/?activation_error=" +
            encodeURIComponent(message),
        },
      });
    }
    throw error;
  }
}
export async function accessToken(
  env: Env,
  connection: any,
  network: Fetcher = fetch,
): Promise<string> {
  if (connection.status !== "connected" || !connection.tokens)
    throw new ProviderError("reconnect");
  const tokens = await decrypt<TokenSet>(
    env,
    context(connection.user_id, connection.provider),
    connection.tokens,
  );
  if (connection.expires_at > Date.now() + 60000) return tokens.access_token;
  const lease = random(),
    config = credentials(env, connection.provider);
  const claimed = await env.DB.prepare(
    "UPDATE connections SET refresh_lease=?,refresh_until=? WHERE id=? AND status='connected' AND refresh_until<? RETURNING id",
  )
    .bind(lease, Date.now() + 30000, connection.id, Date.now())
    .first();
  if (!claimed) throw new ProviderError("retry");
  try {
    const refreshed = await oauthTokenRequest(
      oauthConfig(connection.provider).token,
      {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          client_id: config.client,
          client_secret: config.secret,
          grant_type: "refresh_token",
          refresh_token: tokens.refresh_token,
        }),
      },
      network,
      "refresh",
    );
    if (!refreshed.access_token || !Number.isFinite(refreshed.expires_in))
      throw new ProviderError("retry");
    const next = {
      ...tokens,
      ...refreshed,
      refresh_token: refreshed.refresh_token || tokens.refresh_token,
    };
    const saved = await env.DB.prepare(
      "UPDATE connections SET tokens=?,expires_at=?,refresh_until=0,refresh_lease=NULL WHERE id=? AND status='connected' AND refresh_lease=? RETURNING id",
    )
      .bind(
        await encrypt(
          env,
          context(connection.user_id, connection.provider),
          next,
        ),
        Date.now() + next.expires_in * 1000,
        connection.id,
        lease,
      )
      .first();
    if (!saved) throw new ProviderError("retry");
    return next.access_token;
  } catch (error) {
    if (error instanceof ProviderError && error.kind === "reconnect") {
      await env.DB.prepare(
        "UPDATE connections SET status='reconnect',tokens=NULL WHERE id=? AND refresh_lease=?",
      )
        .bind(connection.id, lease)
        .run();
      await notify(
        env,
        connection.user_id,
        "reconnect",
        "Mailbox authorization expired or was revoked. Reconnect in Settings.",
        connection.id,
      );
    }
    throw error;
  } finally {
    await env.DB.prepare(
      "UPDATE connections SET refresh_until=0,refresh_lease=NULL WHERE id=? AND refresh_lease=?",
    )
      .bind(connection.id, lease)
      .run();
  }
}
export async function revokeMailboxTokens(
  env: Env,
  user: string,
  row: { provider: string; tokens: string | null },
  network: Fetcher = fetch,
) {
  if (row.provider !== "gmail" || !row.tokens) return false;
  try {
    const tokens = await decrypt<TokenSet>(
      env,
      context(user, row.provider),
      row.tokens,
    );
    const response = await network("https://oauth2.googleapis.com/revoke", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ token: tokens.refresh_token }),
      signal: AbortSignal.timeout(10000),
      redirect: "manual",
    });
    const revoked = response.ok;
    await response.body?.cancel();
    return revoked;
  } catch {
    return false;
  }
}
export async function disconnect(
  env: Env,
  user: string,
  id: string,
  network: Fetcher = fetch,
) {
  const row = await env.DB.prepare(
    "SELECT * FROM connections WHERE id=? AND user_id=?",
  )
    .bind(id, user)
    .first<any>();
  if (!row) throw new HttpError(404, "Not found");
  await env.DB.batch([
    env.DB.prepare(
      "UPDATE connections SET status='disconnected',tokens=NULL,refresh_until=0,refresh_lease=NULL WHERE id=? AND user_id=?",
    ).bind(id, user),
    env.DB.prepare(
      "UPDATE messages SET status='cancelled' WHERE status IN ('draft','pending') AND id IN (SELECT message_id FROM transports WHERE connection_id=?)",
    ).bind(id),
    env.DB.prepare(
      "UPDATE transports SET state='cancelled' WHERE connection_id=? AND state IN ('waiting','leased')",
    ).bind(id),
    env.DB.prepare(
      "UPDATE automation SET generated=1 WHERE message_id IN (SELECT message_id FROM transports WHERE connection_id=?)",
    ).bind(id),
  ]);
  const revoked = await revokeMailboxTokens(env, user, row, network);
  return Response.json({
    ok: true,
    provider_revocation:
      row.provider === "outlook"
        ? "Remove app consent in your Microsoft account to revoke provider access."
        : revoked
          ? "Local tokens removed; Google revocation confirmed."
          : "Local tokens removed; remove app consent in your Google account if provider revocation was unavailable.",
  });
}
