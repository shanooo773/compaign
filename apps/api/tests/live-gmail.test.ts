import { beforeEach, afterEach, describe, it, expect, vi } from "vitest";
import { harness } from "./harness";
import { encrypt } from "../src/oauth";
import {
  runLiveJobs,
  queueFollowups,
  syncReplies,
  transportSnapshot,
} from "../src/automation";
import { runJobs } from "../src/index";
import { checkGmail } from "../src/live-controls";
let h: ReturnType<typeof harness>,
  owner: Awaited<ReturnType<ReturnType<typeof harness>["user"]>>,
  connection: string;
const recipient = "controlled@example.com";
const row = {
  name: "Controlled recipient",
  email: recipient,
  university: "Test only",
  interests: "Synthetic",
  subject: "Exact Gmail test",
  body: "Only approved test content",
  scheduled_at: "2000-01-01T00:00:00Z",
  timezone: "Asia/Karachi",
  followup_days: "3",
  followup_subject: "Exact reminder",
  followup_body: "Exact approved follow-up",
};
beforeEach(async () => {
  h = harness();
  owner = await h.user("owner@example.com");
  connection = crypto.randomUUID();
  Object.assign(h.env, {
    OAUTH_ENABLED: "true",
    LIVE_EMAIL_ENABLED: "true",
    MOCK_DELIVERY_ENABLED: "false",
    LIVE_OWNER_USER_IDS: owner.id,
    LIVE_TEST_RECIPIENTS: recipient + ",second@example.com",
    GMAIL_CLIENT_ID: "synthetic-client",
    GMAIL_CLIENT_SECRET: "synthetic-secret",
    TOKEN_ENCRYPTION_KEY: btoa(
      String.fromCharCode(...new Uint8Array(32).fill(9)),
    ),
  });
  const tokens = await encrypt(h.env, owner.id + ":gmail:tokens:v1", {
    access_token: "synthetic-access",
    refresh_token: "synthetic-refresh",
    expires_in: 3600,
  });
  h.db
    .prepare(
      "INSERT INTO connections(id,user_id,provider,address,subject,scopes,tokens,expires_at) VALUES(?,?,'gmail','sender@example.com','synthetic-google-subject',?,?,?)",
    )
    .run(
      connection,
      owner.id,
      "https://www.googleapis.com/auth/gmail.send https://www.googleapis.com/auth/gmail.readonly",
      tokens,
      Date.now() + 3600000,
    );
  h.db
    .prepare(
      "INSERT INTO mailbox_checks(connection_id,checked_at,status,detail) VALUES(?,?,'ready','Synthetic provider fixture')",
    )
    .run(connection, Date.now());
  vi.stubGlobal(
    "fetch",
    vi.fn(() => {
      throw new Error("External network forbidden");
    }),
  );
});
afterEach(() => {
  h.db.close();
  vi.unstubAllGlobals();
});
async function importRows(rows = [row]) {
  const r = await h.request("/imports/drafts", "POST", rows, owner.session);
  expect(r.status).toBe(200);
  return h.db.prepare("SELECT * FROM messages ORDER BY rowid").all() as any[];
}
async function approve(ids: string[], followups = false) {
  const review=await (await h.request("/campaigns/duplicate-check","POST",{ids},owner.session)).json();
  return h.request(
    "/messages/approve",
    "POST",
    { ids, sending_account_id: connection, without_attachments_acknowledged: true, authorize_followups: followups, duplicate_acknowledgement:review.acknowledgement },
    owner.session,
  );
}
const send = () =>
  vi.fn(async () =>
    Response.json({ id: "gmail-accepted", threadId: "gmail-thread" }),
  );
describe("real Gmail production workflow", () => {
  it("blocks message approval when read-only Gmail readiness fails", async () => {
    const [draft] = await importRows();
    h.db.prepare("UPDATE mailbox_checks SET status='failed'").run();
    expect((await approve([draft.id])).status).toBe(409);
    expect(h.db.prepare("SELECT count(*) n FROM transports").get()!.n).toBe(0);
  });

  it("reports only a safe provider reason when Gmail API is disabled", async () => {
    const network = vi.fn(async () =>
      Response.json(
        {
          error: {
            code: 403,
            details: [
              {
                reason: "SERVICE_DISABLED",
                metadata: { secret: "never persisted" },
              },
            ],
          },
        },
        { status: 403 },
      ),
    );
    await checkGmail(h.env, network as any, owner.id);
    const check = h.db
      .prepare("SELECT status,detail FROM mailbox_checks")
      .get()!;
    expect(check.status).toBe("failed");
    expect(check.detail).toContain("SERVICE_DISABLED");
    expect(check.detail).not.toContain("never persisted");
  });

  it("permits a genuinely new campaign with identical content while rejecting repeated approval of its messages", async () => {
    const [draft] = await importRows();
    expect((await approve([draft.id])).status).toBe(200);
    const duplicate = crypto.randomUUID();
    h.db
      .prepare(
        "INSERT INTO messages(id,user_id,professor_id,subject,body,mode,scheduled_at,timezone,approved_recipient) SELECT ?,user_id,professor_id,subject,body,'manual',scheduled_at,timezone,approved_recipient FROM messages WHERE id=?",
      )
      .run(duplicate, draft.id);
    expect((await approve([duplicate])).status).toBe(200);
    expect((await approve([duplicate])).status).toBe(409);
    expect(h.db.prepare("SELECT count(*) n FROM transports").get()!.n).toBe(2);
  });
  it("does not revive historically authorized follow-ups when live delivery is enabled", async () => {
    const [draft] = await importRows();
    await approve([draft.id], true);
    await runLiveJobs(h.env, send() as any);
    h.db
      .prepare("UPDATE messages SET live_ready=0,sent_at=?")
      .run(new Date(Date.now() - 4 * 86400000).toISOString());
    h.db
      .prepare("UPDATE transports SET sync_checked_at=?,next_sync=0")
      .run(Date.now());
    await queueFollowups(h.env);
    expect(
      h.db
        .prepare("SELECT count(*) n FROM messages WHERE parent_id IS NOT NULL")
        .get()!.n,
    ).toBe(0);
  });

  it("cannot send imports before approval, then accepts only the selected exact message through Gmail", async () => {
    const drafts = await importRows([
      row,
      { ...row, email: "second@example.com", subject: "Second" },
    ]);
    const network = send();
    await runJobs(h.env);
    await runLiveJobs(h.env, network as any);
    expect(network).not.toHaveBeenCalled();
    expect((await approve([drafts[0].id])).status).toBe(200);
    await Promise.all([
      runLiveJobs(h.env, network as any),
      runLiveJobs(h.env, network as any),
    ]);
    expect(network).toHaveBeenCalledTimes(1);
    expect((network.mock.calls[0] as any)[0]).toContain(
      "gmail.googleapis.com/gmail/v1/users/me/messages/send",
    );
    expect(
      h.db.prepare("SELECT status FROM messages WHERE id=?").get(drafts[0].id)!
        .status,
    ).toBe("sent");
    expect(
      h.db
        .prepare("SELECT status,approved FROM messages WHERE id=?")
        .get(drafts[1].id),
    ).toMatchObject({ status: "draft", approved: 0 });
    expect(
      h.db.prepare("SELECT provider_id,state FROM transports").get(),
    ).toMatchObject({ provider_id: "gmail-accepted", state: "confirmed" });
    expect(
      h.db.prepare("SELECT outcome FROM delivery_attempts").get()!.outcome,
    ).toBe("accepted");
  });
  it("prevents replay of historical approved live rows and mock rows until fresh approval", async () => {
    const [draft] = await importRows();
    const snapshot = await transportSnapshot(
      h.env,
      owner.id,
      connection,
      recipient,
      draft.subject,
      draft.body,
      [],
      draft.id,
    );
    h.db
      .prepare(
        "INSERT INTO transports(message_id,user_id,connection_id,snapshot) VALUES(?,?,?,?)",
      )
      .run(draft.id, owner.id, connection, JSON.stringify(snapshot));
    h.db
      .prepare("UPDATE messages SET status='pending',approved=1,live_ready=0")
      .run();
    const network = send();
    await runJobs(h.env);
    await runLiveJobs(h.env, network as any);
    expect(network).not.toHaveBeenCalled();
    expect((await approve([draft.id])).status).toBe(200);
    await runLiveJobs(h.env, network as any);
    expect(network).toHaveBeenCalledTimes(1);
  });
  it("freezes imported recipients against later professor edits", async () => {
    const [draft] = await importRows();
    h.db.prepare("UPDATE professors SET email='unapproved@example.com'").run();
    expect((await approve([draft.id])).status).toBe(200);
    const snapshot = JSON.parse(
      String(h.db.prepare("SELECT snapshot FROM transports").get()!.snapshot),
    );
    expect(snapshot.recipient).toBe(recipient);
  });
  it("rejects an entire batch containing a recipient outside controlled testing", async () => {
    const drafts = await importRows([
      row,
      { ...row, email: "professor@example.edu" },
    ]);
    expect((await approve(drafts.map((d) => d.id))).status).toBe(403);
    expect(
      h.db.prepare("SELECT count(*) n FROM messages WHERE approved=1").get()!.n,
    ).toBe(0);
  });
  it("requires exact explicit follow-up authorization separately from initial-message approval", async () => {
    const [draft] = await importRows();
    expect((await approve([draft.id])).status).toBe(200);
    expect(h.db.prepare("SELECT count(*) n FROM automation").get()!.n).toBe(0);
    const drafts = await importRows([{ ...row, email: "second@example.com" }]);
    const second = drafts.find((d) => d.id !== draft.id)!;
    expect((await approve([second.id], true)).status).toBe(200);
    expect(
      h.db.prepare("SELECT days,subject,body FROM automation").get(),
    ).toMatchObject({
      days: 3,
      subject: row.followup_subject,
      body: row.followup_body,
    });
  });
  it("requires a connected Gmail send scope and read access for authorized follow-ups", async () => {
    const [draft] = await importRows();
    h.db
      .prepare(
        "UPDATE connections SET scopes='https://www.googleapis.com/auth/gmail.send'",
      )
      .run();
    expect((await approve([draft.id], true)).status).toBe(409);
    h.db
      .prepare(
        "UPDATE connections SET scopes='https://www.googleapis.com/auth/gmail.readonly'",
      )
      .run();
    expect((await approve([draft.id])).status).toBe(409);
  });
  it("retains uncertain outcomes without allowing manual duplicate retries", async () => {
    const [draft] = await importRows();
    await approve([draft.id]);
    await runLiveJobs(h.env, (async () => {
      throw new Error("network timeout");
    }) as any);
    expect(h.db.prepare("SELECT state FROM transports").get()!.state).toBe(
      "uncertain",
    );
    expect(
      (
        await h.request(
          `/messages/${draft.id}/retry`,
          "POST",
          { confirmed: true },
          owner.session,
        )
      ).status,
    ).toBe(409);
    expect(
      h.db.prepare("SELECT outcome FROM delivery_attempts").get()!.outcome,
    ).toBe("uncertain");
  });
  it("allows an explicit safe retry of a proven rejected send, retaining attempt history", async () => {
    const [draft] = await importRows();
    await approve([draft.id]);
    await runLiveJobs(
      h.env,
      (async () => new Response(null, { status: 400 })) as any,
    );
    expect(h.db.prepare("SELECT status FROM messages").get()!.status).toBe(
      "failed",
    );
    expect(
      (
        await h.request(
          `/messages/${draft.id}/retry`,
          "POST",
          { confirmed: true },
          owner.session,
        )
      ).status,
    ).toBe(200);
    h.db
      .prepare("UPDATE delivery_attempts SET started_at=started_at-61000")
      .run();
    h.db.exec("DELETE FROM usage_counters WHERE scope LIKE 'send:%:minute'");
    const network = send();
    await runLiveJobs(h.env, network as any);
    expect(network).toHaveBeenCalledTimes(1);
    expect(
      h.db.prepare("SELECT count(*) n FROM delivery_attempts").get()!.n,
    ).toBe(2);
  });
  it("does not mark a provider failure as sent", async () => {
    const [draft] = await importRows();
    await approve([draft.id]);
    await runLiveJobs(
      h.env,
      (async () => new Response(null, { status: 400 })) as any,
    );
    expect(h.db.prepare("SELECT status FROM messages").get()!.status).toBe(
      "failed",
    );
    expect(h.db.prepare("SELECT count(*) n FROM deliveries").get()!.n).toBe(0);
  });
  it("disables production simulation endpoints and mock dispatch", async () => {
    const [draft] = await importRows();
    expect(
      (await h.request("/jobs/run", "POST", {}, owner.session)).status,
    ).toBe(404);
    expect(
      (
        await h.request(
          `/messages/${draft.id}/simulate-failure`,
          "POST",
          {},
          owner.session,
        )
      ).status,
    ).toBe(404);
    h.db.prepare("UPDATE messages SET status='pending',approved=1").run();
    await runJobs(h.env);
    expect(h.db.prepare("SELECT count(*) n FROM deliveries").get()!.n).toBe(0);
  });
  it("does not permit another application user to use the owner's live capability", async () => {
    const other = await h.user("other@example.com");
    const state = await (
      await h.request("/state", "GET", undefined, other.session)
    ).json();
    expect(state.capabilities.live_email).toBe(false);
    expect(
      (
        await h.request(
          "/outreach/mode",
          "POST",
          { production_enabled: true, confirmed: true },
          other.session,
        )
      ).status,
    ).toBe(403);
  });
  it("requires both controlled deliveries and a detected reply, then only the owner can activate professor outreach", async () => {
    const activate = () =>
      h.request(
        "/outreach/mode",
        "POST",
        { production_enabled: true, confirmed: true },
        owner.session,
      );
    expect((await activate()).status).toBe(409);
    const drafts = await importRows([
      row,
      { ...row, email: "second@example.com", subject: "Second" },
    ]);
    await approve(drafts.map((d) => d.id));
    for (let i = 0; i < 2; i++) {
      h.db.exec("DELETE FROM usage_counters WHERE scope LIKE 'send:%:minute'");
      h.db
        .prepare("UPDATE delivery_attempts SET started_at=started_at-61000")
        .run();
      await runLiveJobs(h.env, (async () =>
        Response.json({
          id: "accepted-" + i,
          threadId: "thread-" + i,
        })) as any);
    }
    expect((await activate()).status).toBe(409);
    h.db.prepare("UPDATE messages SET sent_at='2000-01-01T00:00:00Z'").run();
    h.db.prepare("UPDATE transports SET next_sync=0").run();
    // Use a current sent_at within the bounded polling window.
    h.db
      .prepare("UPDATE messages SET sent_at=?")
      .run(new Date(Date.now() - 3600000).toISOString());
    await syncReplies(
      h.env,
      (async () =>
        Response.json({
          messages: [
            {
              id: "test-reply",
              internalDate: String(Date.now() - 1000),
              snippet: "Test received, thank you",
              payload: { headers: [{ name: "From", value: recipient }] },
            },
          ],
        })) as any,
      owner.id,
    );
    expect((await activate()).status).toBe(200);
    const all = await importRows([
      {
        ...row,
        email: "professor@example.edu",
        subject: "Separately approved professor",
      },
    ]);
    expect((await approve([all.at(-1).id])).status).toBe(200);
    expect(h.db.prepare("SELECT count(*) n FROM deliveries").get()!.n).toBe(2); // Activating or approving does not itself send.
  });
  it("verifies encrypted token refresh and Gmail identity using read-only provider calls", async () => {
    h.db.prepare("UPDATE connections SET expires_at=0").run();
    const network = vi.fn(async (url: string) =>
      url.includes("oauth2.googleapis.com")
        ? Response.json({
            access_token: "refreshed-synthetic",
            expires_in: 3600,
          })
        : Response.json({ emailAddress: "sender@example.com" }),
    );
    await checkGmail(h.env, network as any, owner.id);
    expect(network).toHaveBeenCalledTimes(2);
    expect(
      h.db.prepare("SELECT status FROM mailbox_checks").get()!.status,
    ).toBe("ready");
    expect(
      network.mock.calls.every(([url]) => !url.includes("/messages/send")),
    ).toBe(true);
  });
});
