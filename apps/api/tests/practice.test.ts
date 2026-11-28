import { describe, it, expect } from "vitest";
import Papa from "papaparse";
import {
  practiceCSV,
  practiceRows,
  validatePracticeRows,
  approvePractice,
  advancePractice,
  replyPractice,
} from "../../../shared/practice-campaign";
import { spreadsheetDraft } from "../../../shared/spreadsheet";
import type { FollowupStep } from "../../../shared/followup-sequence";
const now = Date.parse("2026-11-03T00:00:00Z");
const steps: FollowupStep[] = [
  {
    subject: "Following up",
    body: "Fictional enquiry",
    delay_value: 7,
    delay_unit: "days",
    relative_to: "original",
  },
  {
    subject: "One final enquiry",
    body: "Thank you",
    delay_value: 7,
    delay_unit: "days",
    relative_to: "previous",
  },
];
describe("isolated practice journey and real parser compatibility", () => {
  it("round trips the fresh downloadable CSV through Papa and actual campaign parser", () => {
    const parsed = Papa.parse<Record<string, string>>(practiceCSV(now), {
      header: true,
      skipEmptyLines: true,
    });
    expect(parsed.errors).toEqual([]);
    const rows = validatePracticeRows(parsed.data);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toEqual(spreadsheetDraft(parsed.data[0], 0));
    expect(rows[0].followup_proposal?.steps).toHaveLength(1);
  });
  it("rejects real addresses, unsupported headers, duplicates and invalid timing", () => {
    expect(() =>
      validatePracticeRows([
        { ...practiceRows(now)[0], email: "real@university.edu" },
      ]),
    ).toThrow(/reserved/);
    const { name, ...withoutName } = practiceRows(now)[0];
    expect(() =>
      validatePracticeRows([{ ...withoutName, professor_name: name }]),
    ).toThrow();
    expect(() =>
      validatePracticeRows([practiceRows(now)[0], practiceRows(now)[0]]),
    ).toThrow(/duplicate/);
    expect(() =>
      validatePracticeRows([
        { ...practiceRows(now)[0], follow_up_1_delay_unit: "weeks" },
      ]),
    ).toThrow();
  });
  it("freezes copies and simulates initial sends, replies and cancellation by recipient", () => {
    const rows = validatePracticeRows(practiceRows(now));
    const jobs = approvePractice(rows, now + 86400000, steps, true, false, now);
    expect(jobs).toHaveLength(6);
    rows[0].subject = "changed draft";
    expect(jobs[0].subject).not.toBe("changed draft");
    expect(jobs[0].attachment).toBe(true);
    expect(jobs[1].attachment).toBe(false);
    expect(jobs[2].at - jobs[0].at).toBe(14 * 86400000);
    const initial = advancePractice(jobs, now + 86400000);
    expect(initial.filter((j) => j.status === "sent")).toHaveLength(2);
    const replied = replyPractice(initial, rows[0].email);
    expect(replied.filter((j) => j.status === "cancelled")).toHaveLength(2);
    const final = advancePractice(replied, now + 30 * 86400000);
    expect(final.filter((j) => j.status === "sent")).toHaveLength(4);
    expect(final.filter((j) => j.status === "cancelled")).toHaveLength(2);
    expect(jobs.every((j) => j.status === "scheduled")).toBe(true);
  });
  it("enforces future and complete 60-day horizon, ten steps and increasing anchors", () => {
    const rows = validatePracticeRows(practiceRows(now));
    expect(() => approvePractice(rows, now, steps, true, false, now)).toThrow();
    expect(() =>
      approvePractice(rows, now + 59 * 86400000, steps, true, false, now),
    ).toThrow();
    expect(() =>
      approvePractice(
        rows,
        now + 86400000,
        Array(11).fill(steps[0]),
        true,
        false,
        now,
      ),
    ).toThrow();
    expect(() =>
      approvePractice(
        rows,
        now + 86400000,
        [steps[0], steps[0]],
        true,
        false,
        now,
      ),
    ).toThrow();
  });
});
