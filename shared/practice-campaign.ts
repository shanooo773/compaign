import { spreadsheetDraft } from "./spreadsheet";
import {
  delayMilliseconds,
  validateSequence,
  type FollowupStep,
} from "./followup-sequence";

// No transport, API client, credentials or real IDs are available to this module.
export function practiceRows(now = Date.now()) {
  return ["Amina Noor", "Daniel Reed"].map((name, index) => ({
    name,
    email: `professor${index + 1}@example.com`,
    university: "Example Research University",
    interests: index ? "embedded systems" : "computer vision",
    subject: `MS research enquiry - ${index ? "embedded systems" : "computer vision"}`,
    body: `Dear Professor ${name}, I am a fictional student practising academic outreach. My sample project concerns ${index ? "embedded systems" : "computer vision"}. May I ask about potential research supervision? Thank you, Example Student.`,
    scheduled_at: new Date(now + 86400000).toISOString(),
    timezone: "Asia/Karachi",
    follow_up_1_subject: "Following up on my research enquiry",
    follow_up_1_body:
      "Dear Professor, I am following up on my earlier enquiry. Thank you for your time. Example Student.",
    follow_up_1_delay_value: "7",
    follow_up_1_delay_unit: "days",
    follow_up_1_relative_to: "original",
  }));
}
export function practiceCSV(now = Date.now()) {
  const rows = practiceRows(now),
    keys = Object.keys(rows[0]) as (keyof (typeof rows)[0])[];
  const quote = (value: string) => '"' + value.replaceAll('"', '""') + '"';
  return [
    keys.join(","),
    ...rows.map((row) => keys.map((key) => quote(row[key])).join(",")),
  ].join("\r\n");
}
export function validatePracticeRows(rows: Record<string, unknown>[]) {
  if (!rows.length || rows.length > 25)
    throw new Error("Use 1-25 fictional campaign rows.");
  const seen = new Set<string>();
  return rows.map((row, index) => {
    const draft = spreadsheetDraft(row, index);
    if (!draft.name || !/^[^\s@]+@example\.(com|org|net)$/.test(draft.email))
      throw new Error(
        `Row ${index + 2}: practice requires a name and a reserved example.com, example.org or example.net address.`,
      );
    if (seen.has(draft.email))
      throw new Error("Remove duplicate practice addresses.");
    seen.add(draft.email);
    return draft;
  });
}
export type PracticeJob = {
  id: string;
  recipient: string;
  subject: string;
  body: string;
  at: number;
  kind: "initial" | "followup";
  attachment: boolean;
  status: "scheduled" | "sent" | "cancelled";
};
export function approvePractice(
  rows: ReturnType<typeof validatePracticeRows>,
  at: number,
  steps: FollowupStep[],
  initialCV: boolean,
  followupCV: boolean,
  now = Date.now(),
): PracticeJob[] {
  const sequence = steps.length ? validateSequence(steps) : [];
  const finalOffset = sequence.reduce(
    (offset, step) =>
      step.relative_to === "original"
        ? delayMilliseconds(step)
        : offset + delayMilliseconds(step),
    0,
  );
  if (
    !Number.isFinite(at) ||
    at <= now ||
    at + finalOffset > now + 60 * 86400000
  )
    throw new Error(
      "Choose future dates with the entire practice campaign inside 60 days.",
    );
  return rows.flatMap((row, index) => {
    let offset = 0;
    return [
      {
        id: `${index}-initial`,
        recipient: row.email,
        subject: row.subject,
        body: row.body,
        at,
        kind: "initial" as const,
        attachment: initialCV,
        status: "scheduled" as const,
      },
      ...sequence.map((step, number) => {
        offset =
          step.relative_to === "original"
            ? delayMilliseconds(step)
            : offset + delayMilliseconds(step);
        return {
          id: `${index}-${number}`,
          recipient: row.email,
          subject: step.subject,
          body: step.body,
          at: at + offset,
          kind: "followup" as const,
          attachment: followupCV,
          status: "scheduled" as const,
        };
      }),
    ];
  });
}
export const advancePractice = (
  jobs: PracticeJob[],
  time: number,
): PracticeJob[] =>
  jobs.map((job) =>
    job.status === "scheduled" && job.at <= time
      ? { ...job, status: "sent" }
      : job,
  );
export const replyPractice = (
  jobs: PracticeJob[],
  recipient: string,
): PracticeJob[] =>
  jobs.map((job) =>
    job.recipient === recipient &&
    job.kind === "followup" &&
    job.status === "scheduled"
      ? { ...job, status: "cancelled" }
      : job,
  );
