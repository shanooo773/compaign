import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import {
  MAX_FOLLOWUPS,
  validateSequence,
} from "../../../shared/followup-sequence";
import {
  normalizeSpreadsheetRow,
  spreadsheetDraft,
} from "../../../shared/spreadsheet";
import { zonedISO } from "../../../shared/timezone";
const base = {
  name: "Synthetic",
  email: "fixture@example.invalid",
  subject: "Initial",
  body: "Exact body",
  scheduled_at: "2099-01-01T12:00:00Z",
};
const step = {
  subject: "Follow-up",
  body: "Exact",
  delay_value: 2,
  delay_unit: "hours",
  relative_to: "previous",
};
describe("Excel sequence validation and schedules", () => {
  it("publishes every supported step in both templates", () => {
    const csv = readFileSync(
      new URL(
        "../../web/public/professors-email-template.csv",
        import.meta.url,
      ),
      "utf8",
    )
      .split(/\r?\n/)[0]
      .split(",");
    for (let n = 1; n <= MAX_FOLLOWUPS; n++)
      for (const key of [
        "subject",
        "body",
        "delay_value",
        "delay_unit",
        "relative_to",
      ])
        expect(csv).toContain(`follow_up_${n}_${key}`);
  });
  it.each([
    ["Asia/Karachi", "2026-11-01T12:30:00.000Z"],
    ["Asia/Seoul", "2026-11-01T08:30:00.000Z"],
    ["UTC", "2026-11-01T17:30:00.000Z"],
  ])("converts Excel wall time using explicit %s", (timezone, expected) => {
    const normalized = normalizeSpreadsheetRow(
      { ...base, timezone, scheduled_at: new Date("2026-11-01T17:30:00Z") },
      0,
    );
    expect(spreadsheetDraft(normalized, 0).scheduled_at).toBe(expected);
    const serial =
      (Date.parse("2026-11-01T17:30:00Z") - Date.UTC(1899, 11, 30)) / 86400000;
    expect(
      spreadsheetDraft({ ...base, timezone, scheduled_at: serial }, 0)
        .scheduled_at,
    ).toBe(expected);
  });
  it("does not shift UTC ISO text for Pakistan or Korea", () => {
    for (const timezone of ["Asia/Karachi", "Asia/Seoul"])
      expect(spreadsheetDraft({ ...base, timezone }, 0).scheduled_at).toBe(
        "2099-01-01T12:00:00.000Z",
      );
    expect(zonedISO("2026-11-01T17:30", "Asia/Seoul")).toBe(
      "2026-11-01T08:30:00.000Z",
    );
  });
  it("rejects zoneless Excel dates, invalid zones and ambiguous/nonexistent local times", () => {
    expect(() =>
      spreadsheetDraft({ ...base, scheduled_at: 46327.5 }, 0),
    ).toThrow(/explicit IANA timezone/);
    for (const [value, timezone] of [
      [new Date("2026-11-01T17:30Z"), "invalid/zone"],
      [new Date("2026-03-08T02:30Z"), "America/New_York"],
      [new Date("2026-11-01T01:30Z"), "America/New_York"],
    ] as const)
      expect(() =>
        spreadsheetDraft({ ...base, timezone, scheduled_at: value }, 0),
      ).toThrow();
  });
  it.each([
    { delay_value: 0 },
    { delay_value: 1.5 },
    { delay_unit: "weeks" },
    { relative_to: "next" },
    { subject: "" },
    { body: "" },
  ])("rejects invalid step %j", (patch) => {
    expect(() => validateSequence([{ ...step, ...patch }])).toThrow(/step 1/);
  });
  it("rejects missing numbered steps and over-limit columns instead of dropping or adding follow-ups", () => {
    expect(() =>
      spreadsheetDraft({ ...base, follow_up_2_subject: "Second" }, 0),
    ).toThrow(/step 1/);
    expect(() =>
      spreadsheetDraft({ ...base, follow_up_11_body: "Unsupported" }, 0),
    ).toThrow(/unsupported follow-up column/);
    expect(() =>
      validateSequence(Array.from({ length: MAX_FOLLOWUPS + 1 }, () => step)),
    ).toThrow(/1-10/);
  });
  it("preserves exact mixed original/previous delay values and enforces a bounded increasing horizon", () => {
    const steps = [
      { ...step, delay_value: 3, delay_unit: "hours", relative_to: "original" },
      {
        ...step,
        delay_value: 17,
        delay_unit: "minutes",
        relative_to: "previous",
      },
      { ...step, delay_value: 2, delay_unit: "days", relative_to: "original" },
    ];
    expect(validateSequence(steps)).toEqual(steps);
    expect(() =>
      validateSequence([{ ...step, delay_value: 61, delay_unit: "days" }]),
    ).toThrow(/60 days/);
    expect(() =>
      validateSequence([
        {
          ...step,
          delay_value: 3,
          delay_unit: "days",
          relative_to: "original",
        },
        {
          ...step,
          delay_value: 2,
          delay_unit: "days",
          relative_to: "original",
        },
      ]),
    ).toThrow(/increase/);
  });
});
it("migrates existing approved steps without changing content, cancellation, due times or authorizations", () => {
  const db = new DatabaseSync(":memory:");
  try {
    for (const name of readdirSync(new URL("../migrations/", import.meta.url))
      .filter((n) => n.endsWith(".sql") && n < "0011")
      .sort())
      db.exec(
        readFileSync(new URL("../migrations/" + name, import.meta.url), "utf8"),
      );
    db.exec(
      "INSERT INTO users(id,email,password) VALUES('u','old@example.invalid','retained'); INSERT INTO professors(id,user_id,name,email) VALUES('p','u','Old','old-recipient@example.invalid'); INSERT INTO messages(id,user_id,professor_id,subject,body,mode,status,scheduled_at,timezone) VALUES('root','u','p','Initial','Original','manual','sent','2026-01-01T00:00:00Z','UTC');",
    );
    const steps = Array.from({ length: 5 }, () => step),
      snapshot = JSON.stringify({ followup: { steps } });
    db.prepare(
      "INSERT INTO message_authorizations(message_id,user_id,campaign_id,snapshot,authorized_at,followup_authorized) VALUES('root','u','old',?,123,1)",
    ).run(snapshot);
    for (let n = 1; n <= 5; n++)
      db.prepare(
        "INSERT INTO followup_steps(root_id,step,child_id,subject,body,delay_value,delay_unit,relative_to,authorized_at,due_at,queued,cancel_reason) VALUES('root',?,?,'Follow-up','Exact',2,'hours','previous',123,456,0,?)",
      ).run(n, "child" + n, n === 5 ? "manual" : null);
    const before = db
        .prepare("SELECT * FROM followup_steps ORDER BY step")
        .all(),
      auth = db.prepare("SELECT * FROM message_authorizations").all();
    db.exec(
      readFileSync(
        new URL(
          "../migrations/0011_excel_followup_capacity.sql",
          import.meta.url,
        ),
        "utf8",
      ),
    );
    expect(
      db
        .prepare("SELECT * FROM followup_steps ORDER BY step")
        .all()
        .map(({ next_check_at, ...row }) => row),
    ).toEqual(before);
    expect(db.prepare("SELECT * FROM message_authorizations").all()).toEqual(
      auth,
    );
    expect(() => db.exec("UPDATE followup_steps SET delay_value=7")).toThrow(
      /immutable/,
    );
    expect(() =>
      db.exec("UPDATE followup_steps SET cancel_reason=NULL WHERE step=5"),
    ).toThrow(/rearmed/);
    expect(() =>
      db.exec(
        "INSERT INTO followup_steps(root_id,step,child_id,subject,body,delay_value,delay_unit,relative_to,authorized_at) VALUES('root',10,'unapproved','Wrong','Wrong',1,'days','previous',123)",
      ),
    ).toThrow(/authorization/);
    db.exec("UPDATE messages SET status='replied' WHERE id='root'");
    expect(
      db
        .prepare(
          "SELECT count(*) n FROM followup_steps WHERE cancel_reason IS NOT NULL",
        )
        .get()!.n,
    ).toBe(5);
    expect(db.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
    expect(db.prepare("PRAGMA integrity_check").get()!.integrity_check).toBe(
      "ok",
    );
  } finally {
    db.close();
  }
});

it.each([1900, 1904])(
  "reads actual Excel date cells from the %s workbook date system",
  async (system) => {
    const readXlsxFile = (await import("read-excel-file/node")).default;
    const sheet = await readXlsxFile(
      new URL(
        "./fixtures/scheduled-date-" + system + ".xlsx",
        import.meta.url,
      ).pathname.replace(/^\/([A-Z]:)/, "$1"),
    );
    const headers = sheet[0].map(String),
      row = Object.fromEntries(
        headers.map((header, i) => [header, sheet[1][i]]),
      );
    expect(row.scheduled_at).toBeInstanceOf(Date);
    expect(spreadsheetDraft(row, 0).scheduled_at).toBe(
      "2026-11-01T12:30:00.000Z",
    );
  },
);

it("uses the scheduled event timestamp to preserve scheduler phases after Worker delivery delays", async () => {
  const { harness } = await import("./harness"),
    worker = (await import("../src/index")).default;
  const h = harness();
  const { vi } = await import("vitest");
  const clock = vi.spyOn(Date, "now").mockReturnValue(120000);
  try {
    Object.assign(h.env, {
      OAUTH_ENABLED: "true",
      TOKEN_ENCRYPTION_KEY: "unused",
      MOCK_DELIVERY_ENABLED: "false",
    });
    const queries: string[] = [],
      prepare = h.env.DB.prepare.bind(h.env.DB);
    h.env.DB.prepare = ((sql: string) => {
      queries.push(sql);
      return prepare(sql);
    }) as any;
    await worker.scheduled(
      { scheduledTime: 60000, cron: "* * * * *" } as ScheduledEvent,
      h.env,
    );
    expect(
      queries.some((sql) =>
        sql.includes("UPDATE transports SET state='uncertain'"),
      ),
    ).toBe(true);
    expect(
      queries.some((sql) => sql.includes("DELETE FROM oauth_states")),
    ).toBe(false);
    expect(
      h.db.prepare("SELECT failure FROM scheduler_health").get()!.failure,
    ).toBeNull();
  } finally {
    clock.mockRestore();
    h.db.close();
  }
});

it("preserves pre-upgrade accounts, documents, approvals and legacy automation while widening only new capacity", () => {
  const db = new DatabaseSync(":memory:");
  try {
    for (const name of readdirSync(new URL("../migrations/", import.meta.url))
      .filter((n) => n.endsWith(".sql") && n < "0012")
      .sort())
      db.exec(
        readFileSync(new URL("../migrations/" + name, import.meta.url), "utf8"),
      );
    db.exec(
      "INSERT INTO users(id,email,password) VALUES('old-u','old-u@example.invalid','unchanged-hash'); INSERT INTO professors(id,user_id,name,email) VALUES('old-p','old-u','Old Professor','old-p@example.invalid'); INSERT INTO messages(id,user_id,professor_id,subject,body,mode,status,scheduled_at,timezone) VALUES('old-root','old-u','old-p','Exact subject','Exact body','manual','draft','2000-01-01T00:00:00Z','UTC'); INSERT INTO automation(message_id,days,subject,body,generated,due_at) VALUES('old-root',30,'Exact follow-up','Exact follow-up body',0,123456); INSERT INTO documents(id,user_id,name,object_key,content_type,size,storage_backend,storage_state,checksum,expires_at) VALUES('old-doc','old-u','cv.txt','private-key','text/plain',3,'kv','ready','checksum',9999999999999);",
    );
    const selection = JSON.stringify([
      {
        id: "old-root",
        snapshot: {
          recipient: "old-p@example.invalid",
          subject: "Exact subject",
          body: "Exact body",
        },
        scheduled_at: "2000-01-01T00:00:00Z",
        timezone: "UTC",
      },
    ]);
    db.prepare(
      "INSERT INTO campaign_approvals(id,user_id,approved_at,initial_count,followup_count,sending_account_id,selection) VALUES('old-campaign','old-u',123,1,1,'old-connection',?)",
    ).run(selection);
    db.prepare(
      "INSERT INTO message_authorizations(message_id,user_id,campaign_id,snapshot,authorized_at,followup_authorized) VALUES('old-root','old-u','old-campaign',?,123,1)",
    ).run(
      JSON.stringify({
        initial: {
          recipient: "old-p@example.invalid",
          attachments: [
            {
              id: "old-doc",
              checksum: "checksum",
              size: 3,
              name: "cv.txt",
              content_type: "text/plain",
            },
          ],
        },
        followup: {
          days: 30,
          subject: "Exact follow-up",
          body: "Exact follow-up body",
        },
      }),
    );
    db.exec(
      "UPDATE messages SET status='pending',approved=1 WHERE id='old-root'",
    );
    const tables = [
      "users",
      "messages",
      "automation",
      "message_authorizations",
      "campaign_approvals",
    ];
    const before = tables.map((table) =>
        db.prepare("SELECT * FROM " + table).all(),
      ),
      docs = db.prepare("SELECT * FROM documents").all();
    db.exec(
      readFileSync(
        new URL(
          "../migrations/0012_campaign_attachments_horizon.sql",
          import.meta.url,
        ),
        "utf8",
      ),
    );
    expect(
      tables.map((table) => db.prepare("SELECT * FROM " + table).all()),
    ).toEqual(before);
    expect(
      db
        .prepare("SELECT * FROM documents")
        .all()
        .map(({ retained_until, ...row }) => row),
    ).toEqual(docs);
    expect(() =>
      db.exec("UPDATE automation SET days=60 WHERE message_id='old-root'"),
    ).toThrow(/immutable/);
    expect(
      db.prepare("SELECT count(*) n FROM campaign_attachment_pins").get()!.n,
    ).toBe(1);
    db.exec(
      "INSERT INTO documents(id,user_id,name,object_key,content_type,size,checksum,storage_backend,storage_state) VALUES('unapproved-doc','old-u','other.txt','other-key','text/plain',3,'checksum','kv','ready')",
    );
    expect(() =>
      db.exec(
        "INSERT INTO campaign_attachment_pins VALUES('old-root','unapproved-doc','old-u',9999999999999)",
      ),
    ).toThrow(/Exact approved attachment/);
    db.exec(
      "INSERT INTO messages(id,user_id,professor_id,subject,body,mode,status,scheduled_at,timezone) VALUES('new-root','old-u','old-p','New','New','manual','draft','2000-01-01T00:00:00Z','UTC'); INSERT INTO automation(message_id,days,subject,body) VALUES('new-root',60,'New follow-up','New body');",
    );
    expect(() =>
      db.exec("UPDATE automation SET days=61 WHERE message_id='new-root'"),
    ).toThrow(/CHECK/);
    expect(db.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
    expect(db.prepare("PRAGMA integrity_check").get()!.integrity_check).toBe(
      "ok",
    );
  } finally {
    db.close();
  }
});
