const fs = require("node:fs"),
  assert = require("node:assert/strict"),
  { build } = require("esbuild");
const { Miniflare, convertV4MiniflareOptions } = require(
  require.resolve("miniflare", {
    paths: [require.resolve("wrangler/package.json")],
  }),
);
(async () => {
  const { generateKeyPair, exportJWK, SignJWT } = await import("jose"),
    pair = await generateKeyPair("RS256", { extractable: true }),
    jwk = {
      ...(await exportJWK(pair.publicKey)),
      kid: "native-google",
      alg: "RS256",
      use: "sig",
    };
  const origin = "https://native.activation.invalid";
  let nonce = "",
    requests = [];
  const bundle = await build({
    entryPoints: ["apps/api/src/index.ts"],
    bundle: true,
    write: false,
    format: "esm",
    platform: "browser",
  });
  const mf = new Miniflare(
    convertV4MiniflareOptions({
      modules: true,
      script: bundle.outputFiles[0].text,
      compatibilityDate: "2026-10-01",
      d1Databases: ["DB"],
      kvNamespaces: ["DOCUMENTS_KV"],
      bindings: {
        APP_ORIGIN: origin,
        OAUTH_ENABLED: "true",
        LIVE_EMAIL_ENABLED: "true",
        MOCK_DELIVERY_ENABLED: "false",
        LIVE_OWNER_USER_IDS: "existing-owner",
        LIVE_TEST_RECIPIENTS: "controlled@example.com",
        GMAIL_CLIENT_ID: "native-client",
        GMAIL_CLIENT_SECRET: "fixture-secret",
        TOKEN_ENCRYPTION_KEY: Buffer.alloc(32, 7).toString("base64"),
        TURNSTILE_ENABLED: "true",
        TURNSTILE_SITE_KEY: "fixture-key",
        TURNSTILE_SECRET_KEY: "fixture-secret",
      },
      outboundService: async (req) => {
        const url = req.url;
        requests.push(url);
        if (url === "https://challenges.cloudflare.com/turnstile/v0/siteverify")
          return Response.json({
            success: true,
            hostname: new URL(origin).hostname,
            action: "signup",
            challenge_ts: new Date().toISOString(),
          });
        if (url === "https://oauth2.googleapis.com/token") {
          const now = Math.floor(Date.now() / 1000),
            id_token = await new SignJWT({
              iss: "https://accounts.google.com",
              aud: "native-client",
              sub: "native-google-sub",
              email: "native.student@gmail.com",
              email_verified: true,
              nonce,
              iat: now,
              exp: now + 3600,
            })
              .setProtectedHeader({ alg: "RS256", kid: "native-google" })
              .sign(pair.privateKey);
          return Response.json({
            access_token: "native-access",
            refresh_token: "native-refresh",
            expires_in: 3600,
            token_type: "Bearer",
            id_token,
            scope:
              "openid email https://www.googleapis.com/auth/gmail.send https://www.googleapis.com/auth/gmail.readonly",
          });
        }
        if (url === "https://www.googleapis.com/oauth2/v3/certs")
          return Response.json({ keys: [jwk] });
        if (url === "https://openidconnect.googleapis.com/v1/userinfo")
          return Response.json({
            sub: "native-google-sub",
            email: "native.student@gmail.com",
            email_verified: true,
          });
        if (url === "https://gmail.googleapis.com/gmail/v1/users/me/profile")
          return Response.json({ emailAddress: "native.student@gmail.com" });
        throw Error("All other outbound requests forbidden");
      },
    }),
  );
  try {
    const db = await mf.getD1Database("DB");
    for (const file of fs
      .readdirSync("apps/api/migrations")
      .filter((x) => x.endsWith(".sql"))
      .sort())
      await db.exec(
        fs
          .readFileSync("apps/api/migrations/" + file, "utf8")
          .replace(/--[^\n]*/g, "")
          .replace(/\r?\n/g, " "),
      );
    const request = (path, method = "GET", data, cookie = "") =>
      mf.dispatchFetch(origin + "/api" + path, {
        method,
        redirect: "manual",
        headers: {
          Origin: origin,
          ...(cookie ? { Cookie: cookie } : {}),
          ...(data ? { "Content-Type": "application/json" } : {}),
        },
        body: data ? JSON.stringify(data) : undefined,
      });
    const signup = {
      first_name: "Native",
      last_name: "Student",
      email: "native.student@gmail.com",
      password: "Maple river lantern planets 47",
      confirm_password: "Maple river lantern planets 47",
      accept_terms: true,
      turnstile_token: "native-one-use",
    };
    assert.equal((await request("/auth/signup", "POST", signup)).status, 200);
    const user = await db
      .prepare("SELECT id,email_verified_at FROM users WHERE email=?")
      .bind(signup.email)
      .first();
    assert.equal(user.email_verified_at, null);
    const login = await request("/auth/login", "POST", {
      email: signup.email,
      password: signup.password,
    });
    assert.equal(login.status, 200);
    const session = login.headers.get("set-cookie").split(";")[0];
    const started = await request(
      "/auth/google/start",
      "POST",
      { confirmed: true },
      session,
    );
    assert.equal(started.status, 200);
    const auth = new URL((await started.json()).url);
    nonce = auth.searchParams.get("nonce");
    const callback =
        "/oauth/gmail/callback?code=native-code&state=" +
        auth.searchParams.get("state"),
      binding = started.headers.get("set-cookie").split(";")[0];
    const verified = await request(callback, "GET", undefined, binding);
    assert.equal(verified.status, 303);
    assert.equal(
      verified.headers.get("location"),
      origin + "/?activation=verified",
    );
    const cookie = verified.headers
      .getSetCookie()
      .find((value) => value.startsWith("session="))
      .split(";")[0];
    assert.equal(
      (await request("/auth/me", "GET", undefined, session)).status,
      401,
    );
    const state = await (
      await request("/state", "GET", undefined, cookie)
    ).json();
    assert.equal(state.capabilities.production_outreach, true);
    assert.equal(state.connections[0].address, signup.email);
    assert.equal(
      (await request(callback, "GET", undefined, binding)).status,
      400,
    );
    assert.equal(
      (
        await db
          .prepare("SELECT count(*) n FROM google_student_identities")
          .first()
      ).n,
      1,
    );
    for (const table of [
      "campaign_approvals",
      "message_authorizations",
      "deliveries",
      "transports",
    ])
      assert.equal(
        (await db.prepare("SELECT count(*) n FROM " + table).first()).n,
        0,
      );
    assert.equal(
      requests.some((url) => url.includes("/messages/send")),
      false,
    );
    console.log(
      "PASS native Workers/D1/KV: Turnstile registration, code+PKCE+signed Google identity, atomic activation/sub binding/Gmail, session rotation, replay rejection, outreach access. All provider traffic intercepted; no approvals or sends.",
    );
  } finally {
    await mf.dispose();
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
