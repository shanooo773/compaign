"use client";
export type CampaignDocument = {
  id: string;
  name: string;
  size: number;
  content_type: string;
  expires_at?: number | null;
  retained_until?: number | null;
};
type Selection = { initial: string[]; followups: Record<string, string[]> };
export type AttachmentChoice = Selection & {
  recipients: Record<string, Selection>;
};
export function EmailAttachments({
  documents,
  value,
  onChange,
  steps,
  recipients,
  busy,
}: {
  documents: CampaignDocument[];
  value: AttachmentChoice;
  onChange: (value: AttachmentChoice) => void;
  steps: number;
  recipients: { id: string; professor_name: string; professor_email: string }[];
  busy: boolean;
}) {
  const toggle = (ids: string[], id: string) =>
    ids.includes(id) ? ids.filter((item) => item !== id) : [...ids, id];
  const available = (doc: CampaignDocument) =>
    (doc.expires_at == null
      ? Infinity
      : Math.max(doc.expires_at, doc.retained_until || 0)) > Date.now();
  const type = (doc: CampaignDocument) =>
    doc.content_type === "application/pdf"
      ? "PDF"
      : doc.content_type === "text/plain"
        ? "TXT"
        : "DOCX";
  const updateFollowup = (step: string, ids: string[]) => {
    const followups = { ...value.followups, [step]: ids };
    onChange({
      ...value,
      followups,
      recipients: Object.fromEntries(
        Object.entries(value.recipients).map(([id, selection]) => [
          id,
          { ...selection, followups },
        ]),
      ),
    });
  };
  return (
    <section
      className="attachment-panel"
      aria-labelledby="campaign-attachments-title"
    >
      <div className="panel-heading">
        <div>
          <span className="eyebrow">YOUR ACADEMIC STORY, ATTACHED</span>
          <h3 id="campaign-attachments-title">Email Attachments</h3>
        </div>
        <span className="badge">{documents.length} private documents</span>
      </div>
      <p>
        Select your CV or supporting files. By default, selected documents go on
        initial emails only. They are sent as actual email attachments.
      </p>
      {!documents.length ? (
        <div className="attachment-empty">
          <strong>No eligible documents yet</strong>
          <p>
            Upload your CV in Documents, then return to review. Your campaign
            remains an unapproved draft.
          </p>
        </div>
      ) : (
        <div className="attachment-grid">
          {documents.map((doc) => (
            <label className="attachment-option" key={doc.id}>
              <input
                type="checkbox"
                aria-label={`Attach ${doc.name} to initial emails`}
                checked={value.initial.includes(doc.id)}
                disabled={busy || !available(doc)}
                onChange={() =>
                  onChange({ ...value, initial: toggle(value.initial, doc.id) })
                }
              />
              <span>
                <strong>{doc.name}</strong>
                <small>
                  {type(doc)} � {(doc.size / 1024).toFixed(1)} KiB
                </small>
                <small>
                  {available(doc)
                    ? "Ready  availability checked before approval"
                    : "Expired �w^~)�t upload again"}
                </small>
              </span>
            </label>
          ))}
        </div>
      )}
      <p className="helper">
        Up to 3 distinct documents per campaign; 2 MiB total per message.
        Required files stay private and are retained for the approved campaign
        and retries. Missing files block sending.
      </p>
      {steps > 0 && documents.length > 0 && (
        <details className="attachment-followups">
          <summary>Optional: attach documents to selected follow-ups</summary>
          <p>
            Leave these unchecked for initial emails only. Choices apply only to
            follow-ups defined for each recipient.
          </p>
          {Array.from({ length: steps }, (_, index) => {
            const step = String(index + 1);
            return (
              <fieldset key={step}>
                <legend>Follow-up {step}</legend>
                <div className="attachment-grid">
                  {documents.map((doc) => (
                    <label className="checkbox-label" key={doc.id}>
                      <input
                        type="checkbox"
                        aria-label={`Attach ${doc.name} to follow-up ${step}`}
                        checked={(value.followups[step] || []).includes(doc.id)}
                        disabled={busy || !available(doc)}
                        onChange={() =>
                          updateFollowup(
                            step,
                            toggle(value.followups[step] || [], doc.id),
                          )
                        }
                      />
                      {doc.name}
                    </label>
                  ))}
                </div>
              </fieldset>
            );
          })}
        </details>
      )}
      {documents.length > 0 && recipients.length > 1 && (
        <details>
          <summary>
            Optional: different initial attachments by professor
          </summary>
          {recipients.map((recipient) => {
            const selected =
              value.recipients[recipient.id]?.initial || value.initial;
            return (
              <fieldset key={recipient.id}>
                <legend>
                  {recipient.professor_name} � {recipient.professor_email}
                </legend>
                <div className="attachment-grid">
                  {documents.map((doc) => (
                    <label className="checkbox-label" key={doc.id}>
                      <input
                        type="checkbox"
                        aria-label={`Attach ${doc.name} to ${recipient.professor_email} initial email`}
                        disabled={busy || !available(doc)}
                        checked={selected.includes(doc.id)}
                        onChange={() =>
                          onChange({
                            ...value,
                            recipients: {
                              ...value.recipients,
                              [recipient.id]: {
                                initial: toggle(selected, doc.id),
                                followups: value.followups,
                              },
                            },
                          })
                        }
                      />
                      {doc.name}
                    </label>
                  ))}
                </div>
                {value.recipients[recipient.id] && (
                  <button
                    type="button"
                    className="text-link"
                    disabled={busy}
                    onClick={() => {
                      const recipients = { ...value.recipients };
                      delete recipients[recipient.id];
                      onChange({ ...value, recipients });
                    }}
                  >
                    Use campaign defaults
                  </button>
                )}
              </fieldset>
            );
          })}
        </details>
      )}
    </section>
  );
}
