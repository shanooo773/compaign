import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { generateKeyPair, exportJWK, SignJWT } from "jose";
import { harness } from "./harness";
import { finishOAuth, decrypt } from "../src/oauth";
import { base64url, hash } from "../src/runtime";
import { scopes } from "../src/providers";
import { allowedRecipient } from "../src/automation";
let h: ReturnType<typeof harness>;
let keys: Awaited<ReturnType<typeof generateKeyPair>>,
  jwk: Awaited<ReturnType<typeof exportJWK>>;
beforeEach(async () => {
  h = harness();
  keys = await generateKeyPair("RS256", { extractable: true });
  jwk = {
    ...(await exportJWK(keys.publicKey)),
    kid: "activation-key",
    alg: "RS256",
    use: "sig",
  };
  Object.assign(h.env, {
    OAUTH_ENABLED: "true",
    LIVE_EMAIL_ENABLED: "true",
    MOCK_DELIVERY_ENABLED: "false",
    GMAIL_CLIENT_ID: "activation-client",
    GMAIL_CLIENT_SECRET: "synthetic",
    TOKEN_ENCRYPTION_KEY: Buffer.alloc(32, 7).toString("base64"),
    LIVE_OWNER_USER_IDS: "original-owner",
    LIVE_TEST_RECIPIENTS: "controlled@example.com",
  });
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.stubGlobal(
    "fetch",
    vi.fn(() => {
      throw Error("Real network forbidden");
    }),
  );
});
afterEach(() => {
  h.db.close();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
async function pending(email = "new.student@gmail.com") {
  const user = await h.user(email);
  h.db.prepare("UPDATE users SET legacy_access=0 WHERE id=?").run(user.id);
  return user;
}
async function begin(user: Awaited<ReturnType<typeof pending>>) {
  const response = await h.request(
    "/auth/google/start",
    "POST",
    { confirmed: true, user_id: "forged" },
    user.session,
  );
  expect(response.status).toBe(200);
  const auth = new URL((await response.json()).url),
    state = auth.searchParams.get("state")!;
  const row = h.db
    .prepare("SELECT * FROM oauth_states WHERE state_hash=?")
    .get(await hash(state))!;
  const proof = await decrypt<any>(
    h.env,
    `${user.id}:gmail:pkce`,
    String(row.verifier),
  );
  expect(
    base64url(
      new Uint8Array(
        await crypto.subtle.digest(
          "SHA-256",
          new TextEncoder().encode(proof.verifier),
        ),
      ),
    ),
  ).toBe(auth.searchParams.get("code_challenge"));
  return {
    auth,
    proof,
    row,
    state,
    cookie: response.headers.get("set-cookie")!.split(";")[0],
    url:
      h.env.APP_ORIGIN +
      "/api/oauth/gmail/callback?code=fixture&state=" +
      state,
  };
}
async function network(
  flow: Awaited<ReturnType<typeof begin>>,
  changes: Record<string, unknown> = {},
  options: Record<string, any> = {},
) {
  const now = Math.floor(Date.now() / 1000),
    claims = {
      iss: "https://accounts.google.com",
      aud: h.env.GMAIL_CLIENT_ID,
      sub: "stable-google-sub",
      email: flow.proof.email,
      email_verified: true,
      iat: now,
      exp: now + 3600,
      nonce: flow.proof.nonce,
      ...changes,
    };
  let id = await new SignJWT(claims)
    .setProtectedHeader({ alg: "RS256", kid: "activation-key" })
    .sign(keys.privateKey);
  if (options.forged) id = id.slice(0, -8) + "forged00";
  return vi.fn(async (url: any, init: any) => {
    url = String(url);
    if (url === "https://oauth2.googleapis.com/token") {
      expect(new URLSearchParams(init.body).get("code_verifier")).toBe(
        flow.proof.verifier,
      );
      if (options.revoke)
        h.db
          .prepare("DELETE FROM sessions WHERE user_id=?")
          .run(flow.row.user_id);
      return Response.json({
        access_token: "fixture-access",
        refresh_token: "fixture-refresh",
        token_type: "Bearer",
        expires_in: 3600,
        id_token: id,
        scope: options.scope || scopes("gmail", true).join(" "),
      });
    }
    if (url === "https://www.googleapis.com/oauth2/v3/certs")
      return Response.json({ keys: [jwk] });
    if (url === "https://openidconnect.googleapis.com/v1/userinfo")
      return Response.json({
        sub: options.userinfoSub || claims.sub,
        email: claims.email,
        email_verified: options.userinfoVerified === false ? false : true,
      });
    if (url === "https://gmail.googleapis.com/gmail/v1/users/me/profile")
      return Response.json({
        emailAddress: options.mailboxEmail || claims.email,
      });
    throw Error("Unexpected outbound request");
  });
}
async function complete(flow: Awaited<ReturnType<typeof begin>>, mock: any) {
  return finishOAuth(
    h.env,
    new Request(flow.url, { headers: { Cookie: flow.cookie } }),
    "gmail",
    mock,
  );
}
function untouched(user: string) {
  expect(
    h.db.prepare("SELECT email_verified_at FROM users WHERE id=?").get(user)!
      .email_verified_at,
  ).toBe(null);
  expect(
    h.db.prepare("SELECT count(*) n FROM google_student_identities").get()!.n,
  ).toBe(0);
  expect(h.db.prepare("SELECT count(*) n FROM connections").get()!.n).toBe(0);
}
describe("Google activation without transactional email", () => {
  it("atomically verifies matching Gmail identity, binds sub, connects Gmail, rotates sessions and unlocks dry-run outreach without approvals", async () => {
    const user = await pending(),
      flow = await begin(user);
    const response = await complete(flow, await network(flow));
    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe(
      h.env.APP_ORIGIN + "/?activation=verified",
    );
    expect(
      h.db
        .prepare("SELECT google_sub,user_id FROM google_student_identities")
        .get(),
    ).toMatchObject({ google_sub: "stable-google-sub", user_id: user.id });
    expect(
      h.db
        .prepare("SELECT email_verified_at FROM users WHERE id=?")
        .get(user.id)!.email_verified_at,
    ).toBeTruthy();
    const connection = h.db.prepare("SELECT * FROM connections").get()!;
    expect(connection.subject).toBe("stable-google-sub");
    expect(String(connection.tokens)).not.toContain("fixture-refresh");
    expect(
      await decrypt(
        h.env,
        `${user.id}:gmail:tokens:v1`,
        String(connection.tokens),
      ),
    ).not.toHaveProperty("id_token");
    expect(
      (await h.request("/auth/me", "GET", undefined, user.session)).status,
    ).toBe(401);
    const cookie = response.headers.get("set-cookie")!.split(";")[0];
    const state = await (
      await h.request("/state", "GET", undefined, cookie)
    ).json();
    expect(state.capabilities).toMatchObject({
      workspace_limited: false,
      live_email: true,
      production_outreach: true,
      live_owner: false,
    });
    expect(
      await allowedRecipient(h.env, "professor@example.edu", user.id),
    ).toBe(true);
    expect(
      (
        await h.request(
          "/outreach/mode",
          "POST",
          { confirmed: true, production_enabled: false },
          cookie,
        )
      ).status,
    ).toBe(403);
    expect(
      h.db.prepare("SELECT count(*) n FROM campaign_approvals").get()!.n,
    ).toBe(0);
    expect(h.db.prepare("SELECT count(*) n FROM messages").get()!.n).toBe(0);
    expect(h.db.prepare("SELECT count(*) n FROM deliveries").get()!.n).toBe(0);
  });
  it.each([
    { aud: "attacker-client" },
    { iss: "https://attacker.example" },
    { exp: 1 },
    { iat: Math.floor(Date.now() / 1000) + 3600 },
    { nonce: "wrong" },
    { email_verified: false },
    { email_verified: "true" },
    { sub: "" },
    { azp: "attacker" },
    { aud: ["activation-client", "attacker"] },
    { email: "different@gmail.com" },
    { email: "thirdparty@example.com" },
  ])("rejects invalid or non-authoritative identity %j", async (changes) => {
    const user = await pending(),
      flow = await begin(user);
    const response = await complete(flow, await network(flow, changes));
    expect(response.headers.get("location")).toContain("activation_error=");
    untouched(user.id);
  });
  it("rejects a forged signed response", async () => {
    const user = await pending(),
      flow = await begin(user);
    expect(
      (
        await complete(flow, await network(flow, {}, { forged: true }))
      ).headers.get("location"),
    ).toContain("activation_error=");
    untouched(user.id);
  });
  it.each([
    { scope: "openid email https://www.googleapis.com/auth/gmail.send" },
    { userinfoSub: "different-sub" },
    { userinfoVerified: false },
    { mailboxEmail: "other@gmail.com" },
    { revoke: true },
  ])(
    "rejects incomplete scopes, conflicting identities or revoked sessions %j",
    async (options) => {
      const user = await pending(),
        flow = await begin(user);
      expect(
        (await complete(flow, await network(flow, {}, options))).headers.get(
          "location",
        ),
      ).toContain("activation_error=");
      untouched(user.id);
    },
  );
  it("accepts authoritative matching Google Workspace identity", async () => {
    const user = await pending("student@university.example"),
      flow = await begin(user);
    expect(
      (
        await complete(flow, await network(flow, { hd: "university.example" }))
      ).headers.get("location"),
    ).toContain("activation=verified");
  });
  it("rejects foreign origins, anonymous starts and already verified accounts", async () => {
    const user = await pending();
    expect(
      (
        await h.request(
          "/auth/google/start",
          "POST",
          { confirmed: true },
          user.session,
          "https://attacker.example",
        )
      ).status,
    ).toBe(403);
    expect(
      (await h.request("/auth/google/start", "POST", { confirmed: true }))
        .status,
    ).toBe(401);
    h.db
      .prepare("UPDATE users SET email_verified_at=1 WHERE id=?")
      .run(user.id);
    expect(
      (
        await h.request(
          "/auth/google/start",
          "POST",
          { confirmed: true },
          user.session,
        )
      ).status,
    ).toBe(409);
  });
  it("rejects absent binding, expired state and replay without verifying another account", async () => {
    const user = await pending(),
      other = await pending("other@gmail.com"),
      flow = await begin(user),
      mock = await network(flow);
    await expect(
      finishOAuth(h.env, new Request(flow.url), "gmail", mock),
    ).rejects.toMatchObject({ status: 400 });
    h.db.prepare("UPDATE oauth_states SET expires_at=0").run();
    await expect(complete(flow, mock)).rejects.toMatchObject({ status: 400 });
    h.db
      .prepare("UPDATE oauth_states SET expires_at=?")
      .run(Date.now() + 60000);
    await complete(flow, mock);
    await expect(complete(flow, mock)).rejects.toMatchObject({ status: 400 });
    expect(
      h.db
        .prepare("SELECT email_verified_at FROM users WHERE id=?")
        .get(other.id)!.email_verified_at,
    ).toBe(null);
  });
  it("rolls back every activation write on database failure", async () => {
    const user = await pending(),
      flow = await begin(user);
    h.db.exec(
      "CREATE TRIGGER fail_activation BEFORE INSERT ON mailbox_checks BEGIN SELECT RAISE(ABORT,'fixture failure'); END;",
    );
    expect(
      (await complete(flow, await network(flow))).headers.get("location"),
    ).toContain("activation_error=");
    untouched(user.id);
    expect(
      (await h.request("/auth/me", "GET", undefined, user.session)).status,
    ).toBe(200);
  });
  it("does not steal a Google identity already used by an existing connection", async () => {
    const user = await pending(),
      old = await h.user("original@example.com");
    h.db
      .prepare(
        "INSERT INTO connections(id,user_id,provider,address,subject,status,scopes,tokens,expires_at) VALUES('existing',?,'gmail','old@gmail.com','stable-google-sub','connected','original-scopes','original-ciphertext',123)",
      )
      .run(old.id);
    const before = h.db.prepare("SELECT * FROM connections").get(),
      flow = await begin(user);
    expect(
      (await complete(flow, await network(flow))).headers.get("location"),
    ).toContain("activation_error=");
    expect(h.db.prepare("SELECT * FROM connections").get()).toEqual(before);
    expect(
      h.db
        .prepare("SELECT email_verified_at FROM users WHERE id=?")
        .get(user.id)!.email_verified_at,
    ).toBe(null);
  });
  it("keeps Turnstile required and distinct from email ownership", async () => {
    Object.assign(h.env, {
      TURNSTILE_ENABLED: "true",
      TURNSTILE_SITE_KEY: "fixture",
      TURNSTILE_SECRET_KEY: "fixture",
    });
    const data = {
      first_name: "New",
      last_name: "Student",
      email: "registration@gmail.com",
      password: "Maple river lantern planets 47",
      confirm_password: "Maple river lantern planets 47",
      accept_terms: true,
    };
    expect((await h.request("/auth/signup", "POST", data)).status).toBe(400);
    vi.mocked(fetch).mockImplementation(async (url: any) => {
      expect(url).toBe(
        "https://challenges.cloudflare.com/turnstile/v0/siteverify",
      );
      return Response.json({
        success: true,
        hostname: new URL(h.env.APP_ORIGIN).hostname,
        action: "signup",
        challenge_ts: new Date().toISOString(),
      });
    });
    expect(
      (
        await h.request("/auth/signup", "POST", {
          ...data,
          turnstile_token: "one-use-fixture",
        })
      ).status,
    ).toBe(200);
    expect(
      h.db
        .prepare(
          "SELECT email_verified_at,legacy_access FROM users WHERE email=?",
        )
        .get(data.email),
    ).toMatchObject({ email_verified_at: null, legacy_access: 0 });
    expect(
      h.db.prepare("SELECT count(*) n FROM google_student_identities").get()!.n,
    ).toBe(0);
  });
});
