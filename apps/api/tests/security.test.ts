import { afterEach, beforeEach, describe, it, expect, vi } from "vitest";
import { harness } from "./harness";
import { passwordHash } from "../src/passwords";
import { base64url, hash } from "../src/runtime";
import { encodeCBOR } from "@levischuck/tiny-cbor";
import { verifyTurnstile } from "../src/turnstile";
let h: ReturnType<typeof harness>;
const password = "Maple river lantern planets 47",
  next = "Another long river sunrise 52";
beforeEach(() => {
  h = harness();
});
afterEach(() => {
  h.db.close();
  vi.unstubAllGlobals();
});
async function owner(email = "student@example.com") {
  const u = await h.user(email);
  h.db
    .prepare("UPDATE users SET password=? WHERE id=?")
    .run(await passwordHash(password), u.id);
  return u;
}
const reauth = { current_password: password };
async function codes(u: any) {
  const r = await h.request(
    "/account/security/recovery-codes",
    "POST",
    reauth,
    u.session,
  );
  expect(r.status).toBe(200);
  return ((await r.json()) as any).codes as string[];
}
const b64 = (s: string) => base64url(new TextEncoder().encode(s));
const concat = (...v: Uint8Array[]) =>
  Uint8Array.from(v.flatMap((a) => Array.from(a)));
async function authenticator(u: any) {
  const pair = await crypto.subtle.generateKey(
    { name: "ECDSA", namedCurve: "P-256" },
    true,
    ["sign", "verify"],
  );
  const pub = await crypto.subtle.exportKey("jwk", pair.publicKey);
  const decode = (s: string) => Uint8Array.from(Buffer.from(s, "base64url"));
  const cose = encodeCBOR(
    new Map<any, any>([
      [1, 2],
      [3, -7],
      [-1, 1],
      [-2, decode(pub.x!)],
      [-3, decode(pub.y!)],
    ]),
  );
  const id = crypto.getRandomValues(new Uint8Array(32)),
    rp = new URL(h.env.APP_ORIGIN).hostname;
  const rpHash = new Uint8Array(
    await crypto.subtle.digest("SHA-256", new TextEncoder().encode(rp)),
  );
  const begin = await h.request(
    "/account/security/passkey/options",
    "POST",
    reauth,
    u.session,
  );
  expect(begin.status).toBe(200);
  const opts: any = await begin.json();
  const client = b64(
    JSON.stringify({
      type: "webauthn.create",
      challenge: opts.options.challenge,
      origin: h.env.APP_ORIGIN,
    }),
  );
  const auth = concat(
    rpHash,
    new Uint8Array([69, 0, 0, 0, 0]),
    new Uint8Array(16),
    new Uint8Array([0, id.length]),
    id,
    new Uint8Array(cose),
  );
  const att = encodeCBOR(
    new Map<any, any>([
      ["fmt", "none"],
      ["attStmt", new Map()],
      ["authData", auth],
    ]),
  );
  const response = {
    id: base64url(id),
    rawId: base64url(id),
    type: "public-key",
    response: {
      clientDataJSON: client,
      attestationObject: base64url(new Uint8Array(att)),
      transports: ["internal"],
    },
    clientExtensionResults: {},
  };
  const finish = await h.request(
    "/account/security/passkey/verify",
    "POST",
    {
      challenge_id: opts.challenge_id,
      response,
      name: "Synthetic authenticator",
    },
    u.session,
  );
  expect(finish.status).toBe(200);
  async function assertion(
    options: any,
    origin = h.env.APP_ORIGIN,
    flags = 5,
    counter = 1,
  ) {
    const clientDataJSON = b64(
      JSON.stringify({
        type: "webauthn.get",
        challenge: options.challenge,
        origin,
      }),
    );
    const authData = concat(rpHash, new Uint8Array([flags, 0, 0, 0, counter]));
    const digest = new Uint8Array(
      await crypto.subtle.digest(
        "SHA-256",
        Buffer.from(clientDataJSON, "base64url"),
      ),
    );
    const raw = new Uint8Array(
      await crypto.subtle.sign(
        { name: "ECDSA", hash: "SHA-256" },
        pair.privateKey,
        concat(authData, digest),
      ),
    );
    const integer = (bytes: Uint8Array) => {
      let a = Array.from(bytes);
      while (a.length > 1 && a[0] === 0) a.shift();
      if (a[0] & 128) a.unshift(0);
      return [2, a.length, ...a];
    };
    const der = [...integer(raw.slice(0, 32)), ...integer(raw.slice(32))];
    return {
      id: base64url(id),
      rawId: base64url(id),
      type: "public-key",
      response: {
        clientDataJSON,
        authenticatorData: base64url(authData),
        signature: base64url(new Uint8Array([48, der.length, ...der])),
        userHandle: b64(u.id),
      },
      clientExtensionResults: {},
    };
  }
  return { response, opts, assertion };
}
describe("offline account security", () => {
  it("requires reauthentication and stores only hashes of ten distinct 128-bit codes", async () => {
    const u = await owner();
    expect(
      (
        await h.request(
          "/account/security/recovery-codes",
          "POST",
          { current_password: "wrong" },
          u.session,
        )
      ).status,
    ).toBe(401);
    const list = await codes(u);
    expect(new Set(list).size).toBe(10);
    expect(list[0].replaceAll("-", "")).toHaveLength(32);
    const rows = h.db.prepare("SELECT code_hash FROM recovery_codes").all();
    expect(rows).toHaveLength(10);
    expect(rows[0].code_hash).not.toBe(list[0]);
    expect(JSON.stringify(rows)).not.toContain(list[0]);
  });
  it("redeems once, revokes sessions, preserves mailbox credentials and rejects reuse", async () => {
    const u = await owner();
    const list = await codes(u);
    const data = {
      email: "student@example.com",
      code: list[0],
      password: next,
      confirm_password: next,
    };
    const r = await h.request("/auth/recovery-code", "POST", data);
    expect(r.status).toBe(200);
    expect(
      h.db.prepare("SELECT count(*) n FROM sessions WHERE user_id=?").get(u.id)!
        .n,
    ).toBe(0);
    expect((await h.request("/auth/recovery-code", "POST", data)).status).toBe(
      400,
    );
    expect(
      (
        await h.request("/auth/login", "POST", {
          email: data.email,
          password: next,
        })
      ).status,
    ).toBe(200);
    expect(h.db.prepare("SELECT count(*) n FROM recovery_codes").get()!.n).toBe(
      9,
    );
  });
  it("replaces old codes and isolates users", async () => {
    const a = await owner(),
      b = await owner("second@example.com");
    const old = await codes(a);
    await codes(a);
    expect(
      (await h.request("/account/security", "GET", undefined, b.session))
        .status,
    ).toBe(200);
    expect(
      (
        await h.request("/auth/recovery-code", "POST", {
          email: "student@example.com",
          code: old[0],
          password: next,
          confirm_password: next,
        })
      ).status,
    ).toBe(400);
  });
  it("returns the same generic recovery error for unknown account and wrong code", async () => {
    const a = await h.request("/auth/recovery-code", "POST", {
      email: "missing@example.com",
      code: "bad",
      password: next,
      confirm_password: next,
    });
    const b = await h.request("/auth/recovery-code", "POST", {
      email: "absent@example.com",
      code: "bad",
      password: next,
      confirm_password: next,
    });
    expect(await a.json()).toEqual(await b.json());
  });
  it("registers a real cryptographically verified synthetic passkey, logs in and rejects replay", async () => {
    const u = await owner(),
      a = await authenticator(u);
    const r: any = await (
      await h.request("/auth/passkey/options", "POST", {})
    ).json();
    const response = await a.assertion(r.options);
    const data = { challenge_id: r.challenge_id, response };
    const login = await h.request("/auth/passkey/verify", "POST", data);
    expect(login.status).toBe(200);
    expect(login.headers.get("Set-Cookie")).toContain("HttpOnly");
    expect((await h.request("/auth/passkey/verify", "POST", data)).status).toBe(
      400,
    );
    expect(
      (
        await h.request(
          "/account/security/passkey/verify",
          "POST",
          {
            challenge_id: a.opts.challenge_id,
            response: a.response,
            name: "replay",
          },
          u.session,
        )
      ).status,
    ).toBe(400);
  });
  it("rejects wrong origin and absent user verification with signed assertions", async () => {
    const u = await owner(),
      a = await authenticator(u);
    for (const [origin, flags] of [
      ["https://evil.example", 5],
      [h.env.APP_ORIGIN, 1],
    ] as const) {
      const r: any = await (
        await h.request("/auth/passkey/options", "POST", {})
      ).json();
      expect(
        (
          await h.request("/auth/passkey/verify", "POST", {
            challenge_id: r.challenge_id,
            response: await a.assertion(r.options, origin, flags),
          })
        ).status,
      ).toBe(401);
    }
  });
  it("allows passkey password recovery and revokes existing sessions", async () => {
    const u = await owner(),
      a = await authenticator(u);
    const r: any = await (
      await h.request("/auth/passkey/options", "POST", { recovery: true })
    ).json();
    expect(
      (
        await h.request("/auth/passkey/verify", "POST", {
          challenge_id: r.challenge_id,
          response: await a.assertion(r.options),
          recovery: true,
          password: next,
          confirm_password: next,
        })
      ).status,
    ).toBe(200);
    expect(
      h.db.prepare("SELECT count(*) n FROM sessions WHERE user_id=?").get(u.id)!
        .n,
    ).toBe(0);
  });
  it("rejects expired challenges and cross-user enrollment", async () => {
    const u = await owner();
    const r: any = await (
      await h.request(
        "/account/security/passkey/options",
        "POST",
        reauth,
        u.session,
      )
    ).json();
    h.db.exec("UPDATE auth_challenges SET expires_at=0");
    expect(
      (
        await h.request(
          "/account/security/passkey/verify",
          "POST",
          { challenge_id: r.challenge_id, response: {}, name: "Expired" },
          u.session,
        )
      ).status,
    ).toBe(400);
  });
});
describe("signup bot protection", () => {
  const req = new Request("https://api.test", {
    headers: { "CF-Connecting-IP": "192.0.2.1" },
  });
  const enabled = () =>
    Object.assign(h.env, {
      TURNSTILE_ENABLED: "true",
      TURNSTILE_SITE_KEY: "production-key",
      TURNSTILE_SECRET_KEY: "server-only",
    });
  const result = (change = {}) => ({
    success: true,
    hostname: new URL(h.env.APP_ORIGIN).hostname,
    action: "signup",
    challenge_ts: new Date().toISOString(),
    ...change,
  });
  it("does not enforce until keys and activation flag are installed", async () => {
    const network = vi.fn();
    await verifyTurnstile(req, h.env, undefined, network);
    expect(network).not.toHaveBeenCalled();
  });
  it("verifies hostname, action, age, failure and local replay", async () => {
    enabled();
    for (const change of [
      { success: false },
      { hostname: "evil.example" },
      { action: "login" },
      { challenge_ts: new Date(Date.now() - 301000).toISOString() },
    ])
      await expect(
        verifyTurnstile(
          req,
          h.env,
          "token",
          vi.fn(async () => Response.json(result(change))),
        ),
      ).rejects.toThrow();
    const network = vi.fn(async () => Response.json(result()));
    await verifyTurnstile(req, h.env, "unique-token", network);
    await expect(
      verifyTurnstile(req, h.env, "unique-token", network),
    ).rejects.toThrow();
  });
  it("fails closed on unavailable Siteverify or missing token", async () => {
    enabled();
    await expect(verifyTurnstile(req, h.env, undefined)).rejects.toThrow();
    await expect(
      verifyTurnstile(
        req,
        h.env,
        "token",
        vi.fn(async () => {
          throw new Error();
        }),
      ),
    ).rejects.toThrow();
  });
});

describe("security isolation and lifecycle", () => {
  it("atomically redeems a code once under concurrent requests", async () => {
    const u = await owner(),
      list = await codes(u),
      data = {
        email: "student@example.com",
        code: list[0],
        password: next,
        confirm_password: next,
      };
    const results = await Promise.all([
      h.request("/auth/recovery-code", "POST", data),
      h.request("/auth/recovery-code", "POST", data),
    ]);
    expect(results.map((r) => r.status).sort()).toEqual([200, 400]);
  });
  it("prevents another user from deleting a passkey and requires reauthentication for removal", async () => {
    const a = await owner(),
      key = await authenticator(a),
      b = await owner("second@example.com");
    expect(
      (
        await h.request(
          "/account/security/passkey/remove",
          "POST",
          { ...reauth, id: key.response.id },
          b.session,
        )
      ).status,
    ).toBe(200);
    expect(
      h.db.prepare("SELECT count(*) n FROM passkeys WHERE user_id=?").get(a.id)!
        .n,
    ).toBe(1);
    expect(
      (
        await h.request(
          "/account/security/passkey/remove",
          "POST",
          { current_password: "wrong", id: key.response.id },
          a.session,
        )
      ).status,
    ).toBe(401);
    expect(
      (
        await h.request(
          "/account/security/passkey/remove",
          "POST",
          { ...reauth, id: key.response.id },
          a.session,
        )
      ).status,
    ).toBe(200);
  });
  it("deletes enrolled security data and separately approved audit on account deletion", async () => {
    const u = await owner();
    await codes(u);
    await authenticator(u);
    h.db
      .prepare(
        "INSERT INTO followup_approvals(message_id,user_id,snapshot,authorized_at) VALUES(?,?,?,?)",
      )
      .run(
        crypto.randomUUID(),
        u.id,
        JSON.stringify({ days: 1, subject: "Synthetic", body: "Synthetic" }),
        Date.now(),
      );
    const r = await h.request(
      "/account/delete",
      "POST",
      { ...reauth, confirmation: "DELETE MY ACCOUNT" },
      u.session,
    );
    expect(r.status).toBe(200);
    for (const table of [
      "users",
      "recovery_codes",
      "passkeys",
      "auth_challenges",
      "followup_approvals",
    ])
      expect(h.db.prepare(`SELECT count(*) n FROM ${table}`).get()!.n).toBe(0);
    expect(h.db.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
  });
  it("works with transactional delivery disabled, creates an unverified pending account and exposes no Turnstile secret", async () => {
    h.env.MAIL_PROVIDER = "disabled";
    const network = vi.fn(() => {
      throw new Error("No external calls permitted");
    });
    vi.stubGlobal("fetch", network);
    const r = await h.request("/auth/signup", "POST", {
      email: "new@example.invalid",
      password,
      confirm_password: password,
      first_name: "Amira",
      last_name: "Khan",
      accept_terms: true,
    });
    expect(r.status).toBe(200);
    expect(network).not.toHaveBeenCalled();
    expect(
      h.db.prepare("SELECT email_verified_at FROM users").get()!
        .email_verified_at,
    ).toBeNull();
    h.env.TURNSTILE_SECRET_KEY = "never-public";
    expect(
      JSON.stringify(await (await h.request("/auth/config")).json()),
    ).not.toContain("never-public");
  });
});

describe("Turnstile configuration and signup enforcement", () => {
  it("publishes the configured public site key before enforcement without exposing the secret", async () => {
    Object.assign(h.env, {
      TURNSTILE_SITE_KEY: "configured-site-key",
      TURNSTILE_SECRET_KEY: "never-public",
      TURNSTILE_ENABLED: "false",
    });
    const r = await h.request("/auth/config");
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual({
      turnstile_site_key: "configured-site-key",
      turnstile_required: false,
    });
    expect(r.headers.get("Cache-Control")).toContain("no-store");
    h.env.TURNSTILE_ENABLED = "true";
    expect(await (await h.request("/auth/config")).json()).toEqual({
      turnstile_site_key: "configured-site-key",
      turnstile_required: true,
    });
  });
  it("fails closed when enforcement is enabled but a key is missing", async () => {
    h.env.TURNSTILE_ENABLED = "true";
    const network = vi.fn();
    await expect(
      verifyTurnstile(new Request("https://api.test"), h.env, "token", network),
    ).rejects.toThrow("temporarily unavailable");
    expect(network).not.toHaveBeenCalled();
    expect(await (await h.request("/auth/config")).json()).toEqual({
      turnstile_site_key: null,
      turnstile_required: true,
    });
  });
  it("rejects missing, invalid and replayed tokens at the actual signup route", async () => {
    Object.assign(h.env, {
      TURNSTILE_ENABLED: "true",
      TURNSTILE_SITE_KEY: "production-key",
      TURNSTILE_SECRET_KEY: "server-only",
    });
    const input = {
      email: "protected@example.invalid",
      password,
      confirm_password: password,
      first_name: "Amira",
      last_name: "Research",
      accept_terms: true,
    };
    const network = vi.fn(async (_url: any, init: any) => {
      expect(_url).toBe(
        "https://challenges.cloudflare.com/turnstile/v0/siteverify",
      );
      expect(init.body.get("secret")).toBe("server-only");
      return Response.json({
        success: init.body.get("response") === "valid-synthetic-token",
        hostname: new URL(h.env.APP_ORIGIN).hostname,
        action: "signup",
        challenge_ts: new Date().toISOString(),
      });
    });
    vi.stubGlobal("fetch", network);
    expect((await h.request("/auth/signup", "POST", input)).status).toBe(400);
    expect(network).not.toHaveBeenCalled();
    expect(
      (
        await h.request("/auth/signup", "POST", {
          ...input,
          turnstile_token: "invalid",
        })
      ).status,
    ).toBe(400);
    expect(h.db.prepare("SELECT count(*) n FROM users").get()!.n).toBe(0);
    expect(
      (
        await h.request("/auth/signup", "POST", {
          ...input,
          turnstile_token: "valid-synthetic-token",
        })
      ).status,
    ).toBe(200);
    expect(
      (
        await h.request("/auth/signup", "POST", {
          ...input,
          turnstile_token: "valid-synthetic-token",
        })
      ).status,
    ).toBe(429);
    expect(h.db.prepare("SELECT count(*) n FROM users").get()!.n).toBe(1);
  });
  it("renders nothing only when keys have not been installed", async () => {
    expect(await (await h.request("/auth/config")).json()).toEqual({
      turnstile_site_key: null,
      turnstile_required: false,
    });
  });
});

it("validates supplied preview tokens before enforcement, without requiring absent tokens", async () => {
  const h = harness();
  Object.assign(h.env, {
    TURNSTILE_SITE_KEY: "production-key",
    TURNSTILE_SECRET_KEY: "server-only",
    TURNSTILE_ENABLED: "false",
  });
  const req = new Request("https://api.test"),
    network = vi.fn(async () =>
      Response.json({
        success: true,
        hostname: new URL(h.env.APP_ORIGIN).hostname,
        action: "signup",
        challenge_ts: new Date().toISOString(),
      }),
    );
  try {
    await verifyTurnstile(req, h.env, undefined, network);
    expect(network).not.toHaveBeenCalled();
    await verifyTurnstile(req, h.env, "genuine-preview-fixture", network);
    expect(network).toHaveBeenCalledOnce();
    expect(
      h.db
        .prepare(
          "SELECT count(*) n FROM usage_counters WHERE scope LIKE 'turnstile:%'",
        )
        .get()!.n,
    ).toBe(1);
  } finally {
    h.db.close();
  }
});
