"use client";
import { MESSAGE_CAPACITY, MESSAGE_CAPACITY_ERROR, checkMessageCapacity } from "../../../shared/message-capacity";
import { useEffect, useRef, useState } from "react";
import readXlsxFile from "read-excel-file";
import { smartWorkbook } from "../lib/smart-workbook";
import {
  Upload,
  ClipboardPaste,
  Table2,
  FileText,
  CheckCircle2,
} from "lucide-react";
import {
  parseStructuredText,
  parseTable,
  checkedRows,
  validateSmartRows,
  localSchedule,
  textTemplate,
  tableTemplate,
  aiPrompt,
  exampleRows,
  baseColumns,
  stepFields,
  importColumns,
  MAX_PASTE_BYTES,
  type ImportRow,
} from "../../../shared/smart-import";
import { localDate } from "../../../shared/timezone";
import { spreadsheetDraft } from "../../../shared/spreadsheet";
import { delayMilliseconds } from "../../../shared/followup-sequence";
import type { Api } from "./account-ui";

type Method = "text" | "table" | "upload";
export function SmartImport({
  api,
  userKey,
  limited,
  onDraft,
  practice = false,
}: {
  api?: Api;
  userKey: string;
  limited: boolean;
  onDraft: (rows: ImportRow[], result: any) => void;
  practice?: boolean;
}) {
  const templateRef = useRef<HTMLDetailsElement>(null);
  useEffect(() => {
    if (templateRef.current)
      templateRef.current.open =
        false;
  }, []);
  const [method, setMethod] = useState<Method>("text"),
    [input, setInput] = useState(""),
    [rows, setRows] = useState<ImportRow[]>([]),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [busy, setBusy] = useState(false);
  const [templates] = useState(() => ({
    text: textTemplate(),
    table: tableTemplate(),
    full: tableTemplate(exampleRows(), true),
  }));
  const [clock, setClock] = useState(Date.now());
  const issues = validateSmartRows(rows, clock).map(row=>row.map(message=>message.replace("Choose an explicit IANA timezone; none will be guessed.","Choose the timezone for your scheduled emails, such as Korea (Asia/Seoul)."))),
    invalid = issues.some((v) => v.length);
  const followups = rows.reduce((n, r) => {
    try {
      const seq = r.follow_up_sequence
        ? JSON.parse(r.follow_up_sequence)
        : null;
      return (
        n +
        (Array.isArray(seq)
          ? seq.length
          : stepFields.some((f) => r["follow_up_1_" + f])
            ? Array.from({ length: 10 }, (_, i) =>
                stepFields.some((f) => r[`follow_up_${i + 1}_${f}`]),
              ).filter(Boolean).length
            : r.followup_days || r.follow_up_days || r.follow_up_delay_value
              ? 1
              : 0)
      );
    } catch {
      return n;
    }
  }, 0);
  async function copy(value: string) {
    try {
      await navigator.clipboard.writeText(value);
      setNotice("Copied. Paste it into your own editor or AI account.");
    } catch {
      setError(
        "Clipboard unavailable. Select and copy the visible template manually.",
      );
    }
  }
  function download(value: string | Uint8Array, name: string) {
    const url = URL.createObjectURL(
      new Blob(
        [typeof value === "string" ? value : new Uint8Array(value).buffer],
        {
          type: name.endsWith("xlsx")
            ? "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
            : "text/csv;charset=utf-8",
        },
      ),
    );
    const a = document.createElement("a");
    a.href = url;
    a.download = name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  function update(index: number, key: string, value: string) {
    setClock(Date.now());
    setRows((old) =>
      old.map((r, i) => (i === index ? { ...r, [key]: value } : r)),
    );
  }
  function parse() {
    setError("");
    setNotice("");
    setRows([]);
    try {
      setRows(
        method === "text" ? parseStructuredText(input) : parseTable(input),
      );
      setClock(Date.now());
    } catch (e) {
      setError((e as Error).message);
    }
  }
  async function upload(file: File) {
    setError("");
    setRows([]);
    try {
      if (file.size > MAX_PASTE_BYTES * 5)
        throw Error(
          "Upload a file up to 5 MiB. Campaigns support at most 25 professors.",
        );
      let parsed: ImportRow[];
      if (file.name.toLowerCase().endsWith(".xlsx")) {
        const sheet = await readXlsxFile(file, { trim: false });
        const head = sheet[0]?.map(String);
        if (
          !head?.length ||
          head.some((h) => !h.trim()) ||
          new Set(head.map((h) => h.trim().toLowerCase())).size !== head.length
        )
          throw Error("Excel headers must be nonempty and unique.");
        parsed = checkedRows(
          sheet
            .slice(1)
            .filter((r) => r.some((v) => v !== null && v !== ""))
            .map((r) =>
              Object.fromEntries(head.map((k, i) => [k, r[i] ?? ""])),
            ),
        );
      } else if (file.name.toLowerCase().endsWith(".csv"))
        parsed = parseTable(await file.text());
      else throw Error("Choose a .csv or .xlsx file.");
      setRows(parsed);
      setClock(Date.now());
    } catch (e) {
      setError((e as Error).message);
    }
  }
  async function add() {
    setError("");
    setBusy(true);
    try {
      const validation = validateSmartRows(rows);
      setClock(Date.now());
      if (!rows.length || validation.some((v) => v.length))
        throw Error("Correct every listed error before adding this campaign.");
      if (practice) {
        onDraft(rows, { practice: true });
        return;
      }
      if (limited || !api)
        throw Error(
          "Verify your account before creating a real campaign draft. Practice Campaign remains available.",
        );
      if (rows.length + followups > MESSAGE_CAPACITY.student) throw Error(MESSAGE_CAPACITY_ERROR);
      const digest = await crypto.subtle.digest(
        "SHA-256",
        new TextEncoder().encode(userKey + "\n" + JSON.stringify(rows)),
      );
      const key =
        "smart-import-pending:" +
        Array.from(new Uint8Array(digest), (b) =>
          b.toString(16).padStart(2, "0"),
        ).join("");
      let id = crypto.randomUUID();
      try {
        id = sessionStorage.getItem(key) || id;
        sessionStorage.setItem(key, id);
      } catch {}
      checkMessageCapacity(await api("/capacity?import_id="+encodeURIComponent(id)), rows.length + followups);
      let result = await api("/imports/drafts", "POST", {
        import_id: id,
        rows,
      });
      if (result.can_start_new_import) {
          // Retire the import identity, never reactivate its messages.
          id = crypto.randomUUID();
          try { sessionStorage.setItem(key, id); } catch {}
          result = await api("/imports/drafts", "POST", {import_id:id, rows});
        }
        // Keep the ID until rows change: repeated clicks/retries reopen the same unapproved draft.
      onDraft(rows, result);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  const cell = (r: ImportRow, i: number, key: string) => (
    <label key={key}>
      {key.replaceAll("_", " ")}
      {key.endsWith("body") || key === "follow_up_sequence" ? (
        <textarea
          aria-label={`${key} professor ${i + 1}`}
          rows={key.endsWith("body") ? 6 : 3}
          value={r[key] || ""}
          onChange={(e) => update(i, key, e.target.value)}
        />
      ) : (
        <input
          aria-label={`${key} professor ${i + 1}`}
          value={r[key] || ""}
          onChange={(e) => update(i, key, e.target.value)}
        />
      )}
    </label>
  );
  return (
    <section
      className="smart-import"
      data-tour="smart-import"
      aria-label={practice ? "Practice Smart Import" : "Smart Import"}
      aria-busy={busy}
    >
      <div className="smart-intro">
        <span className="eyebrow">
          ZERO AI CALLS · YOUR CONTENT, YOUR CONTROL
        </span>
        <h2>
          {practice ? "Practise Smart Import" : "Build a campaign your way"}
        </h2>
        <p>
          Paste → correct and preview → create an unapproved draft → review
          attachments and approve once. Importing never sends email. Prepare up to {MESSAGE_CAPACITY.student} active messages, including follow-ups; completed and cancelled history is excluded. Sending remains limited to 50 emails per rolling day.
        </p>
      </div>
      {practice && (
        <p className="practice-banner">
          PRACTICE MODE — NO REAL EMAILS WILL BE SENT
        </p>
      )}
      <ol className="smart-progress" aria-label="Import progress">
        <li>1. Choose and paste</li>
        <li>2. Edit and validate</li>
        <li>3. Create draft</li>
        <li>4. Review and approve</li>
      </ol>
      <div className="smart-methods" role="group" aria-label="Import method">
        {(
          [
            ["text", "Paste Text", FileText],
            ["table", "Paste Table", Table2],
            ["upload", "Excel / CSV Upload", Upload],
          ] as const
        ).map(([id, label, Icon]) => (
          <button
            key={id}
            aria-pressed={method === id}
            className={method === id ? "primary" : "secondary"}
            onClick={() => {
              setMethod(id);
              setRows([]);
              setError("");
            }}
          >
            <Icon size={20} />
            {label}
          </button>
        ))}
      </div>
      {error && (
        <p role="alert" className="feedback error">
          {error}
        </p>
      )}
      {notice && (
        <p role="status" className="feedback">
          {notice}
        </p>
      )}
      <div className="smart-columns">
        <section className="panel smart-input">
          <h3>
            {method === "text"
              ? "Paste structured text"
              : method === "table"
                ? "Paste a table"
                : "Upload your spreadsheet"}
          </h3>
          <p>
            {method === "text"
              ? "Use the exact template beside this form. Free-form prose is flagged rather than guessed."
              : method === "table"
                ? "CSV, quoted TSV, semicolon-separated tables, Markdown tables and strict JSON arrays are supported."
                : "Existing .xlsx and .csv campaign schemas remain supported. Use UTC text cells for reliable scheduling."}
          </p>
          {method === "upload" ? (
            <label>
              Excel or CSV file
              <input
                aria-label="Smart Import file"
                type="file"
                accept=".csv,.xlsx"
                disabled={busy}
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) void upload(f);
                  e.target.value = "";
                }}
              />
            </label>
          ) : (
            <>
              <label htmlFor="smart-paste">
                {method === "text" ? "Campaign text" : "Campaign table"} (up to
                1 MiB)
              </label>
              <textarea
                id="smart-paste"
                maxLength={MAX_PASTE_BYTES}
                rows={16}
                value={input}
                onChange={(e) => {
                  setInput(e.target.value);
                  setRows([]);
                }}
                spellCheck={false}
              />
              <button className="primary" disabled={busy} onClick={parse}>
                <ClipboardPaste size={17} />
                Parse and preview
              </button>
            </>
          )}
          <button
            className="text-link"
            onClick={() => {
              setRows(exampleRows());
              setClock(Date.now());
              setNotice(
                "Fictional sample loaded. Replace all example details before creating a real draft.",
              );
            }}
          >
            Try a fictional example
          </button>
          <p className="helper">
            Pasted content stays in this browser until you explicitly create a
            draft. No AI API, external parsing service or provider password is
            used.
          </p>
        </section>
        <details ref={templateRef} className="panel smart-template" open>
          <summary>Template, examples and instructions</summary>
          <p>
            <strong>Required:</strong> name, email, subject, body, scheduled_at
            and an explicit timezone. university and interests are optional. Do
            not use professor_name.
          </p>
          <p>
            <strong>Follow-ups:</strong> optional follow_up_1_subject, body,
            delay_value, delay_unit, relative_to (repeat through 10). Units:
            minutes / hours / days. Anchors: original / previous. Include every
            field of each step. Remove unused steps entirely.
          </p>
          <div className="smart-actions">
            <button
              className="secondary"
              onClick={() =>
                copy(method === "text" ? templates.text : templates.table)
              }
            >
              {method === "text" ? "Copy Text Template" : "Copy Table Template"}
            </button>
            <button
              className="secondary"
              onClick={() => copy(aiPrompt(templates.text))}
            >
              Copy Prompt for AI
            </button>
            <button
              className="secondary"
              onClick={() =>
                download(
                  tableTemplate(exampleRows(), true),
                  "professor-agent-smart-template.csv",
                )
              }
            >
              Download CSV Template
            </button>
            <button
              className="secondary"
              onClick={() =>
                download(smartWorkbook(), "professor-agent-smart-template.xlsx")
              }
            >
              Download Excel Template
            </button>
          </div>
          <pre tabIndex={0} className="smart-template-code">
            {method === "text" ? templates.text : templates.table}
          </pre>
          <details>
            <summary>All supported numbered columns</summary>
            <p className="smart-column-list">{importColumns.join(", ")}</p>
            <p>
              Legacy followup_days / followup_subject / followup_body and
              follow_up_* single-step aliases remain supported, as does
              follow_up_sequence JSON. Do not combine sequence formats.
            </p>
          </details>
          <p>
            Times: 10:00 in Asia/Karachi = 05:00 UTC; 10:00 in Asia/Seoul =
            01:00 UTC. Use the local-time converter in each preview card; no
            manual UTC calculation is necessary. UTC is stored as scheduled_at
            ending in Z.
          </p>
          <p>
            Excel: format timestamps as text. Quoted CSV/TSV supports literal
            multiline cells. Markdown trims outer cell padding; multiline
            Markdown cells and HTML line-break conversion are unsupported. Use
            structured text or quoted CSV for exact multiline messages.
          </p>
          <p>
            Downloaded templates use fictional details and a future date. The
            visible sample is dated for tomorrow when this page opens. Verify
            all facts and dates before use. At most 25 recipients; all planned
            messages must finish within 60 days.
          </p>
        </details>
      </div>
      {!!rows.length && (
        <section
          className="panel smart-preview"
          aria-label="Editable campaign preview"
        >
          <div className="panel-heading">
            <div>
              <h3>Editable campaign preview</h3>
              <p>
                {rows.length} recipients · {rows.length} initial emails ·{" "}
                {followups} conditional follow-ups
              </p>
            </div>
            <button
              className="secondary"
              disabled={busy}
              onClick={() => setRows([])}
            >
              Clear preview
            </button>
          </div>
          <div
            className="table-wrap"
            tabIndex={0}
            aria-label="Editable recipient grid"
          >
            <table className="smart-grid">
              <caption>
                Recipient grid: edit cells here, then inspect full messages and
                follow-ups below.
              </caption>
              <thead>
                <tr>
                  {[
                    "name",
                    "email",
                    "university",
                    "subject",
                    "scheduled_at",
                    "timezone",
                  ].map((key) => (
                    <th scope="col" key={key}>
                      {key}
                    </th>
                  ))}
                  <th scope="col">Validation</th>
                  <th scope="col">Full content</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row, index) => (
                  <tr key={index}>
                    {[
                      "name",
                      "email",
                      "university",
                      "subject",
                      "scheduled_at",
                      "timezone",
                    ].map((key) => (
                      <td key={key}>
                        <input
                          disabled={busy}
                          aria-label={`Grid ${key} row ${index + 1}`}
                          value={row[key] || ""}
                          onChange={(e) => update(index, key, e.target.value)}
                        />
                      </td>
                    ))}
                    <td>
                      {issues[index].length
                        ? `${issues[index].length} errors`
                        : "Valid"}
                    </td>
                    <td>
                      <a href={`#smart-professor-${index}`}>
                        Review professor {index + 1}
                      </a>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {rows.map((row, i) => (
            <article
              className="smart-recipient"
              id={`smart-professor-${i}`}
              key={i}
            >
              <div className="panel-heading">
                <h4>
                  Professor {i + 1}: {row.name || "Name needed"}
                </h4>
                <button
                  className="secondary"
                  disabled={busy}
                  onClick={() => setRows(rows.filter((_, n) => n !== i))}
                >
                  Remove professor {i + 1}
                </button>
              </div>
              <div className="smart-fields">
                {baseColumns.map((k) => cell(row, i, k))}
              </div>
              <FollowupTimes row={row} />
              <LocalConverter
                row={row}
                index={i}
                onChange={(v) => update(i, "scheduled_at", v)}
                onZone={(v) => update(i, "timezone", v)}
              />
              <div className="smart-followups">
                {Array.from({ length: 10 }, (_, n) => n + 1)
                  .filter((n) =>
                    stepFields.some((f) => !!row[`follow_up_${n}_${f}`]),
                  )
                  .map((n) => (
                    <details open key={n}>
                      <summary>Follow-up {n}</summary>
                      <div className="smart-fields">
                        {stepFields.map((f) =>
                          cell(row, i, `follow_up_${n}_${f}`),
                        )}
                      </div>
                      <button
                        className="secondary"
                        onClick={() => {
                          const next = { ...row };
                          for (let step = n; step < 10; step++)
                            for (const f of stepFields) {
                              const dest = `follow_up_${step}_${f}`,
                                src = `follow_up_${step + 1}_${f}`;
                              if (Object.hasOwn(next, src))
                                next[dest] = next[src];
                              else delete next[dest];
                            }
                          for (const f of stepFields)
                            delete next[`follow_up_10_${f}`];
                          setRows(rows.map((r, j) => (j === i ? next : r)));
                        }}
                      >
                        Remove follow-up {n}
                      </button>
                    </details>
                  ))}
              </div>
              {Object.keys(row)
                .filter(
                  (k) => !baseColumns.includes(k) && !/^follow_up_\d+_/.test(k),
                )
                .map((k) => cell(row, i, k))}
              <button
                className="secondary"
                onClick={() =>
                  setRows(
                    rows.map((r, j) =>
                      j === i
                        ? Object.fromEntries(
                            Object.entries(r).filter(
                              ([key]) =>
                                !key.startsWith("follow_up_") &&
                                !key.startsWith("followup_"),
                            ),
                          )
                        : r,
                    ),
                  )
                }
              >
                Remove all follow-ups
              </button>
              <button
                className="secondary"
                onClick={() => {
                  const next = Array.from({ length: 10 }, (_, n) => n + 1).find(
                    (n) =>
                      !stepFields.some((f) => !!row[`follow_up_${n}_${f}`]),
                  );
                  if (!next) {
                    setError("At most 10 follow-ups per professor.");
                    return;
                  }
                  setRows(
                    rows.map((r, j) =>
                      j === i
                        ? {
                            ...r,
                            ...Object.fromEntries(
                              stepFields.map((f) => [
                                `follow_up_${next}_${f}`,
                                f === "delay_unit"
                                  ? "days"
                                  : f === "relative_to"
                                    ? "previous"
                                    : "",
                              ]),
                            ),
                          }
                        : r,
                    ),
                  );
                }}
              >
                Add follow-up
              </button>
              {issues[i].length ? (
                <ul
                  className="feedback error"
                  aria-label={`Professor ${i + 1} validation errors`}
                >
                  {issues[i].map((v, n) => (
                    <li key={n}>{v}</li>
                  ))}
                </ul>
              ) : (
                <p className="smart-valid">
                  <CheckCircle2 size={17} />
                  Valid for draft creation. Review all content before approval.
                </p>
              )}
            </article>
          ))}
          {limited && !practice && (
            <p role="status">
              Verify your account to create a real draft. You can still edit
              this preview or use Practice Campaign.
            </p>
          )}
          <button
            className="primary full"
            disabled={busy || invalid || (limited && !practice)}
            onClick={add}
          >
            {busy
              ? "Creating unapproved draft…"
              : practice
                ? "Simulate Add to Campaign"
                : "Add to Campaign"}
          </button>
          <p className="helper">
            This creates only an unapproved draft. Choose your CV and other
            documents in the existing review screen. Sending requires a separate
            explicit approval.
          </p>
        </section>
      )}
    </section>
  );
}
function LocalConverter({
  row,
  index,
  onChange,
  onZone,
}: {
  row: ImportRow;
  index: number;
  onChange: (v: string) => void;
  onZone: (v: string) => void;
}) {
  const [local, setLocal] = useState(""),
    [error, setError] = useState("");
  let display = "Enter a valid UTC timestamp and timezone.";
  try {
    display = `${localDate(row.timezone, new Date(row.scheduled_at))} (${row.timezone}) → ${row.scheduled_at}`;
  } catch {}
  return (
    <div className="smart-local">
      <strong>Local date/time → UTC</strong>
      <p>{display}</p>
      <label>
        Local sending time
        <input
          aria-label={`Local sending time professor ${index + 1}`}
          type="datetime-local"
          value={local}
          onChange={(e) => setLocal(e.target.value)}
        />
      </label>
      <label>
        Timezone
        <input
          aria-label={`Timezone selector professor ${index + 1}`}
          list={`smart-timezones-${index}`}
          value={row.timezone || ""}
          onChange={(e) => onZone(e.target.value)}
        />
      </label>
      <datalist id={`smart-timezones-${index}`}>
        <option value="Asia/Karachi" />
        <option value="Asia/Seoul" />
        <option value="UTC" />
      </datalist>
      <p className="helper">
        Choose Asia/Karachi, Asia/Seoul or UTC, or enter another IANA zone.
        Ambiguous daylight-saving times are rejected.
      </p>
      <button
        className="secondary"
        onClick={() => {
          try {
            onChange(localSchedule(local, row.timezone));
            setError("");
          } catch (e) {
            setError((e as Error).message);
          }
        }}
      >
        Convert local time to UTC
      </button>
      {error && <p role="alert">{error}</p>}
    </div>
  );
}

function FollowupTimes({ row }: { row: ImportRow }) {
  try {
    const draft = spreadsheetDraft(row, 0),
      f = draft.followup_proposal;
    if (!f) return null;
    let offset = 0;
    const steps = f.steps || [
      {
        ...f,
        delay_value: f.days,
        delay_unit: "days" as const,
        relative_to: "original" as const,
      },
    ];
    return (
      <details>
        <summary>Preview planned follow-up dates</summary>
        {steps.map((s, i) => {
          offset =
            s.relative_to === "original"
              ? delayMilliseconds(s)
              : offset + delayMilliseconds(s);
          const at = new Date(
            Date.parse(draft.scheduled_at) + offset,
          ).toISOString();
          return (
            <p key={i}>
              Follow-up {i + 1}: {localDate(draft.timezone, new Date(at))} (
              {draft.timezone}) ? UTC {at}. Conditional on no reply; pacing and
              confirmed delivery times can delay this estimate.
            </p>
          );
        })}
      </details>
    );
  } catch {
    return null;
  }
}
