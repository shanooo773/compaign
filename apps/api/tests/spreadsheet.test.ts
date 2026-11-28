import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import { beforeEach, afterEach, describe, it, expect, vi } from "vitest";
import readXlsxFile from "read-excel-file/node";
import { spreadsheetDraft } from "../../../shared/spreadsheet";
import { harness } from "./harness";
import { runJobs } from "../src/index";
import { queueFollowups, runLiveJobs } from "../src/automation";
let h: ReturnType<typeof harness>;
const row = {
  name: "Synthetic Professor",
  email: "CONTROLLED@example.com",
  university: "Example U",
  interests: "Robotics research details",
  subject: "Exact inquiry",
  body: "Dear Professor,\nSynthetic test content.",
  scheduled_at: "2099-01-01T12:00:00Z",
  timezone: "Asia/Karachi",
  followup_days: "3",
  followup_subject: "Exact follow-up",
  followup_body: "Thank you for your time.",
};
beforeEach(() => {
  h = harness();
  vi.stubGlobal(
    "fetch",
    vi.fn(() => {
      throw new Error("Network forbidden");
    }),
  );
});
afterEach(() => {
  h.db.close();
  vi.unstubAllGlobals();
});
describe("Excel-to-outbox import", () => {
  it("imports 25 drafts within the D1 Free query budget", async () => {
    const user = await h.user("batch@example.com");
    const prepare = h.env.DB.prepare.bind(h.env.DB);
    let queries = 0;
    h.env.DB.prepare = ((sql: string) => {
      queries++;
      return prepare(sql);
    }) as typeof h.env.DB.prepare;
    const rows = Array.from({ length: 25 }, (_, i) => ({
      ...row,
      email: `controlled-${i}@example.com`,
    }));
    const result = await h.request(
      "/imports/drafts",
      "POST",
      rows,
      user.session,
    );
    expect(result.status).toBe(200);
    expect(await result.json()).toMatchObject({ created: 25, skipped: 0 });
    expect(queries).toBeLessThan(50);
    expect(
      h.db
        .prepare("SELECT amount FROM usage_counters WHERE scope=?")
        .get(`messages:${user.id}`)!.amount,
    ).toBe(25);
  });

  it("reads the actual downloadable XLSX and round-trips every supported field through the real API", async () => {
    const sheet = await readXlsxFile(
      new URL(
        "../../web/public/professors-email-template.xlsx",
        import.meta.url,
      ).pathname.replace(/^\/([A-Z]:)/, "$1"),
    );
    const headers = sheet[0].map(String);
    const data = Object.fromEntries(
      headers.map((header, i) => [header, String(sheet[1][i] ?? "")]),
    );
    const user = await h.user("excel@example.com");
    const response = await h.request(
      "/imports/drafts",
      "POST",
      [data],
      user.session,
    );
    expect(response.status).toBe(200);
    const state = await (
      await h.request("/state", "GET", undefined, user.session)
    ).json();
    expect(state.professors[0]).toMatchObject({
      name: data.name,
      email: data.email,
      university: data.university,
      interests: data.interests,
    });
    expect(state.messages[0]).toMatchObject({
      subject: data.subject,
      body: data.body,
      scheduled_at: "2099-01-01T12:00:00.000Z",
      timezone: data.timezone,
      approved: 0,
      authorized: 0,
      status: "draft",
    });
    expect(JSON.parse(state.messages[0].followup_proposal)).toEqual({
      days: 3,
      subject: data.follow_up_subject || data.followup_subject,
      body: data.follow_up_body || data.followup_body,
    });
    expect(state.automation).toEqual([]);
    expect(state.transports).toEqual([]);
  });
  it("never trusts spreadsheet authorization, even after initial-message batch approval", async () => {
    const user = await h.user("approval@example.com");
    await h.request(
      "/imports/drafts",
      "POST",
      [
        {
          ...row,
          scheduled_at: "2000-01-01T00:00:00Z",
          authorized: "true",
          approved: "true",
          followup_authorized: "true",
          mode: "auto",
        },
      ],
      user.session,
    );
    await runJobs(h.env);
    expect(h.db.prepare("SELECT count(*) n FROM deliveries").get()!.n).toBe(0);
    const message = h.db.prepare("SELECT * FROM messages").get()!;
    expect(message).toMatchObject({
      mode: "manual",
      authorized: 0,
      approved: 0,
      status: "draft",
    });
    await h.request(
      "/messages/approve",
      "POST",
      { ids: [message.id] },
      user.session,
    );
    await runJobs(h.env);
    await runJobs(h.env);
    await queueFollowups(h.env);
    await runLiveJobs(h.env);
    expect(h.db.prepare("SELECT count(*) n FROM deliveries").get()!.n).toBe(1);
    expect(h.db.prepare("SELECT count(*) n FROM automation").get()!.n).toBe(0);
    expect(fetch).not.toHaveBeenCalled();
  });
  it("deduplicates simultaneous and retried imports, including duplicate rows in one workbook", async () => {
    const user = await h.user("retry@example.com");
    const results = await Promise.all([
      h.request("/imports/drafts", "POST", [row, row], user.session),
      h.request("/imports/drafts", "POST", [row], user.session),
    ]);
    expect(results.map((r) => r.status)).toEqual([200, 200]);
    const retry = await (
      await h.request("/imports/drafts", "POST", [row], user.session)
    ).json();
    expect(retry).toMatchObject({ created: 0, skipped: 1 });
    expect(h.db.prepare("SELECT count(*) n FROM messages").get()!.n).toBe(1);
    expect(h.db.prepare("SELECT count(*) n FROM professors").get()!.n).toBe(1);
  });
  it("keeps imports isolated between users", async () => {
    const a = await h.user("a@example.com"),
      b = await h.user("b@example.com");
    for (const user of [a, b])
      expect(
        (await h.request("/imports/drafts", "POST", [row], user.session))
          .status,
      ).toBe(200);
    expect(h.db.prepare("SELECT count(*) n FROM messages").get()!.n).toBe(2);
    const state = await (
      await h.request("/state", "GET", undefined, a.session)
    ).json();
    expect(state.messages).toHaveLength(1);
  });
  it("rolls back professor and draft inserts on storage failure and safely recovers on retry", async () => {
    const user = await h.user("failure@example.com");
    h.db.exec(
      "CREATE TRIGGER synthetic_failure BEFORE INSERT ON messages BEGIN SELECT RAISE(ABORT,'synthetic storage failure'); END;",
    );
    expect(
      (await h.request("/imports/drafts", "POST", [row], user.session)).status,
    ).toBe(500);
    expect(h.db.prepare("SELECT count(*) n FROM professors").get()!.n).toBe(0);
    h.db.exec("DROP TRIGGER synthetic_failure");
    expect(
      (await h.request("/imports/drafts", "POST", [row], user.session)).status,
    ).toBe(200);
    expect(h.db.prepare("SELECT count(*) n FROM messages").get()!.n).toBe(1);
  });
  it.each([
    { followup_days: "0" },
    { followup_days: "61" },
    { followup_days: "3.5" },
    { scheduled_at: "2099-02-30T12:00:00Z" },
    { scheduled_at: "2099-01-01 12:00" },
    { timezone: "invalid/zone" },
    { subject: "Header\nInjection" },
    { email: "invalid" },
  ])("rejects invalid rows atomically: %j", async (patch) => {
    const user = await h.user("invalid@example.com");
    expect(
      (
        await h.request(
          "/imports/drafts",
          "POST",
          [row, { ...row, ...patch }],
          user.session,
        )
      ).status,
    ).toBe(400);
    expect(h.db.prepare("SELECT count(*) n FROM professors").get()!.n).toBe(0);
    expect(h.db.prepare("SELECT count(*) n FROM messages").get()!.n).toBe(0);
  });
  it("supports blank optional follow-up rules and defaults display timezone to Asia/Karachi", () => {
    expect(
      spreadsheetDraft(
        {
          ...row,
          timezone: "",
          followup_days: "",
          followup_subject: "",
          followup_body: "",
        },
        0,
      ),
    ).toMatchObject({
      timezone: "Asia/Karachi",
      email: "controlled@example.com",
    });
    expect(
      spreadsheetDraft(
        { ...row, followup_days: "", followup_subject: "", followup_body: "" },
        0,
      ).followup_proposal,
    ).toBeUndefined();
  });
  it("rejects oversized imports before any writes", async () => {
    const user = await h.user("oversize@example.com");
    expect(
      (
        await h.request(
          "/imports/drafts",
          "POST",
          Array(26).fill(row),
          user.session,
        )
      ).status,
    ).toBe(400);
    expect(h.db.prepare("SELECT count(*) n FROM messages").get()!.n).toBe(0);
  });
});

describe("compatible production migration", () => {
  it("preserves existing follow-up plans and restores reply-cancellation triggers", () => {
    const db = new DatabaseSync(":memory:");
    try {
      for (const name of [
        "0001_initial.sql",
        "0002_storage_integrations.sql",
        "0003_account_security.sql",
      ])
        db.exec(
          readFileSync(
            new URL("../migrations/" + name, import.meta.url),
            "utf8",
          ),
        );
      db.exec(
        "INSERT INTO users(id,email,password) VALUES('u','synthetic@example.com','synthetic-hash'); INSERT INTO professors(id,user_id,name,email) VALUES('p','u','Synthetic','controlled@example.com'); INSERT INTO messages(id,user_id,professor_id,subject,body,mode,status,scheduled_at,timezone) VALUES('m','u','p','s','b','manual','sent','2000-01-01T00:00:00Z','UTC'); INSERT INTO automation VALUES('m',7,'exact subject','exact body',0);",
      );
      db.exec(
        readFileSync(
          new URL(
            "../migrations/0004_spreadsheet_automation.sql",
            import.meta.url,
          ),
          "utf8",
        ),
      );
      expect(db.prepare("SELECT * FROM automation").get()).toMatchObject({
        message_id: "m",
        days: 7,
        subject: "exact subject",
        body: "exact body",
        generated: 0,
      });
      db.exec(
        "UPDATE automation SET days=3; UPDATE messages SET status='replied' WHERE id='m';",
      );
      expect(
        db.prepare("SELECT generated FROM automation").get()!.generated,
      ).toBe(1);
      expect(db.prepare("SELECT password FROM users").get()!.password).toBe(
        "synthetic-hash",
      );
    } finally {
      db.close();
    }
  });
});
