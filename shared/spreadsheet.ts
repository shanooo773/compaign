import { spreadsheetSchedule } from "./spreadsheet-schedule";
import {
  MAX_FOLLOWUPS,
  MAX_SEQUENCE_DAYS,
  validateSequence,
  type FollowupStep,
} from "./followup-sequence";
// Authoritative import metadata, shared by parsing, previews and generated templates.
export const spreadsheetBaseColumns = [
  "name",
  "email",
  "university",
  "interests",
  "subject",
  "body",
  "scheduled_at",
  "timezone",
];
export const spreadsheetStepFields = [
  "subject",
  "body",
  "delay_value",
  "delay_unit",
  "relative_to",
];
export const spreadsheetColumns = [
  ...spreadsheetBaseColumns,
  ...Array.from({ length: MAX_FOLLOWUPS }, (_, i) =>
    spreadsheetStepFields.map((field) => `follow_up_${i + 1}_${field}`),
  ).flat(),
];
export type FollowupProposal = {
  days: number;
  subject: string;
  body: string;
  steps?: FollowupStep[];
};
export type SpreadsheetDraft = {
  name: string;
  email: string;
  university: string;
  interests: string;
  subject: string;
  body: string;
  scheduled_at: string;
  timezone: string;
  followup_proposal?: FollowupProposal;
  followup_issue?: string;
  followup_draft?: { days?: number; subject: string; body: string };
};

// Normalize only scalar spreadsheet cells; never coerce objects into email content.
export function normalizeSpreadsheetRow(
  row: Record<string, unknown>,
  index: number,
): Record<string, string> {
  return Object.fromEntries(
    Object.entries(row).map(([key, value]) => {
      if (value == null) return [key, ""];
      if (key === "scheduled_at") {
        try {
          return [key, spreadsheetSchedule(value, row.timezone)];
        } catch (error) {
          throw new Error(`Row ${index + 2}: ${(error as Error).message}`);
        }
      }
      if (typeof value === "string") return [key, value];
      if (typeof value === "number" && Number.isFinite(value))
        return [key, String(value)];
      throw new Error(
        `Row ${index + 2}: ${key} must be text or a finite number.`,
      );
    }),
  );
}

export function spreadsheetDraft(
  row: Record<string, unknown>,
  index: number,
  allowIncompleteFollowup = false,
): SpreadsheetDraft {
  const fail = (message: string): never => {
    throw new Error(`Row ${index + 2}: ${message}`);
  };
  const cells = normalizeSpreadsheetRow(row, index);
  for (const field of ["days", "subject", "body"]) {
    const oldValue = cells["followup_" + field],
      newValue = cells["follow_up_" + field];
    if (oldValue && newValue && oldValue !== newValue)
      fail("conflicting followup_ and follow_up_ columns: " + field);
    cells["followup_" + field] = newValue || oldValue || "";
  }
  const subject = cells.subject || "",
    body = cells.body || "";
  if (
    !subject.trim() ||
    subject.length > 500 ||
    /[\r\n]/.test(subject) ||
    !body.trim() ||
    body.length > 20000
  )
    fail(
      "provide subject (up to 500 characters) and body (up to 20000 characters).",
    );
  const date = cells.scheduled_at || "";
  // Date cells were converted using the explicit row timezone; ISO text stays UTC.
  if (
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(date) ||
    !Number.isFinite(Date.parse(date))
  )
    fail(
      "scheduled_at must be a UTC ISO text timestamp, e.g. 2099-01-01T12:00:00Z.",
    );
  if (new Date(date).toISOString().slice(0, 19) !== date.slice(0, 19))
    fail("invalid calendar date.");
  const timezone = cells.timezone?.trim() || "Asia/Karachi";
  try {
    new Intl.DateTimeFormat("en", { timeZone: timezone });
  } catch {
    fail("invalid IANA timezone.");
  }
  let followup_proposal: FollowupProposal | undefined;
  let followup_issue: string | undefined,
    followup_draft: SpreadsheetDraft["followup_draft"];
  if (
    (cells.followup_days || cells.followup_subject || cells.followup_body) &&
    !cells.follow_up_delay_value &&
    !cells.follow_up_sequence &&
    !cells.follow_up_1_delay_value
  ) {
    const days = Number(cells.followup_days),
      subject = cells.followup_subject || "",
      body = cells.followup_body || "";
    if (
      (cells.followup_days &&
        (!Number.isInteger(days) || days < 1 || days > MAX_SEQUENCE_DAYS)) ||
      subject.length > 500 ||
      /[\r\n]/.test(subject) ||
      body.length > 20000
    )
      fail(
        "follow-up requires an integer delay of 1-60 days, a single-line subject and a body up to 20000 characters.",
      );
    if (!cells.followup_days || !subject || !body) {
      followup_issue =
        "Missing follow-up " +
        [
          !cells.followup_days ? "delay" : "",
          !subject ? "subject" : "",
          !body ? "body" : "",
        ]
          .filter(Boolean)
          .join(", ") +
        "; automatic follow-up cannot be authorized.";
      if (!allowIncompleteFollowup) fail(followup_issue);
      followup_draft = {
        ...(cells.followup_days ? { days } : {}),
        subject,
        body,
      };
    } else followup_proposal = { days, subject, body };
  }
  for (const [key, value] of Object.entries(cells)) {
    const match =
      /^follow_up_(\d+)_(subject|body|delay_value|delay_unit|relative_to)$/.exec(
        key,
      );
    if (value && match && (+match[1] < 1 || +match[1] > MAX_FOLLOWUPS))
      fail(
        `unsupported follow-up column ${key}; supported steps are 1-${MAX_FOLLOWUPS}.`,
      );
  }
  const numbered = Array.from({ length: MAX_FOLLOWUPS }, (_, index) => {
    const prefix = `follow_up_${index + 1}_`;
    if (!spreadsheetStepFields.some((field) => cells[prefix + field]))
      return null;
    return {
      subject: cells[prefix + "subject"],
      body: cells[prefix + "body"],
      delay_value: Number(cells[prefix + "delay_value"]),
      delay_unit: cells[prefix + "delay_unit"],
      relative_to: cells[prefix + "relative_to"],
    };
  });
  let configured: unknown = null;
  if (cells.follow_up_sequence) {
    if (numbered.some(Boolean))
      fail("use either follow_up_sequence JSON or numbered step columns.");
    try {
      configured = JSON.parse(cells.follow_up_sequence);
    } catch {
      fail("invalid follow_up_sequence JSON.");
    }
  } else if (numbered.some(Boolean)) {
    const last = numbered.reduce(
      (last, step, index) => (step ? index : last),
      -1,
    );
    configured = numbered.slice(0, last + 1);
  } else if (
    cells.follow_up_delay_value ||
    cells.follow_up_delay_unit ||
    cells.follow_up_relative_to
  ) {
    configured = [
      {
        subject: cells.followup_subject,
        body: cells.followup_body,
        delay_value: Number(cells.follow_up_delay_value),
        delay_unit: cells.follow_up_delay_unit,
        relative_to: cells.follow_up_relative_to || "original",
      },
    ];
  }
  if (configured || cells.follow_up_sequence) {
    if (cells.followup_days)
      fail("legacy day delay conflicts with sequence timing.");
    if (
      (cells.follow_up_sequence || numbered.some(Boolean)) &&
      (cells.followup_subject || cells.followup_body)
    )
      fail("legacy follow-up content conflicts with sequence content.");
    let steps: FollowupStep[];
    try {
      steps = validateSequence(configured);
    } catch (error) {
      return fail((error as Error).message);
    }
    followup_proposal = {
      days: 1,
      subject: steps[0].subject,
      body: steps[0].body,
      steps,
    };
    followup_issue = undefined;
    followup_draft = undefined;
  }
  // Spreadsheet authorization flags are never accepted.
  return {
    name: cells.name?.trim() || "",
    email: cells.email?.trim().toLowerCase() || "",
    university: cells.university?.trim() || "",
    interests: cells.interests?.trim() || "",
    subject,
    body,
    scheduled_at: new Date(date).toISOString(),
    timezone,
    ...(followup_proposal ? { followup_proposal } : {}),
    ...(followup_issue ? { followup_issue, followup_draft } : {}),
  };
}
