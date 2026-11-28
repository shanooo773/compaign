import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { harness, fileForm } from "./harness";
import { encrypt } from "../src/oauth";
import { runLiveJobs, syncReplies, queueFollowups } from "../src/automation";
import { runJobs } from "../src/index";
let h: ReturnType<typeof harness>;
beforeEach(() => {
  h = harness();
  h.env.OAUTH_ENABLED = "true";
  h.env.LIVE_EMAIL_ENABLED = "true";
  h.env.LIVE_TEST_RECIPIENTS = "controlled@example.com";
  h.env.TOKEN_ENCRYPTION_KEY = btoa(
    String.fromCharCode(...new Uint8Array(32).fill(7)),
  );
  h.env.GMAIL_CLIENT_ID = "synthetic-client";
  h.env.GMAIL_CLIENT_SECRET = "synthetic-secret";
  h.env.OUTLOOK_CLIENT_ID = "synthetic-client";
  h.env.OUTLOOK_CLIENT_SECRET = "synthetic-secret";
  vi.stubGlobal(
    "fetch",
    vi.fn(() => {
      throw new Error("Live network forbidden");
    }),
  );
});
afterEach(() => {
  h.db.close();
  vi.unstubAllGlobals();
});
async function setup(provider = "gmail", followup = false, days = 7) {
  const user = await h.user(crypto.randomUUID() + "@example.com"),
    connection = crypto.randomUUID(),
    professor = crypto.randomUUID();
  const tokens = await encrypt(h.env, user.id + ":" + provider + ":tokens:v1", {
    access_token: "synthetic-access",
    refresh_token: "synthetic-refresh",
    expires_in: 3600,
  });
  h.db
    .prepare(
      "INSERT INTO connections(id,user_id,provider,address,subject,scopes,tokens,expires_at) VALUES(?,?,?,?,?,?,?,?)",
    )
    .run(
      connection,
      user.id,
      provider,
      "sender@example.com",
      "synthetic-subject",
      provider === "gmail"
        ? "https://www.googleapis.com/auth/gmail.send https://www.googleapis.com/auth/gmail.readonly"
        : "Mail.Send Mail.Read",
      tokens,
      Date.now() + 3600000,
    );
  h.db
    .prepare("INSERT INTO professors(id,user_id,name,email) VALUES(?,?,?,?)")
    .run(professor, user.id, "Synthetic Professor", "controlled@example.com");
  const created = await h.request(
    "/messages",
    "POST",
    {
      professor_id: professor,
      subject: "Exact approved subject",
      body: "Exact approved body",
      mode: "auto",
      authorized: true,
      scheduled_at: new Date(Date.now() - 1000).toISOString(),
      timezone: "UTC",
      attachments: [],
      sending_account_id: connection, without_attachments_acknowledged: true,
      ...(followup
        ? {
            followup: {
              days,
              subject: "Exact follow-up",
              body: "Exact follow-up body",
              authorized: true,
            },
          }
        : {}),
    },
    user.session,
  );
  expect(created.status).toBe(200);
  const { id } = await created.json();
  return { ...user, connection, professor, message: id };
}
const transport = () =>
  h.db.prepare("SELECT * FROM transports ORDER BY rowid LIMIT 1").get()!;
const message = () =>
  h.db.prepare("SELECT * FROM messages ORDER BY rowid LIMIT 1").get()!;
function makeDue() {
  h.db.prepare("UPDATE transports SET next_at=0,next_sync=0").run();
  h.db
    .prepare("DELETE FROM usage_counters WHERE scope LIKE 'send:%:minute'")
    .run();
}
describe("bounded reliable live-test outbox", () => {
  it("supports a three-day authorized follow-up, never earlier, after a complete reply check", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    try {
      const start = Date.now(),
        a = await setup("gmail", true, 3);
      h.db
        .prepare("UPDATE connections SET expires_at=?")
        .run(start + 10 * 86400000);
      await runLiveJobs(h.env, (async () =>
        Response.json({ id: "sent", threadId: "thread" })) as any);
      vi.setSystemTime(start + 2 * 86400000);
      makeDue();
      await syncReplies(h.env, (async () =>
        Response.json({ messages: [] })) as any);
      await queueFollowups(h.env);
      expect(
        h.db
          .prepare(
            "SELECT count(*) n FROM messages WHERE parent_id IS NOT NULL",
          )
          .get()!.n,
      ).toBe(0);
      vi.setSystemTime(start + 3 * 86400000 + 1000);
      makeDue();
      await syncReplies(h.env, (async () =>
        Response.json({ messages: [] })) as any);
      await queueFollowups(h.env);
      expect(
        h.db
          .prepare(
            "SELECT count(*) n FROM messages WHERE parent_id IS NOT NULL",
          )
          .get()!.n,
      ).toBe(1);
    } finally {
      vi.useRealTimers();
    }
  });
  it("requires explicit follow-up authorization and accepts only delays within the configured range", async () => {
    const a = await setup();
    for (const followup of [
      { days: 3, authorized: false },
      { days: 3 },
      { days: 0, authorized: true },
      { days: 61, authorized: true },
    ]) {
      const result = await h.request(
        "/messages",
        "POST",
        {
          professor_id: a.professor,
          subject: "s",
          body: "b",
          mode: "review",
          scheduled_at: new Date().toISOString(),
          timezone: "UTC",
          sending_account_id: a.connection, without_attachments_acknowledged: true,
          followup: {
            subject: "follow-up",
            body: "exact content",
            ...followup,
          },
        },
        a.session,
      );
      expect(result.status).toBe(400);
    }
    expect(h.db.prepare("SELECT count(*) n FROM automation").get()!.n).toBe(0);
  });
  it("does not submit unapproved or future scheduled messages", async () => {
    const a = await setup();
    const network = vi.fn();
    h.db.prepare("UPDATE messages SET approved=0 WHERE id=?").run(a.message);
    await runLiveJobs(h.env, network as any);
    h.db
      .prepare(
        "UPDATE messages SET approved=1,scheduled_at='2099-01-01T00:00:00Z' WHERE id=?",
      )
      .run(a.message);
    await runLiveJobs(h.env, network as any);
    expect(network).not.toHaveBeenCalled();
    expect(transport().attempts).toBe(0);
  });
  it("shares a mailbox minute limit across different application users", async () => {
    await setup();
    await setup();
    const network = vi.fn(async () =>
      Response.json({ id: "sent", threadId: "thread" }),
    );
    await runLiveJobs(h.env, network as any);
    await runLiveJobs(h.env, network as any);
    expect(network).toHaveBeenCalledTimes(1);
    expect(h.db.prepare("SELECT count(*) n FROM deliveries").get()!.n).toBe(1);
  });
  it.each(["global"])(
    "enforces the %s daily send budget before provider submission",
    async (scope) => {
      const a = await setup();
      const { hash } = await import("../src/runtime");
      const key =
        scope === "student"
          ? `send:${a.id}:day`
          : scope === "global"
            ? "send:global:day"
            : `send:mailbox:${await hash("gmail:synthetic-subject")}:day`;
      h.db
        .prepare(
          "INSERT INTO usage_counters(scope,period,amount) VALUES(?,?,?)",
        )
        .run(
          key,
          new Date().toISOString().slice(0, 10),
          scope === "global" ? 100 : 10,
        );
      const network = vi.fn();
      await runLiveJobs(h.env, network as any);
      expect(network).not.toHaveBeenCalled();
      expect(transport().attempts).toBe(0);
    },
  );

  it("claims once across concurrent workers, preserves approved recipient/content, and never mock-delivers a live message", async () => {
    const a = await setup();
    h.db
      .prepare("UPDATE professors SET email=? WHERE id=?")
      .run("changed@example.com", a.professor);
    await runJobs(h.env);
    expect(h.db.prepare("SELECT count(*) n FROM deliveries").get()!.n).toBe(0);
    const network = vi.fn(async (url: any, init: any) => {
      expect(String(url)).toContain("gmail.googleapis.com");
      const raw = JSON.parse(init.body).raw;
      const decoded = Buffer.from(
        raw.replace(/-/g, "+").replace(/_/g, "/"),
        "base64",
      ).toString();
      expect(decoded).toContain("To: controlled@example.com");
      return Response.json({ id: "receipt-1", threadId: "thread-1" });
    });
    await Promise.all([
      runLiveJobs(h.env, network as any),
      runLiveJobs(h.env, network as any),
    ]);
    expect(network).toHaveBeenCalledTimes(1);
    expect(transport().state).toBe("confirmed");
    expect(message().status).toBe("sent");
  });
  it("never blindly retries an uncertain send; only reconciliation can confirm it", async () => {
    await setup();
    const send = vi.fn(async () => {
      throw new Error("timeout after acceptance");
    });
    await runLiveJobs(h.env, send as any);
    expect(transport().state).toBe("uncertain");
    makeDue();
    const empty = vi.fn(async () => Response.json({ messages: [] }));
    await runLiveJobs(h.env, empty as any);
    expect(transport().state).toBe("uncertain");
    expect(send).toHaveBeenCalledTimes(1);
    makeDue();
    const found = vi.fn(async (url: any) =>
      String(url).includes("?maxResults=")
        ? Response.json({ messages: [{ id: "accepted" }] })
        : Response.json({ id: "accepted", threadId: "thread" }),
    );
    await runLiveJobs(h.env, found as any);
    expect(transport().state).toBe("confirmed");
    expect(message().status).toBe("sent");
    expect(send).toHaveBeenCalledTimes(1);
  });
  it("treats Graph 202 as pending confirmation and reconciles its custom identifier", async () => {
    await setup("outlook");
    await runLiveJobs(
      h.env,
      (async () => new Response(null, { status: 202 })) as any,
    );
    expect(transport().state).toBe("uncertain");
    const key = JSON.parse(String(transport().snapshot)).key;
    makeDue();
    await runLiveJobs(h.env, (async () =>
      Response.json({
        value: [
          {
            id: "graph-receipt",
            conversationId: "conversation",
            internetMessageHeaders: [{ name: "x-outreach-id", value: key }],
          },
        ],
      })) as any);
    expect(transport().state).toBe("confirmed");
    expect(transport().provider_id).toBe("graph-receipt");
  });
  it("respects pause, exact recipient allowlist, disconnect and disabled global sending", async () => {
    const a = await setup();
    const network = vi.fn();
    h.db.prepare("UPDATE profiles SET paused=1").run();
    await runLiveJobs(h.env, network as any);
    expect(network).not.toHaveBeenCalled();
    h.db.prepare("UPDATE profiles SET paused=0").run();
    h.env.LIVE_EMAIL_ENABLED = "false";
    await runLiveJobs(h.env, network as any);
    expect(network).not.toHaveBeenCalled();
    h.env.LIVE_EMAIL_ENABLED = "true";
    h.env.LIVE_TEST_RECIPIENTS = "different@example.com";
    await runLiveJobs(h.env, network as any);
    expect(network).not.toHaveBeenCalled();
    const response = await h.request(
      "/connections/" + a.connection + "/disconnect",
      "POST",
      undefined,
      a.session,
    );
    expect(response.status).toBe(200);
    expect(
      h.db.prepare("SELECT tokens,status FROM connections").get(),
    ).toMatchObject({ tokens: null, status: "disconnected" });
    expect(message().status).toBe("cancelled");
  });
  it("backs off on a proven 429 rejection but does not bypass minute quotas", async () => {
    await setup();
    const network = vi.fn(
      async () =>
        new Response(null, { status: 429, headers: { "Retry-After": "120" } }),
    );
    await runLiveJobs(h.env, network as any);
    expect(transport().state).toBe("waiting");
    expect(Number(transport().next_at)).toBeGreaterThan(Date.now() + 100000);
    h.db.prepare("UPDATE transports SET next_at=0").run();
    await runLiveJobs(h.env, network as any);
    expect(network).toHaveBeenCalledTimes(1);
  });
  it("rejects cross-user account selection and unauthorised recipients before queueing", async () => {
    const a = await setup(),
      b = await h.user("other@example.com"),
      prof = crypto.randomUUID();
    h.db
      .prepare("INSERT INTO professors(id,user_id,name,email) VALUES(?,?,?,?)")
      .run(prof, b.id, "Test", "controlled@example.com");
    const response = await h.request(
      "/messages",
      "POST",
      {
        professor_id: prof,
        subject: "s",
        body: "b",
        mode: "auto",
        authorized: true,
        scheduled_at: new Date().toISOString(),
        timezone: "UTC",
        sending_account_id: a.connection, without_attachments_acknowledged: true,
      },
      b.session,
    );
    expect(response.status).toBe(404);
    expect(h.db.prepare("SELECT count(*) n FROM transports").get()!.n).toBe(1);
  });
  it("does not send changed or expired approved attachments", async () => {
    const a = await setup();
    const { id } = await (
      await h.request("/documents", "POST", fileForm(), a.session)
    ).json();
    const doc = h.db.prepare("SELECT * FROM documents WHERE id=?").get(id)!;
    const snapshot = JSON.parse(String(transport().snapshot));
    snapshot.attachments = [
      {
        id,
        checksum: doc.checksum,
        size: doc.size,
        name: doc.name,
        content_type: doc.content_type,
      },
    ];
    h.db
      .prepare("UPDATE transports SET snapshot=?")
      .run(JSON.stringify(snapshot));
    h.db.prepare("UPDATE documents SET checksum='changed'").run();
    const network = vi.fn();
    await runLiveJobs(h.env, network as any);
    expect(network).not.toHaveBeenCalled();
    expect(message().status).toBe("failed");
  });
  it("enforces a hard 400-message active cap without partial inserts", async () => {
    const a = await setup();
    for (let i = 0; i < 399; i++)
      h.db
        .prepare(
          "INSERT INTO messages(id,user_id,professor_id,subject,body,mode,scheduled_at,timezone) VALUES(?,?,?,'s','b','manual',?,'UTC')",
        )
        .run(crypto.randomUUID(), a.id, a.professor, new Date().toISOString());
    const response = await h.request(
      "/messages",
      "POST",
      {
        professor_id: a.professor,
        subject: "s",
        body: "b",
        mode: "manual",
        scheduled_at: new Date().toISOString(),
        timezone: "UTC",
      },
      a.session,
    );
    expect(response.status).toBe(429);
    expect(h.db.prepare("SELECT count(*) n FROM messages").get()!.n).toBe(400);
  });
});
describe("reply-driven follow-up safety", () => {
  async function sent() {
    const a = await setup("gmail", true);
    await runLiveJobs(h.env, (async () =>
      Response.json({
        id: "sent",
        threadId: "thread",
        internalDate: String(Date.now() - 8 * 86400000),
      })) as any);
    h.db
      .prepare("UPDATE messages SET sent_at=?")
      .run(new Date(Date.now() - 8 * 86400000).toISOString());
    makeDue();
    return a;
  }
  it("preserves Gmail threading for a matching exact follow-up subject", async () => {
    const a = await sent();
    h.db
      .prepare(
        "UPDATE automation SET subject=(SELECT subject FROM messages WHERE id=?) WHERE message_id=?",
      )
      .run(a.message, a.message);
    await syncReplies(h.env, (async () =>
      Response.json({ messages: [] })) as any);
    await queueFollowups(h.env);
    const snapshot = JSON.parse(
      String(
        h.db
          .prepare(
            "SELECT t.snapshot FROM transports t JOIN messages m ON m.id=t.message_id WHERE m.parent_id=?",
          )
          .get(a.message)!.snapshot,
      ),
    );
    expect(snapshot.threadId).toBe("thread");
    expect(snapshot.inReplyTo).toBe(
      JSON.parse(
        String(
          h.db
            .prepare("SELECT snapshot FROM transports WHERE message_id=?")
            .get(a.message)!.snapshot,
        ),
      ).key,
    );
  });
  it("requires a successful complete reply check and creates at most one exact preauthorised follow-up", async () => {
    const a = await sent();
    await queueFollowups(h.env);
    expect(h.db.prepare("SELECT count(*) n FROM messages").get()!.n).toBe(1);
    await syncReplies(
      h.env,
      (async () => Response.json({ messages: [] })) as any,
      a.id,
      a.message,
    );
    await Promise.all([queueFollowups(h.env), queueFollowups(h.env)]);
    const children = h.db
      .prepare("SELECT * FROM messages WHERE parent_id=?")
      .all(a.message);
    expect(children).toHaveLength(1);
    const childSnapshot = JSON.parse(
      String(
        h.db
          .prepare("SELECT snapshot FROM transports WHERE message_id=?")
          .get(children[0].id)!.snapshot,
      ),
    );
    expect(childSnapshot.threadId).toBeUndefined(); // Different exact subjects are tracked in their own Gmail thread.
    expect(childSnapshot.inReplyTo).toBeTruthy();
    expect(children[0]).toMatchObject({
      subject: "Exact follow-up",
      body: "Exact follow-up body",
      authorized: 1,
      approved: 1,
    });
    expect(h.db.prepare("SELECT count(*) n FROM automation").get()!.n).toBe(1);
  });
  it("does not create a follow-up when reply synchronization fails", async () => {
    await sent();
    await syncReplies(
      h.env,
      (async () => new Response(null, { status: 500 })) as any,
    );
    await queueFollowups(h.env);
    expect(h.db.prepare("SELECT count(*) n FROM messages").get()!.n).toBe(1);
  });
  it("deduplicates delayed replies, suppresses declines, and stops follow-ups atomically", async () => {
    const a = await sent();
    const network = vi.fn(async () =>
      Response.json({
        messages: [
          {
            id: "inbound-1",
            internalDate: String(Date.now() - 1000),
            snippet: "Not interested. Please do not contact me.",
            payload: {
              headers: [
                { name: "From", value: "Professor <controlled@example.com>" },
              ],
            },
          },
        ],
      }),
    );
    await syncReplies(h.env, network as any);
    expect(message().status).toBe("replied");
    expect(h.db.prepare("SELECT reason FROM suppressions").get()!.reason).toBe(
      "decline",
    );
    expect(
      h.db.prepare("SELECT generated FROM automation").get()!.generated,
    ).toBe(1);
    makeDue();
    await syncReplies(h.env, network as any);
    expect(h.db.prepare("SELECT count(*) n FROM mailbox_events").get()!.n).toBe(
      1,
    );
    expect(
      h.db
        .prepare("SELECT count(*) n FROM notifications WHERE kind='decline'")
        .get()!.n,
    ).toBe(1);
    await queueFollowups(h.env);
    expect(h.db.prepare("SELECT count(*) n FROM messages").get()!.n).toBe(1);
  });
  it("checks replies again before submitting an already queued child and cancels it on an arriving reply", async () => {
    const a = await sent();
    await syncReplies(h.env, (async () =>
      Response.json({ messages: [] })) as any);
    await queueFollowups(h.env);
    makeDue();
    const network = vi.fn(async () =>
      Response.json({
        messages: [
          {
            id: "late-reply",
            internalDate: String(Date.now() - 1000),
            snippet: "Thank you",
            payload: {
              headers: [{ name: "From", value: "controlled@example.com" }],
            },
          },
        ],
      }),
    );
    await runLiveJobs(h.env, network as any);
    expect(network).toHaveBeenCalledTimes(2);
    expect(
      h.db
        .prepare("SELECT status FROM messages WHERE parent_id=?")
        .get(a.message)!.status,
    ).toBe("cancelled");
    expect(h.db.prepare("SELECT count(*) n FROM deliveries").get()!.n).toBe(1);
  });
  it("keeps a queued child unsent when its final reply check fails", async () => {
    await sent();
    await syncReplies(h.env, (async () =>
      Response.json({ messages: [] })) as any);
    await queueFollowups(h.env);
    makeDue();
    const network = vi.fn(async () => new Response(null, { status: 500 }));
    await runLiveJobs(h.env, network as any);
    expect(network).toHaveBeenCalledTimes(1);
    expect(h.db.prepare("SELECT count(*) n FROM deliveries").get()!.n).toBe(1);
    expect(
      h.db
        .prepare(
          "SELECT attempts FROM transports WHERE message_id IN (SELECT id FROM messages WHERE parent_id IS NOT NULL)",
        )
        .get()!.attempts,
    ).toBe(0);
  });
  it("cancels an already queued child after a manual reply", async () => {
    const a = await sent();
    await syncReplies(h.env, (async () =>
      Response.json({ messages: [] })) as any);
    await queueFollowups(h.env);
    expect(
      h.db
        .prepare("SELECT count(*) n FROM messages WHERE status='pending'")
        .get()!.n,
    ).toBe(1);
    expect(
      (
        await h.request(
          "/messages/" + a.message + "/reply",
          "POST",
          undefined,
          a.session,
        )
      ).status,
    ).toBe(200);
    expect(
      h.db
        .prepare("SELECT status FROM messages WHERE parent_id=?")
        .get(a.message)!.status,
    ).toBe("cancelled");
  });
  it("stops pending live mail and follow-ups when a recipient is opted out", async () => {
    const a = await setup("gmail", true);
    expect(
      (
        await h.request(
          "/suppressions",
          "POST",
          { address: "controlled@example.com" },
          a.session,
        )
      ).status,
    ).toBe(200);
    const network = vi.fn();
    await runLiveJobs(h.env, network as any);
    expect(network).not.toHaveBeenCalled();
    expect(message().status).toBe("cancelled");
    expect(
      h.db.prepare("SELECT generated FROM automation").get()!.generated,
    ).toBe(1);
  });
  it("records a correlated delivery-status bounce without another send", async () => {
    await sent();
    await syncReplies(h.env, (async () =>
      Response.json({
        messages: [
          {
            id: "dsn-1",
            internalDate: String(Date.now() - 1000),
            snippet: "Delivery failed",
            payload: {
              headers: [
                { name: "From", value: "mailer-daemon@example.net" },
                {
                  name: "Content-Type",
                  value: "multipart/report; report-type=delivery-status",
                },
              ],
            },
          },
        ],
      })) as any);
    expect(message().status).toBe("failed");
    expect(h.db.prepare("SELECT reason FROM suppressions").get()!.reason).toBe(
      "bounce",
    );
    expect(
      h.db.prepare("SELECT generated FROM automation").get()!.generated,
    ).toBe(1);
  });
  it("scopes manual reply checks to the requesting user", async () => {
    const a = await sent();
    await setup("gmail", false);
    h.db
      .prepare(
        "UPDATE transports SET state='confirmed',thread_id='second-thread',next_sync=0",
      )
      .run();
    h.db
      .prepare("UPDATE messages SET status='sent',sent_at=?")
      .run(new Date(Date.now() - 3600000).toISOString());
    const network = vi.fn(async () => Response.json({ messages: [] }));
    await syncReplies(h.env, network as any, a.id);
    expect(network).toHaveBeenCalledTimes(2);
  });
  it("materializes a reserved follow-up at full active capacity without double counting", async () => {
    const a = await sent();
    for (let i = 0; i < 399; i++)
      h.db
        .prepare(
          "INSERT INTO messages(id,user_id,professor_id,subject,body,mode,scheduled_at,timezone) VALUES(?,?,?,'s','b','manual',?,'UTC')",
        )
        .run(crypto.randomUUID(), a.id, a.professor, new Date().toISOString());
    await syncReplies(h.env, (async () =>
      Response.json({ messages: [] })) as any);
    await queueFollowups(h.env);
    expect(
      h.db.prepare("SELECT generated FROM automation").get()!.generated,
    ).toBe(1);
    expect(
      h.db
        .prepare("SELECT count(*) n FROM notifications WHERE kind='followup'")
        .get()!.n,
    ).toBe(0);
    expect(
      h.db
        .prepare("SELECT count(*) n FROM messages WHERE parent_id IS NOT NULL")
        .get()!.n,
    ).toBe(1);
    expect(h.db.prepare("SELECT count(*) n FROM active_message_capacity").get()!.n).toBe(400);
  });
  it("continues read-only reply checks when new sending is disabled", async () => {
    await sent();
    h.env.LIVE_EMAIL_ENABLED = "false";
    const network = vi.fn(async () =>
      Response.json({
        messages: [
          {
            id: "reply-while-paused",
            internalDate: String(Date.now() - 1000),
            snippet: "Thank you for contacting me.",
            payload: {
              headers: [{ name: "From", value: "controlled@example.com" }],
            },
          },
        ],
      }),
    );
    await syncReplies(h.env, network as any);
    expect(message().status).toBe("replied");
    expect(network).toHaveBeenCalledTimes(2);
    await runLiveJobs(h.env, network as any);
    expect(network).toHaveBeenCalledTimes(2);
  });
  it("can reconcile an earlier uncertain outcome without re-enabling sending", async () => {
    await setup();
    await runLiveJobs(h.env, (async () => {
      throw new Error("uncertain");
    }) as any);
    expect(transport().state).toBe("uncertain");
    makeDue();
    h.env.LIVE_EMAIL_ENABLED = "false";
    const network = vi.fn(async (url: any) =>
      String(url).includes("?maxResults=")
        ? Response.json({ messages: [{ id: "previous-send" }] })
        : Response.json({ id: "previous-send", threadId: "thread" }),
    );
    await runLiveJobs(h.env, network as any);
    expect(transport().state).toBe("confirmed");
    expect(
      network.mock.calls.every((call) => !String(call[0]).includes("/send")),
    ).toBe(true);
  });
});
