import { createLocalJWKSet, jwtVerify } from "jose";
import { type Env, HttpError, random, hash, base64url } from "./runtime";
import { providerRequest, type Fetcher, type TokenSet } from "./providers";
export type GoogleActivationProof = {
  purpose: "google_activation";
  verifier: string;
  nonce: string;
  email: string;
};
export function isActivationProof(
  value: unknown,
): value is GoogleActivationProof {
  const p = value as GoogleActivationProof;
  return (
    !!p &&
    typeof p === "object" &&
    p.purpose === "google_activation" &&
    typeof p.verifier === "string" &&
    typeof p.nonce === "string" &&
    typeof p.email === "string"
  );
}
export async function verifiedGoogleIdentity(
  env: Env,
  tokens: TokenSet & { id_token?: string; token_type?: string },
  proof: GoogleActivationProof,
  network: Fetcher,
) {
  if (
    typeof tokens.id_token !== "string" ||
    tokens.id_token.length > 16384 ||
    tokens.token_type?.toLowerCase() !== "bearer" ||
    tokens.expires_in <= 0 ||
    tokens.expires_in > 86400
  )
    throw new HttpError(
      400,
      "Google did not supply the required identity and Gmail authorization. Please restart verification.",
    );
  let claims;
  try {
    const keys = await providerRequest(
      "https://www.googleapis.com/oauth2/v3/certs",
      {},
      network,
    );
    ({ payload: claims } = await jwtVerify(
      tokens.id_token,
      createLocalJWKSet(keys),
      {
        issuer: ["https://accounts.google.com", "accounts.google.com"],
        audience: env.GMAIL_CLIENT_ID,
        algorithms: ["RS256"],
        requiredClaims: [
          "sub",
          "email",
          "email_verified",
          "nonce",
          "iat",
          "exp",
        ],
        maxTokenAge: 600,
      },
    ));
  } catch {
    throw new HttpError(
      400,
      "Google identity signature or claims could not be verified. Restart Google verification.",
    );
  }
  if (
    claims.nonce !== proof.nonce ||
    (claims.azp !== undefined && claims.azp !== env.GMAIL_CLIENT_ID) ||
    (Array.isArray(claims.aud) &&
      claims.aud.length > 1 &&
      claims.azp !== env.GMAIL_CLIENT_ID) ||
    typeof claims.sub !== "string" ||
    !claims.sub ||
    claims.sub.length > 255 ||
    claims.email_verified !== true ||
    typeof claims.email !== "string"
  )
    throw new HttpError(
      400,
      "Google did not supply valid verified identity evidence. Your account remains restricted.",
    );
  const email = claims.email.toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254)
    throw new HttpError(400, "Google did not provide a valid email identity.");
  const domain = email.split("@")[1];
  if (
    domain !== "gmail.com" &&
    !(typeof claims.hd === "string" && claims.hd.toLowerCase() === domain)
  )
    throw new HttpError(
      400,
      "This Google account uses a third-party email address without authoritative Google Workspace evidence. Verification remains restricted. Use a Gmail or supported Google Workspace address for a separately registered account.",
    );
  if (email !== proof.email)
    throw new HttpError(
      409,
      "The Google email does not match your registered email. Nothing was linked or verified. Return to the dashboard and retry with the matching Google account. If you registered the wrong address, sign out and register the correct address separately; accounts are never merged automatically.",
    );
  if (claims.at_hash !== undefined) {
    const bytes = new Uint8Array(
      await crypto.subtle.digest(
        "SHA-256",
        new TextEncoder().encode(tokens.access_token),
      ),
    );
    if (claims.at_hash !== base64url(bytes.slice(0, bytes.length / 2)))
      throw new HttpError(400, "Google token binding was invalid.");
  }
  const identity = await providerRequest(
    "https://openidconnect.googleapis.com/v1/userinfo",
    { headers: { Authorization: "Bearer " + tokens.access_token } },
    network,
  );
  if (
    identity.sub !== claims.sub ||
    typeof identity.email !== "string" ||
    identity.email.toLowerCase() !== email ||
    identity.email_verified !== true
  )
    throw new HttpError(
      400,
      "Google identity evidence did not agree. No account was verified.",
    );
  const mailbox = await providerRequest(
    "https://gmail.googleapis.com/gmail/v1/users/me/profile",
    { headers: { Authorization: "Bearer " + tokens.access_token } },
    network,
  );
  if (
    typeof mailbox.emailAddress !== "string" ||
    mailbox.emailAddress.toLowerCase() !== email
  )
    throw new HttpError(
      400,
      "Gmail is unavailable or does not match the verified Google identity. No account was activated.",
    );
  return { sub: claims.sub, email };
}
export async function commitGoogleActivation(
  env: Env,
  row: { user_id: string; session_hash: string },
  identity: { sub: string; email: string },
  scopes: string,
  encryptedTokens: string,
  expiresIn: number,
) {
  const connection = crypto.randomUUID(),
    rawSession = random(),
    sessionHash = await hash(rawSession),
    now = Date.now();
  // The first NOT NULL insert is an atomic guard. Any failed guard/unique constraint
  // rolls back verification, connection, grant and session rotation together in D1.batch.
  try {
    await env.DB.batch([
      env.DB.prepare(
        `INSERT INTO google_student_identities(google_sub,user_id,email,verified_at) VALUES(?,(SELECT id FROM users WHERE id=? AND lower(email)=? AND email_verified_at IS NULL AND legacy_access=0 AND EXISTS(SELECT 1 FROM sessions WHERE token=? AND user_id=? AND expires_at>?) AND NOT EXISTS(SELECT 1 FROM connections WHERE provider='gmail' AND (user_id=? OR subject=?))),?,?)`,
      ).bind(
        identity.sub,
        row.user_id,
        identity.email,
        row.session_hash,
        row.user_id,
        now,
        row.user_id,
        identity.sub,
        identity.email,
        now,
      ),
      env.DB.prepare(
        "UPDATE users SET email_verified_at=? WHERE id=? AND email_verified_at IS NULL AND lower(email)=?",
      ).bind(now, row.user_id, identity.email),
      env.DB.prepare(
        "INSERT INTO connections(id,user_id,provider,address,subject,status,scopes,tokens,expires_at) VALUES(?,?,'gmail',?,?,'connected',?,?,?)",
      ).bind(
        connection,
        row.user_id,
        identity.email,
        identity.sub,
        scopes,
        encryptedTokens,
        now + expiresIn * 1000,
      ),
      env.DB.prepare(
        "INSERT INTO mailbox_checks(connection_id,checked_at,status,detail) VALUES(?,?,'ready','Google identity and Gmail access verified during student activation.')",
      ).bind(connection, now),
      env.DB.prepare("DELETE FROM account_tokens WHERE user_id=?").bind(
        row.user_id,
      ),
      env.DB.prepare("DELETE FROM oauth_states WHERE user_id=?").bind(
        row.user_id,
      ),
      env.DB.prepare("DELETE FROM sessions WHERE user_id=?").bind(row.user_id),
      env.DB.prepare(
        "INSERT INTO sessions(token,user_id,expires_at) VALUES(?,?,?)",
      ).bind(sessionHash, row.user_id, now + 604800000),
      env.DB.prepare(
        "INSERT INTO audit(id,user_id,action,entity_id) VALUES(?,?,'account.google_activated',?)",
      ).bind(crypto.randomUUID(), row.user_id, connection),
    ]);
  } catch {
    throw new HttpError(
      409,
      "Activation could not be completed safely. Your session may have expired or this Google identity may already be linked. Sign in and retry with your own matching Google account. No accounts were merged.",
    );
  }
  // Strict cookie is rotated after privilege elevation; the initiating session and
  // all overlapping authorization attempts are revoked atomically above.
  return new Response(null, {
    status: 303,
    headers: {
      Location: env.APP_ORIGIN + "/?activation=verified",
      "Set-Cookie": `session=${rawSession}; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=604800`,
    },
  });
}
