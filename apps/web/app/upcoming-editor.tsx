"use client";
import { useEffect, useState } from "react";
import { Dialog } from "./ui";
import { formatSchedule } from "./campaign-model";
import { localDate, zonedISO } from "../lib/timezone";
type Api = (path: string, method?: string, data?: unknown) => Promise<any>;
export function UpcomingEditor({
  campaign,
  api,
  documents,
  onClose,
  onSaved,
}: {
  campaign: string;
  api: Api;
  documents: any[];
  onClose: () => void;
  onSaved: () => Promise<void>;
}) {
  const [view, setView] = useState<any>(null),
    [edits, setEdits] = useState<Record<string, any>>({}),
    [selected, setSelected] = useState<string[]>([]),
    [review, setReview] = useState<any>(null),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [confirmed, setConfirmed] = useState(false),
    [without, setWithout] = useState(false);
  useEffect(() => {
    let live = true;
    api(`/campaigns/${campaign}/upcoming`)
      .then((v) => {
        if (live) setView(v);
      })
      .catch((e) => {
        if (live) setError(e.message);
      });
    return () => {
      live = false;
    };
  }, [campaign]);
  const update = (row: any, key: string, value: any) => {
    setReview(null);
    setConfirmed(false);
    setWithout(false);
    setEdits((prev) => ({
      ...prev,
      [row.id]: {
        ...(prev[row.id] || {
          id: row.id,
          expected: row.expected,
          subject: row.subject,
          body: row.body,
          attachments: row.attachments.map((d: any) => d.id),
          scheduled_at: row.scheduled_at,
        }),
        [key]: value,
      },
    }));
  };
  const changes = () =>
    selected.map(
      (id) =>
        edits[id] ||
        (() => {
          const row = view.items.find((r: any) => r.id === id);
          return {
            id,
            expected: row.expected,
            subject: row.subject,
            body: row.body,
            attachments: row.attachments.map((d: any) => d.id),
            scheduled_at: row.scheduled_at,
          };
        })(),
    );
  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    setError("");
    try {
      await fn();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const names = (ids: string[]) =>
    ids
      .map(
        (id) =>
          documents.find((d) => d.id === id)?.name ||
          view?.items
            .flatMap((r: any) => r.attachments)
            .find((d: any) => d.id === id)?.name ||
          "Unavailable document",
      )
      .join(", ") || "None";
  return (
    <Dialog title="Edit Upcoming Emails" busy={busy} onClose={onClose}>
      <p>
        Only selected future unsent emails receive these changes. Sent email
        history and previous immutable approvals are retained. Emails due within
        two minutes, claimed for sending, cancelled, or protected by a reply are
        locked.
      </p>
      {!view && !error && <p>Loading upcoming emails?</p>}
      {view && !review && (
        <>
          {view.items.map((row: any) => {
            const edit = edits[row.id] || {
              ...row,
              attachments: row.attachments.map((d: any) => d.id),
            };
            return (
              <section className="panel" key={row.id}>
                <h3>
                  {row.professor_name} ?{" "}
                  {row.kind === "initial" ? "Initial email" : "Follow-up"}
                </h3>
                <p>
                  {row.recipient} ?{" "}
                  {formatSchedule(row.scheduled_at, row.timezone)}
                </p>
                {!row.editable ? (
                  <>
                    <strong>{row.reason}</strong>
                    <details>
                      <summary>Read approved content</summary>
                      <p>{row.subject}</p>
                      <pre style={{ whiteSpace: "pre-wrap" }}>{row.body}</pre>
                      <p>
                        Attachments:{" "}
                        {names(row.attachments.map((d: any) => d.id))}
                      </p>
                    </details>
                  </>
                ) : (
                  <>
                    <label>
                      <input
                        type="checkbox"
                        checked={selected.includes(row.id)}
                        onChange={(e) => {
                          setSelected((prev) =>
                            e.target.checked
                              ? [...prev, row.id]
                              : prev.filter((id) => id !== row.id),
                          );
                          setReview(null);
                        }}
                      />
                      Revise this{" "}
                      {row.kind === "initial" ? "initial email" : "follow-up"}{" "}
                      for {row.professor_name}
                    </label>
                    <fieldset disabled={busy || !selected.includes(row.id)}>
                      <label>
                        Subject
                        <input
                          aria-label={`Revision subject ${row.id}`}
                          maxLength={500}
                          value={edit.subject}
                          onChange={(e) =>
                            update(row, "subject", e.target.value)
                          }
                        />
                      </label>
                      <label>
                        Email body
                        <textarea
                          aria-label={`Revision body ${row.id}`}
                          value={edit.body}
                          rows={7}
                          maxLength={20000}
                          onChange={(e) => update(row, "body", e.target.value)}
                        />
                      </label>
                      <fieldset className="attachment-panel">
                        <legend>Selected CV and documents</legend>
                        {documents.map((doc) => (
                          <label key={doc.id}>
                            <input
                              type="checkbox"
                              checked={edit.attachments.includes(doc.id)}
                              onChange={(e) =>
                                update(
                                  row,
                                  "attachments",
                                  e.target.checked
                                    ? [...edit.attachments, doc.id]
                                    : edit.attachments.filter(
                                        (id: string) => id !== doc.id,
                                      ),
                                )
                              }
                            />
                            {doc.name}
                          </label>
                        ))}
                        {!documents.length && (
                          <p>
                            Upload documents in Documents, then reopen this
                            editor. Closing discards only this unapproved
                            revision form.
                          </p>
                        )}
                      </fieldset>
                      <label>
                        Future sending time ({row.timezone})
                        <input
                          aria-label={`Revision schedule ${row.id}`}
                          type="datetime-local"
                          value={
                            edit.scheduled_at
                              ? localDate(
                                  row.timezone,
                                  new Date(edit.scheduled_at),
                                )
                              : ""
                          }
                          onChange={(e) => {
                            try {
                              update(
                                row,
                                "scheduled_at",
                                e.target.value
                                  ? zonedISO(e.target.value, row.timezone, true)
                                  : null,
                              );
                              setError("");
                            } catch (error) {
                              setError((error as Error).message);
                            }
                          }}
                        />
                      </label>
                      <p>
                        UTC:{" "}
                        {edit.scheduled_at ||
                          "Conditional: after the prior confirmed delivery under the approved rule."}{" "}
                        Existing times remain unchanged unless you edit this
                        field. Other follow-ups keep their approved timing
                        rules.
                      </p>
                    </fieldset>
                  </>
                )}
              </section>
            );
          })}
          <button
            className="primary"
            disabled={busy || !selected.length || selected.length > 25}
            onClick={() =>
              run(async () => {
                setReview(
                  await api(`/campaigns/${campaign}/upcoming`, "POST", {
                    changes: changes(),
                    dry_run: true,
                  }),
                );
                setConfirmed(false);
                setWithout(false);
              })
            }
          >
            Review {selected.length} selected revisions
          </button>
        </>
      )}
      {review && (
        <>
          <h3>Review original and revised values</h3>
          <p>
            {review.initial_count} upcoming initial emails and{" "}
            {review.followup_count} follow-ups will be updated. Each revised
            email receives a new immutable approval version.
          </p>
          {review.plans.map((plan: any) => {
            const revised = JSON.parse(plan.snapshot),
              old = plan.original;
            return (
              <section className="panel" key={plan.id}>
                <h3>
                  {old.professor_name} ? {old.kind}
                </h3>
                <table>
                  <thead>
                    <tr>
                      <th>Field</th>
                      <th>Currently approved</th>
                      <th>Revised</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr>
                      <th>Subject</th>
                      <td>{old.subject}</td>
                      <td>{revised.subject}</td>
                    </tr>
                    <tr>
                      <th>Body</th>
                      <td style={{ whiteSpace: "pre-wrap" }}>{old.body}</td>
                      <td style={{ whiteSpace: "pre-wrap" }}>{revised.body}</td>
                    </tr>
                    <tr>
                      <th>Documents</th>
                      <td>{names(old.attachments.map((d: any) => d.id))}</td>
                      <td>
                        {names(revised.attachments.map((d: any) => d.id))}
                      </td>
                    </tr>
                    <tr>
                      <th>Schedule</th>
                      <td>{formatSchedule(old.scheduled_at, old.timezone)}</td>
                      <td>
                        {formatSchedule(plan.scheduled_at, plan.timezone)}
                      </td>
                    </tr>
                  </tbody>
                </table>
              </section>
            );
          })}
          {review.missing_attachments.length > 0 && (
            <div className="feedback error">
              <h3>No documents attached</h3>
              <p>
                {review.missing_attachments.length} revised initial emails have
                no attachments.
              </p>
              {review.missing_attachments.map((r: any) => (
                <p key={r.address}>{r.address}</p>
              ))}
              <button onClick={() => setReview(null)}>Attach Documents</button>
              <label>
                <input
                  type="checkbox"
                  checked={without}
                  onChange={(e) => setWithout(e.target.checked)}
                />
                Continue Without Attachments ? I explicitly confirm these
                initial emails may have no documents.
              </label>
            </div>
          )}
          <label>
            <input
              type="checkbox"
              checked={confirmed}
              onChange={(e) => setConfirmed(e.target.checked)}
            />
            I approve changes to exactly {review.initial_count} initial emails
            and {review.followup_count} follow-ups.
          </label>
          <div className="dialog-actions">
            <button disabled={busy} onClick={() => setReview(null)}>
              Back to editing
            </button>
            <button
              className="primary"
              disabled={
                busy ||
                !confirmed ||
                (review.missing_attachments.length > 0 && !without)
              }
              onClick={() =>
                run(async () => {
                  await api(`/campaigns/${campaign}/upcoming`, "POST", {
                    changes: changes(),
                    confirmed: true,
                    without_attachments_acknowledged: without,
                  });
                  await onSaved();
                  onClose();
                })
              }
            >
              Approve Upcoming Changes
            </button>
          </div>
        </>
      )}
      {error && (
        <p role="alert" className="feedback error">
          {error}
        </p>
      )}
    </Dialog>
  );
}
