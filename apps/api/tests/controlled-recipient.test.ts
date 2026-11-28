import { beforeEach, afterEach, describe, it, expect, vi } from "vitest";
import { harness } from "./harness";
let h: ReturnType<typeof harness>,
  owner: Awaited<ReturnType<ReturnType<typeof harness>["user"]>>,
  connection: string,
  message: string;
const recipient = "irshad1206896@gmail.com";
const steps = Array.from({ length: 4 }, (_, i) => ({
  subject: `Exact step ${i + 1}`,
  body: `Conditional content ${i + 1}`,
  delay_value: 5,
  delay_unit: "minutes",
  relative_to: "previous",
}));
beforeEach(async () => {
  h = harness();
  owner = await h.user();
  connection = crypto.randomUUID();
  Object.assign(h.env, {
    MOCK_DELIVERY_ENABLED: "false",
    LIVE_EMAIL_ENABLED: "true",
    OAUTH_ENABLED: "true",
    LIVE_OWNER_USER_IDS: owner.id,
    LIVE_TEST_RECIPIENTS: `existing@example.invalid, ${recipient.toUpperCase()} `,
    GMAIL_CLIENT_ID: "synthetic",
    GMAIL_CLIENT_SECRET: "synthetic",
    TOKEN_ENCRYPTION_KEY: btoa(
      String.fromCharCode(...new Uint8Array(32).fill(9)),
    ),
  });
  h.db
    .prepare(
      "INSERT INTO connections(id,user_id,provider,address,subject,scopes,tokens,expires_at) VALUES(?,?,'gmail','sender@example.invalid','synthetic','gmail.send gmail.readonly','unused',?)",
    )
    .run(connection, owner.id, Date.now() + 3600000);
  h.db
    .prepare(
      "INSERT INTO mailbox_checks(connection_id,checked_at,status,detail) VALUES(?,?,'ready','Synthetic')",
    )
    .run(connection, Date.now());
  const imported = await h.request(
    "/imports/drafts",
    "POST",
    {
      import_id: crypto.randomUUID(),
      rows: [
        {
          name: "Controlled recipient",
          email: recipient,
          subject: "Exact initial",
          body: "Initial content",
          scheduled_at: "2099-01-01T12:00:00Z",
          follow_up_sequence: JSON.stringify(steps),
        },
      ],
    },
    owner.session,
  );
  expect(imported.status).toBe(200);
  message = (await imported.json()).drafts[0].id;
  vi.stubGlobal(
    "fetch",
    vi.fn(() => {
      throw Error("All outbound network forbidden");
    }),
  );
});
afterEach(() => {
  h.db.close();
  vi.unstubAllGlobals();
});
const validate = () =>
  h.request(
    "/messages/approve",
    "POST",
    {
      ids: [message],
      sending_account_id: connection, without_attachments_acknowledged: true,
      authorize_followups: true,
      dry_run: true,
    },
    owner.session,
  );
const changes = () => h.db.prepare("SELECT total_changes() n").get()!.n;
describe("controlled recipient approval dry run", () => {
  it("validates one initial plus four five-minute steps without any writes or network", async () => {
    const before = changes();
    const response = await validate();
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      dry_run: true,
      scheduled: 0,
      authorized_followups: 0,
      would_schedule: 1,
      would_authorize_followups: 4,
      total_messages: 5,
      recipients: [
        { address: recipient, controlled_test: true, followup_steps: steps },
      ],
    });
    expect(changes()).toBe(before);
    expect(fetch).not.toHaveBeenCalled();
    expect(
      h.db
        .prepare("SELECT status,approved,live_ready FROM messages WHERE id=?")
        .get(message),
    ).toMatchObject({ status: "draft", approved: 0, live_ready: 0 });
  });
  it("validates external sequences when production mode is explicitly enabled", async () => {
    h.env.LIVE_TEST_RECIPIENTS = "existing@example.invalid";
    h.db
      .prepare(
        "INSERT INTO outreach_settings(user_id,production_enabled,activated_at) VALUES(?,1,?)",
      )
      .run(owner.id, Date.now());
    const before = changes();
    const response = await validate();
    expect(response.status).toBe(200);
    expect((await response.json()).would_authorize_followups).toBe(4);
    expect(changes()).toBe(before);
  });
  it("does not bypass opt-outs for a controlled recipient", async () => {
    h.db
      .prepare(
        "INSERT INTO suppressions(user_id,address,reason) VALUES(?,?,'opt_out')",
      )
      .run(owner.id, recipient);
    const before = changes();
    expect((await validate()).status).toBe(409);
    expect(changes()).toBe(before);
  });
  it("requires reply access and ready Gmail for validation", async () => {
    h.db
      .prepare("UPDATE connections SET scopes='gmail.send' WHERE id=?")
      .run(connection);
    expect((await validate()).status).toBe(409);
    h.db
      .prepare(
        "UPDATE connections SET scopes='gmail.send gmail.readonly' WHERE id=?",
      )
      .run(connection);
    h.db
      .prepare(
        "UPDATE mailbox_checks SET status='failed' WHERE connection_id=?",
      )
      .run(connection);
    expect((await validate()).status).toBe(409);
  });
  it("cannot turn a dry run into a mock approval when mock delivery is enabled", async () => {
    h.env.MOCK_DELIVERY_ENABLED = "true";
    const before = changes();
    const response = await validate();
    expect(response.status).toBe(200);
    expect((await response.json()).dry_run).toBe(true);
    expect(changes()).toBe(before);
  });
});
