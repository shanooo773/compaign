import Papa from "papaparse";
import {
  normalizeSpreadsheetRow,
  spreadsheetDraft,
  spreadsheetBaseColumns,
  spreadsheetStepFields,
  spreadsheetColumns,
} from "./spreadsheet";
import {
  MAX_FOLLOWUPS,
  MAX_SEQUENCE_DAYS,
  delayMilliseconds,
} from "./followup-sequence";
import { zonedISO } from "./timezone";
export type ImportRow = Record<string, string>;
export const MAX_PASTE_BYTES = 1024 * 1024;
export const baseColumns = spreadsheetBaseColumns;
export const stepFields = spreadsheetStepFields;
export const importColumns = spreadsheetColumns;
const aliases = [
  "followup_days",
  "followup_subject",
  "followup_body",
  "follow_up_days",
  "follow_up_subject",
  "follow_up_body",
  "follow_up_delay_value",
  "follow_up_delay_unit",
  "follow_up_relative_to",
  "follow_up_sequence",
];
const supported = new Set([...importColumns, ...aliases]);
export function checkPaste(text: string) {
  if (new TextEncoder().encode(text).length > MAX_PASTE_BYTES)
    throw Error(
      "Paste up to 1 MiB. Split larger campaigns into batches of at most 25 professors.",
    );
  if (!text.trim()) throw Error("Paste your campaign first.");
  if (text.includes("\0")) throw Error("NUL characters are not supported.");
}
function headers(values: string[]) {
  const keys = values.map((v) =>
    v
      .replace(/^\uFEFF/, "")
      .trim()
      .toLowerCase(),
  );
  if (keys.some((k) => !k) || new Set(keys).size !== keys.length)
    throw Error("Column headers must be nonempty and unique.");
  for (const key of keys)
    if (!supported.has(key))
      throw Error(
        `Unsupported column '${key}'. Use name and email, not professor_name. Copy the built-in template.`,
      );
  return keys;
}
export function checkedRows(input: Record<string, unknown>[]): ImportRow[] {
  if (!input.length || input.length > 25)
    throw Error(
      "A campaign supports 1–25 professors. Split larger lists into separate drafts.",
    );
  return input.map((r, i) => {
    const keys = headers(Object.keys(r));
    return normalizeSpreadsheetRow(
      Object.fromEntries(keys.map((k, j) => [k, Object.values(r)[j]])),
      i,
    );
  });
}
// Blocks are explicit: arbitrary prose is never guessed into a recipient/message.
export function parseStructuredText(text: string): ImportRow[] {
  checkPaste(text);
  const lines = text.split("\n"),
    rows: ImportRow[] = [];
  let row: ImportRow | null = null;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].replace(/\r$/, "");
    if (line === "=== PROFESSOR ===") {
      if (row) rows.push(row);
      row = {};
      continue;
    }
    if (!line.trim()) continue;
    if (!row)
      throw Error(
        `Line ${i + 1}: start each professor with === PROFESSOR ===. Paste only the published format.`,
      );
    const match = /^([a-z][a-z0-9_]*):(?: (.*))?$/.exec(line);
    if (!match || !supported.has(match[1]))
      throw Error(
        `Line ${i + 1}: unsupported field or text. Use exact template field names.`,
      );
    const key = match[1];
    if (Object.hasOwn(row, key))
      throw Error(
        `Line ${i + 1}: duplicate field ${key}; resolve the ambiguity.`,
      );
    let value = match[2] ?? "";
    if (value === "<<<") {
      const start = ++i;
      while (i < lines.length && lines[i].replace(/\r$/, "") !== ">>>") i++;
      if (i === lines.length)
        throw Error(
          `Unclosed multiline field ${key}; end it with >>> on its own line.`,
        );
      value = lines.slice(start, i).join("\n");
      if (value.endsWith("\r")) value = value.slice(0, -1);
    }
    row[key] = value;
  }
  if (row) rows.push(row);
  return checkedRows(rows);
}
function markdownCells(line: string): string[] {
  const source = line.trim().replace(/^\|/, "").replace(/\|$/, "");
  const cells: string[] = [];
  let value = "";
  for (let i = 0; i < source.length; i++) {
    if (source[i] === "\\" && source[i + 1] === "|") {
      value += "|";
      i++;
    } else if (source[i] === "|") {
      cells.push(value.trim());
      value = "";
    } else value += source[i];
  }
  cells.push(value.trim());
  return cells;
}
export function parseTable(text: string): ImportRow[] {
  checkPaste(text);
  const trimmed = text.trim();
  if (trimmed.startsWith("[")) {
    let data;
    try {
      data = JSON.parse(trimmed);
    } catch {
      throw Error(
        "Invalid JSON. Use a JSON array of flat row objects; no automatic repair is performed.",
      );
    }
    if (
      !Array.isArray(data) ||
      data.some((r) => !r || typeof r !== "object" || Array.isArray(r))
    )
      throw Error("JSON must be an array of flat row objects.");
    return checkedRows(data);
  }
  const lines = trimmed.split(/\r?\n/);
  if (
    lines.length > 1 &&
    /^\s*\|?\s*:?-{3,}/.test(lines[1]) &&
    lines[0].includes("|")
  ) {
    const keys = headers(markdownCells(lines[0]));
    const separator = markdownCells(lines[1]);
    if (
      separator.length !== keys.length ||
      separator.some((v) => !/^:?-{3,}:?$/.test(v))
    )
      throw Error("Invalid Markdown table separator.");
    return checkedRows(
      lines
        .slice(2)
        .filter((l) => l.trim())
        .map((l, i) => {
          const values = markdownCells(l);
          if (values.length !== keys.length)
            throw Error(
              `Table row ${i + 1}: column count differs. Escape literal pipes as \\|. For multiline cells use CSV, TSV or structured text; HTML <br> is not converted.`,
            );
          return Object.fromEntries(keys.map((k, j) => [k, values[j]]));
        }),
    );
  }
  const parsed = Papa.parse<string[]>(text, {
    skipEmptyLines: "greedy",
    delimitersToGuess: [",", "\t", ";"],
  });
  if (parsed.errors.length)
    throw Error("Invalid CSV/TSV: " + parsed.errors[0].message);
  if (![",", "\t", ";"].includes(parsed.meta.delimiter))
    throw Error(
      "Unsupported table. Use CSV, TSV, a Markdown table or a JSON array.",
    );
  const keys = headers(parsed.data[0] || []);
  return checkedRows(
    parsed.data.slice(1).map((values, i) => {
      if (values.length !== keys.length)
        throw Error(
          `Table row ${i + 1}: expected ${keys.length} cells, received ${values.length}. Quote multiline cells.`,
        );
      return Object.fromEntries(keys.map((k, j) => [k, values[j]]));
    }),
  );
}
export function validateSmartRows(
  rows: ImportRow[],
  now = Date.now(),
): string[][] {
  const seen = new Map<string, number[]>();
  rows.forEach((row, i) => {
    const email = row.email?.trim().toLowerCase();
    if (email) seen.set(email, [...(seen.get(email) || []), i]);
  });
  return rows.map((row, i) => {
    const errors: string[] = [];
    if (!row.name?.trim()) errors.push("Enter the professor's name.");
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(row.email?.trim() || ""))
      errors.push("Enter a valid email address.");
    if ((seen.get(row.email?.trim().toLowerCase())?.length || 0) > 1)
      errors.push(
        "Duplicate recipient. Remove or combine rows before creating a draft.",
      );
    if (!row.timezone?.trim())
      errors.push("Choose an explicit IANA timezone; none will be guessed.");
    try {
      const draft = spreadsheetDraft(row, i);
      const start = Date.parse(draft.scheduled_at);
      if (start <= now) errors.push("Choose a future sending date.");
      let offset = 0;
      if (draft.followup_proposal?.steps)
        for (const step of draft.followup_proposal.steps)
          offset =
            step.relative_to === "original"
              ? delayMilliseconds(step)
              : offset + delayMilliseconds(step);
      else if (draft.followup_proposal)
        offset = draft.followup_proposal.days * 86400000;
      if (start + offset > now + MAX_SEQUENCE_DAYS * 86400000)
        errors.push(
          "Initial email and last follow-up must fit within 60 days from now. Move the initial date earlier or reduce delays.",
        );
    } catch (e) {
      errors.push((e as Error).message);
    }
    return errors;
  });
}
export function localSchedule(local: string, zone: string) {
  if (!zone.trim())
    throw Error("Choose a timezone before converting local time.");
  return zonedISO(local, zone, true);
}
export function exampleRows(now = Date.now()): ImportRow[] {
  return [
    {
      name: "Amina Noor",
      email: "professor@example.com",
      university: "Example Research University",
      interests: "embedded systems",
      subject: "MS research supervision enquiry",
      body: "Dear Professor Noor,\n\nThis fictional example demonstrates personalised outreach. Replace it with your own verified research connection.\n\nKind regards,\nExample Student",
      scheduled_at: new Date(now + 86400000).toISOString(),
      timezone: "Asia/Karachi",
      follow_up_1_subject: "Following up on my research enquiry",
      follow_up_1_body:
        "Dear Professor Noor,\n\nMay I follow up on my research supervision enquiry? Thank you for your time.\n\nKind regards,\nExample Student",
      follow_up_1_delay_value: "7",
      follow_up_1_delay_unit: "days",
      follow_up_1_relative_to: "original",
    },
  ];
}
export function textTemplate(rows = exampleRows()) {
  return rows
    .map(
      (row) =>
        "=== PROFESSOR ===\n" +
        Object.entries(row)
          .map(([k, v]) =>
            k.endsWith("body") ? `${k}: <<<\n${v}\n>>>` : `${k}: ${v}`,
          )
          .join("\n"),
    )
    .join("\n\n");
}
export function tableTemplate(rows = exampleRows(), allColumns = false) {
  return Papa.unparse(
    {
      fields: allColumns ? importColumns : Object.keys(rows[0]),
      data: rows.map((row) =>
        (allColumns ? importColumns : Object.keys(rows[0])).map(
          (k) => row[k] || "",
        ),
      ),
    },
    { newline: "\r\n", quotes: true },
  );
}
export function aiPrompt(template = textTemplate()) {
  return `Prepare professor outreach using ONLY the exact Professor Agent structured format below. Return only that format: no Markdown fences, commentary or instructions. Ask me for missing student details, dates or timezone before producing it. Do not invent professor names, institutional email addresses, research claims, funding opportunities, messages or schedules. Use verified official professor information and request source links for factual research claims where available; put source links in interests or in the email body when appropriate, never add unsupported fields. Potential supervision is not verified funding. Include complete professor-specific initial subjects/bodies and every requested follow-up subject/body, positive integer delay, minutes/hours/days unit and original/previous anchor. Use explicit dates/times and IANA timezone. scheduled_at must be UTC ISO with Z, converted from my explicit local time; do not guess a timezone. Use 0–10 numbered follow-ups (follow_up_1_... through follow_up_10_...), keep chronological timing and finish within 60 days. Omit all follow-up fields if none requested. Preserve multiline bodies between <<< and >>> on their own lines; do not include a standalone >>> inside body content. Repeat === PROFESSOR === for every recipient, at most 25. The following is a FICTIONAL format example, not a real professor or real opportunity. Replace it only with verified details and my requested content:\n\n${template}`;
}
