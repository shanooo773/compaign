"use client";
import { MESSAGE_CAPACITY, MESSAGE_CAPACITY_ERROR, checkMessageCapacity } from "../../../shared/message-capacity";
import { WorkflowProgress } from "./ui";
import { useRef, useState } from "react";
import { spreadsheetDraft } from "../../../shared/spreadsheet";
import {
  MAX_FOLLOWUPS,
  delayMilliseconds,
  type FollowupStep,
} from "../../../shared/followup-sequence";
import {
  EmailAttachments,
  type AttachmentChoice,
  type CampaignDocument,
} from "./email-attachments";
import type { Api } from "./account-ui";
type Draft = {
  id: string;
  professor_email: string;
  professor_name: string;
  subject: string;
  body: string;
  scheduled_at: string;
  timezone: string;
  status: string;
  followup_proposal?: string;
  followup_issue?: string;
};
type Connection = {
  id: string;
  address: string;
  provider: string;
  status: string;
};
const followupCount = (draft: Draft) =>
  draft.followup_proposal
    ? JSON.parse(draft.followup_proposal).steps?.length || 1
    : 0;
export function ImportWizard({
  rows,
  preparedResult,
  initialName,
  api,
  connections,
  documents,
  onRefresh,
  onClose,
}: {
  rows: Record<string, string>[];
  initialName?: string;
  preparedResult?: {
    drafts: Draft[];
    skipped?: number;
    reimported?: string[];
  } | null;
  api: Api;
  connections: Connection[];
  documents: CampaignDocument[];
  onRefresh: () => Promise<void>;
  onClose: () => void;
}) {
  const [step, setStep] = useState<
    "prepare" | "choose" | "individual" | "complete" | "success"
  >(preparedResult ? "complete" : "prepare");
  const [drafts, setDrafts] = useState<Draft[]>(() =>
      (preparedResult?.drafts || []).filter((d) => d.status === "draft"),
    ),
    [excluded, setExcluded] = useState<string[]>([]),
    [done, setDone] = useState<string[]>([]);
  const [issues, setIssues] = useState<string[]>(() =>
      (preparedResult?.drafts || [])
        .filter((d) => d.status !== "draft")
        .map(
          (d) =>
            `${d.professor_email}: existing ${d.status} message excluded; never replayed.`,
        ),
    ),
    [reimported, setReimported] = useState<string[]>(
      preparedResult?.reimported || [],
    );
  const [account, setAccount] = useState(
    connections.find((c) => c.provider === "gmail" && c.status === "connected")
      ?.id || "",
  );
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [name, setName] = useState(initialName || "Professor outreach campaign");
  const [attachmentSelection, setAttachmentSelection] =
    useState<AttachmentChoice>({ initial: [], followups: {}, recipients: {} });
  const documentNames = (ids: string[]) =>
    ids.length
      ? ids
          .map(
            (id) =>
              documents.find((doc) => doc.id === id)?.name ||
              "Unavailable document",
          )
          .join(", ")
      : "None";
  const [reviewStage,setReviewStage] = useState(3);
  const [receipt, setReceipt] = useState<any>(null);
  const [importIds] = useState(() => ({
    manual: crypto.randomUUID(),
    ai: crypto.randomUUID(),
  }));
  const preparedAI = useRef<Record<string, string>[] | null>(null);
  async function run(fn: () => Promise<void>) {
    setBusy(true);
    setError("");
    try {
      await fn();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function prepare(ai: boolean) {
    const valid: Record<string, string>[] = [],
      errors: string[] = [];
    rows.forEach((row, i) => {
      try {
        spreadsheetDraft(
          ai
            ? {
                ...row,
                subject: row.subject || "Preparation pending",
                body: row.body || "Preparation pending",
              }
            : row,
          i,
          true,
        );
        if (
          !row.name?.trim() ||
          !/^\S+@\S+\.\S+$/.test(row.email?.trim() || "")
        )
          throw Error(`Row ${i + 2}: provide professor name and valid email.`);
        valid.push({ ...row });
      } catch (e) {
        errors.push((e as Error).message);
      }
    });
    setIssues(errors);
    if (!valid.length)
      throw Error(
        "No valid rows. Correct the listed spreadsheet errors and upload again.",
      );
    if (ai && preparedAI.current) {
      valid.splice(
        0,
        valid.length,
        ...preparedAI.current.map((row) => ({ ...row })),
      );
    } else if (ai) {
      await api(
        "/professors",
        "POST",
        valid.map((r) => ({
          name: r.name,
          email: r.email,
          university: r.university || "",
          interests: r.interests || "",
        })),
      );
      const state = await api("/state");
      for (const row of valid) {
        const p = state.professors.find(
          (p: any) => p.email === row.email.trim().toLowerCase(),
        );
        const generated = await api("/draft", "POST", { professor_id: p.id });
        row.subject = generated.subject;
        row.body = generated.body;
        if (generated.warning)
          errors.push(`${row.email}: ${generated.warning}`);
      }
      preparedAI.current = valid.map((row) => ({ ...row }));
    }
    // Keep an uncertain submission recoverable after closing or refreshing the wizard.
    // Scope to the browser session and exact payload; clear only after acknowledgement.
    const bytes = await crypto.subtle.digest(
      "SHA-256",
      new TextEncoder().encode(JSON.stringify(valid)),
    );
    const pendingKey =
      "campaign-pending:" +
      (ai ? "ai:" : "manual:") +
      Array.from(new Uint8Array(bytes), (b) =>
        b.toString(16).padStart(2, "0"),
      ).join("");
    let importId = importIds[ai ? "ai" : "manual"];
    try {
      importId = sessionStorage.getItem(pendingKey) || importId;
      sessionStorage.setItem(pendingKey, importId);
    } catch {
      /* Storage may be disabled; same-wizard retries still reuse the ID. */
    }
    const potential = valid.reduce((n,row,i) => { const draft=spreadsheetDraft(row,i,true); return n+1+(draft.followup_proposal?.steps?.length || (draft.followup_proposal ? 1 : 0)); },0);
    if (potential > MESSAGE_CAPACITY.student) throw Error(MESSAGE_CAPACITY_ERROR);
    checkMessageCapacity(await api("/capacity?import_id="+encodeURIComponent(importId)),potential);
    const result = await api("/imports/drafts", "POST", {
      import_id: importId,
      rows: valid,
    });
    try {
      sessionStorage.removeItem(pendingKey);
    } catch {
      /* Optional storage. */
    }
    setReimported(result.reimported || []);
    setDrafts((result.drafts || []).filter((d: Draft) => d.status === "draft"));
    const unavailable = (result.drafts || []).filter(
      (d: Draft) => d.status !== "draft",
    );
    setIssues([
      ...errors,
      ...unavailable.map(
        (d: Draft) =>
          `${d.professor_email}: existing ${d.status} message excluded; never replayed.`,
      ),
      ...(result.skipped
        ? [
            `${result.skipped} matching rows reused or skipped; no duplicate messages created.`,
          ]
        : []),
    ]);
    setStep("choose");
    await onRefresh();
  }
  const included = drafts.filter(
    (d) => !excluded.includes(d.id) && !done.includes(d.id),
  );
  const missingDocuments=included.filter(d=>!(attachmentSelection.recipients[d.id]||attachmentSelection).initial.length);
  const gmail = connections.find((c) => c.id === account);
  async function approve(items: Draft[], complete: boolean) {
    if (!items.length) throw Error("Select at least one recipient.");
    if (items.some((d) => d.followup_issue))
      throw Error(
        "Exclude rows with incomplete follow-ups or correct their spreadsheet content before complete approval.",
      );
    // Persist edited drafts first; the existing endpoint atomically stores all
    // initial schedules and exact conditional follow-up authorizations together.
    for (const d of items)
      await api(`/messages/${d.id}`, "PUT", {
        subject: d.subject,
        body: d.body,
      });
    const result = await api("/messages/approve", "POST", {
      name,
      ids: items.map((d) => d.id),
      sending_account_id: account,
      authorize_followups: items.some((d) => !!d.followup_proposal),
      attachment_selection: {
        ...attachmentSelection,
        recipients: Object.fromEntries(
          Object.entries(attachmentSelection.recipients).filter(([id]) =>
            items.some((d) => d.id === id),
          ),
        ),
      },
      reviewed_messages: items.map((d) => ({
        id: d.id,
        recipient: d.professor_email,
        subject: d.subject,
        body: d.body,
        scheduled_at: d.scheduled_at,
        timezone: d.timezone,
        followup_proposal: d.followup_proposal || null,
      })),
    });
    setDone((prev) => [...prev, ...items.map((d) => d.id)]);
    if (complete) {
      setReceipt({
        ...result,
        name,
        gmail: gmail?.address,
        ids: items.map((d) => d.id),
        earliest: items.map((d) => d.scheduled_at).sort()[0],
        latest: items
          .map((d) => d.scheduled_at)
          .sort()
          .at(-1),
      });
      setStep("success");
    }
    await onRefresh();
  }
  const preview = (d: Draft, edit = false) => (
    <article className="import-recipient" key={d.id}>
      <div className="panel-heading">
        <strong>
          {d.professor_name} · {d.professor_email}
        </strong>
        <label className="checkbox-label">
          <input
            type="checkbox"
            checked={!excluded.includes(d.id)}
            disabled={busy || done.includes(d.id)}
            onChange={(e) =>
              setExcluded(
                e.target.checked
                  ? excluded.filter((id) => id !== d.id)
                  : [...excluded, d.id],
              )
            }
          />
          Include recipient
        </label>
      </div>
      {done.includes(d.id) && (
        <p role="status">
          Approved and scheduled. No further approval required.
        </p>
      )}
      <p>
        {new Date(d.scheduled_at).toLocaleString(undefined, {
          timeZone: d.timezone,
        })}{" "}
        ({d.timezone}) · UTC: {d.scheduled_at}
      </p>
      <p className="attachment-summary">
        <strong>Initial attachments:</strong>{" "}
        {documentNames(
          attachmentSelection.recipients[d.id]?.initial ||
            attachmentSelection.initial,
        )}
      </p>
      {edit ? (
        <>
          <label>
            Initial subject
            <input
              value={d.subject}
              disabled={busy || done.includes(d.id)}
              onChange={(e) =>
                setDrafts(
                  drafts.map((x) =>
                    x.id === d.id ? { ...x, subject: e.target.value } : x,
                  ),
                )
              }
            />
          </label>
          <label>
            Initial body
            <textarea
              rows={9}
              value={d.body}
              disabled={busy || done.includes(d.id)}
              onChange={(e) =>
                setDrafts(
                  drafts.map((x) =>
                    x.id === d.id ? { ...x, body: e.target.value } : x,
                  ),
                )
              }
            />
          </label>
        </>
      ) : (
        <details open>
          <summary>{d.subject} — expand initial email</summary>
          <pre className="email-preview">{d.body}</pre>
        </details>
      )}
      {d.followup_issue && (
        <p role="alert">
          {d.followup_issue} Exclude this recipient or correct and reimport its
          spreadsheet row.
        </p>
      )}
      {d.followup_proposal ? (
        (() => {
          const f = JSON.parse(d.followup_proposal);
          if (f.steps)
            return (f.steps as FollowupStep[]).map((step, index) => (
              <details open key={index}>
                <summary>
                  Conditional follow-up {index + 1}: {step.subject} ?{" "}
                  {step.delay_value} {step.delay_unit} after {step.relative_to}
                </summary>
                <pre className="email-preview">{step.body}</pre>
                <p className="attachment-summary">
                  <strong>Attachments for this follow-up:</strong>{" "}
                  {documentNames(
                    attachmentSelection.followups[String(index + 1)] || [],
                  )}
                </p>
                <p>
                  Planned earliest UTC:{" "}
                  {new Date(
                    Date.parse(d.scheduled_at) +
                      (f.steps as FollowupStep[])
                        .slice(0, index + 1)
                        .reduce(
                          (offset, item) =>
                            item.relative_to === "original"
                              ? delayMilliseconds(item)
                              : offset + delayMilliseconds(item),
                          0,
                        ),
                  ).toISOString()}
                  . This estimate assumes timely confirmed sends; actual send
                  times determine eligibility.
                </p>
                <p>
                  Only if no reply, decline, opt-out or recipient block. A
                  failed reply check postpones sending. Gmail quotas and pacing
                  can postpone the requested schedule without changing its
                  delays. Due times use actual confirmed sends; cron and Gmail
                  may introduce delays.
                </p>
              </details>
            ));
          return (
            <details open>
              <summary>
                Conditional follow-up: {f.subject} · {f.days} days
              </summary>
              <pre className="email-preview">{f.body}</pre>
              <p className="attachment-summary">
                <strong>Follow-up attachments:</strong>{" "}
                {documentNames(attachmentSelection.followups["1"] || [])}
              </p>
              <p>
                {f.days} days after confirmed Gmail delivery, only if there is
                no reply, decline, opt-out or recipient block. Gmail is checked
                again immediately before sending; failed checks postpone
                delivery. At most one follow-up.
              </p>
            </details>
          );
        })()
      ) : (
        <p>No automatic follow-up supplied.</p>
      )}
      {edit && !done.includes(d.id) && (
        <button
          className="primary"
          disabled={
            busy || excluded.includes(d.id) || !account || !!d.followup_issue
          }
          onClick={() => run(() => approve([d], false))}
        >
          Approve & schedule this recipient
          {d.followup_proposal ? " and exact conditional follow-up" : ""}
        </button>
      )}
    </article>
  );
  return (
    <section
      className="panel import-wizard"
      aria-label="Excel campaign preparation"
      aria-busy={busy}
    >
      <div className="panel-heading">
        <div>
          <span className="eyebrow">EXCEL TO APPROVED OUTREACH</span>
          <h2>
            {step === "success"
              ? "Campaign approved & scheduled"
              : "Prepare your campaign"}
          </h2>
        </div>
        <button className="secondary" disabled={busy} onClick={onClose}>
          Close
        </button>
      </div>
      <WorkflowProgress step={step === "success" ? 5 : step === "prepare" || step === "choose" ? 2 : reviewStage}/>
      {step !== "success" && (
        <aside
          className="campaign-review-guide"
          aria-label="Campaign review checklist"
        >
          <strong>Before you approve</strong>
          <p>
            Check professors ? initial emails ? all follow-ups ? CV and
            attachments ? sender and local / UTC dates. Importing does not send
            email. One approval authorises the complete displayed plan; approved
            content and timing cannot be edited.
          </p>
          <details>
            <summary>How attachment selection works</summary>
            <p>
              Selecting a CV applies to initial emails by default. Choose
              attachments separately for each follow-up and check any
              recipient-specific choices. Expired or unavailable documents must
              be resolved before approval.
            </p>
          </details>
        </aside>
      )}
      {error && (
        <p className="feedback error" role="alert">
          {error}
        </p>
      )}
      {busy && <p role="status">Saving your campaign. Please wait…</p>}
      {!!issues.length && (
        <details open>
          <summary>
            Validation, exclusions and preparation notes ({issues.length})
          </summary>
          {issues.map((s, i) => (
            <p key={i}>{s}</p>
          ))}
        </details>
      )}
      {!!reimported.length && (
        <p role="status">
          Safely reimported as new active professors: {reimported.join(", ")}.
          Deleted records, old schedules and approvals remain inactive. Explicit
          opt-outs and blocks remain enforced.
        </p>
      )}
      {step === "prepare" && (
        <>
          <p>
            {rows.length} spreadsheet rows uploaded. Choose how to prepare them.
            Uploading does not authorize sending. Up to {MAX_FOLLOWUPS} optional
            follow-ups per recipient; only spreadsheet-defined steps are
            included.
          </p>
          <div className="import-choices">
            <button
              className="primary"
              disabled={busy}
              onClick={() => run(() => prepare(false))}
            >
              <strong>Manual / Use Excel content</strong>
              <span>
                Keep your exact subjects, bodies, dates and follow-up content.
              </span>
            </button>
            <button
              className="secondary"
              disabled={busy}
              onClick={() => run(() => prepare(true))}
            >
              <strong>AI-assisted preparation</strong>
              <span>
                Use configured Groq with verified facts, or an editable safe
                template when unavailable. Dates and follow-ups stay as
                supplied.
              </span>
            </button>
          </div>
          <button
            className="text-link"
            disabled={busy}
            onClick={() =>
              run(async () => {
                await api(
                  "/professors",
                  "POST",
                  rows.map((r) => ({
                    name: r.name || "",
                    email: r.email || "",
                    university: r.university || "",
                    interests: r.interests || "",
                  })),
                );
                await onRefresh();
                onClose();
              })
            }
          >
            Import professor records only
          </button>
        </>
      )}
      {step === "choose" && (
        <>
          <p>
            {drafts.length} drafts prepared. Choose a review mode; nothing has
            been approved.
          </p>
          <div className="import-choices">
            <button className="primary" onClick={() => setStep("complete")}>
              Review entire campaign once
            </button>
            <button className="secondary" onClick={() => setStep("individual")}>
              Review emails individually
            </button>
          </div>
        </>
      )}
      {(step === "individual" || step === "complete") && (
        <>
          <label>
            Campaign name
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={160}
            />
          </label>
          <label>
            Sending Gmail account
            <select
              value={account}
              disabled={busy}
              onChange={(e) => setAccount(e.target.value)}
            >
              <option value="">Choose connected Gmail</option>
              {connections
                .filter(
                  (c) => c.provider === "gmail" && c.status === "connected",
                )
                .map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.address}
                  </option>
                ))}
            </select>
          </label>
          <div className="campaign-summary">
            <strong>
              {included.length} initial emails +{" "}
              {included.reduce(
                (count, draft) => count + followupCount(draft),
                0,
              )}{" "}
              exact conditional follow-ups
            </strong>
            <p>
              Maximum authorized emails:{" "}
              {included.length +
                included.reduce(
                  (count, draft) => count + followupCount(draft),
                  0,
                )}
              . Excluded recipients: {excluded.length}. Each approval explicitly
              authorizes both categories displayed here.
            </p>
          </div>
          <button
            className="text-link"
            disabled={busy}
            onClick={() =>
              setStep(step === "individual" ? "complete" : "individual")
            }
          >
            {step === "individual"
              ? "Switch to complete campaign review"
              : "Switch to individual review"}
          </button>
          <section className="review-stage" id="campaign-review-stage-3" onFocusCapture={()=>setReviewStage(3)}><h3>3. Review emails</h3><p>Check each professor, message, follow-up rule and scheduled timezone.</p>{drafts.map((d) => preview(d, step === "individual"))}<button type="button" className="secondary" onClick={()=>{setReviewStage(4);document.getElementById('campaign-review-stage-4')?.scrollIntoView({block:'start'});}}>Continue to documents</button></section>
          <section className="review-stage" id="campaign-review-stage-4" onFocusCapture={()=>setReviewStage(4)}><h3>4. Attach documents</h3><p>Choose your CV and any supported documents. Follow-up attachments are separate choices.</p><EmailAttachments documents={documents} value={attachmentSelection} onChange={setAttachmentSelection} steps={Math.max(0, ...included.map(followupCount))} recipients={included} busy={busy}/><button type="button" className="secondary" onClick={()=>{setReviewStage(5);document.getElementById('campaign-review-stage-5')?.scrollIntoView({block:'start'});}}>Continue to final review</button></section>
          <section className="review-stage final-review" id="campaign-review-stage-5" onFocusCapture={()=>setReviewStage(5)}><h3>5. Review and approve</h3><p><strong>{name}</strong> / {included.length} initial emails / {included.reduce((count,draft)=>count+followupCount(draft),0)} conditional follow-ups. Review the sender, attachments and all local / UTC dates above before approval.</p>{missingDocuments.length>0&&<div className="feedback error"><strong>No documents attached</strong><p>{missingDocuments.length} of {included.length} initial emails have no attachments.</p><p>{missingDocuments.map(d=>d.professor_name).join(', ')}</p><button type="button" onClick={()=>document.getElementById('campaign-review-stage-4')?.scrollIntoView({block:'start'})}>Attach Documents</button></div>}{!included.length&&<p role="alert">No eligible emails remain. Review the exclusion reasons above, change your selection, or start a new campaign with a fresh import.</p>}</section>
          {step === "complete" && (
            <button
              className="primary full"
              disabled={
                busy ||
                !account ||
                !included.length ||
                included.some((d) => !!d.followup_issue)
              }
              onClick={() => run(() => approve(included, true))}
            >
              Approve Complete Campaign
            </button>
          )}
          <p className="helper">
            Approval authorizes the included initial emails and their exact
            displayed conditional follow-ups. Existing verification, mailbox
            readiness and recipient safety checks apply. No further Outreach
            approval is required.
          </p>
        </>
      )}
      {step === "success" && receipt && (
        <>
          <h3>{receipt.name}</h3>
          <p>Campaign reference: {receipt.campaign_id}</p>
          <p>
            {receipt.scheduled} approved recipients · {receipt.scheduled}{" "}
            scheduled initial emails · {receipt.authorized_followups} authorized
            conditional follow-ups
          </p>
          <p>Gmail: {receipt.gmail}</p>
          <p>
            Earliest send: {receipt.earliest}
            <br />
            Latest send: {receipt.latest}
          </p>
          <p>
            Your campaign approval and schedule were saved successfully. No further
            approval is required.
          </p>
          <details>
            <summary>View campaign / View scheduled emails</summary>
            {drafts
              .filter((d) => receipt.ids.includes(d.id))
              .map((d) => (
                <p key={d.id}>
                  {d.professor_email} · {d.subject} · {d.scheduled_at}
                </p>
              ))}
          </details>
          <p role="status">
            {receipt.cancelled
              ? "Future messages cancelled. Previously delivered mail is retained."
              : ""}
          </p>
          <button
            className="secondary"
            disabled={busy || receipt.cancelled}
            onClick={() =>
              run(async () => {
                await api(`/campaigns/${receipt.campaign_id}/cancel`, "POST");
                await onRefresh();
                setReceipt({ ...receipt, cancelled: true });
              })
            }
          >
            Cancel future messages
          </button>
        </>
      )}
    </section>
  );
}
