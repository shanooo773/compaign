"use client";
import { UpcomingEditor } from "./upcoming-editor";
import { useEffect, useMemo, useState } from "react";
import {
  ArrowLeft,
  ArrowRight,
  MoreHorizontal,
  Search,
  Archive,
  Trash2,
  Pencil,
  RotateCcw,
  CalendarClock,
  Mail,
  Users,
  ShieldCheck,
} from "lucide-react";
import {
  campaignModels,
  draftGroups,
  formatSchedule,
  confirmed,
  statusName,
} from "./campaign-model";
import { Badge, Dialog, EmptyState } from "./ui";
type Props = {
  api: (path: string, method?: string, data?: unknown) => Promise<any>;
  onSaved: () => Promise<void>;
  removeDraft: (ids: string[], name: string) => Promise<void>;
  state: any;
  focus: string | null;
  onOpen: (id: string | null) => void;
  rename: (id: string, name: string) => Promise<void>;
  openControls: () => void;
  activity: (id: string, before?: number) => Promise<any>;
  archive: (id: string, restore: boolean) => Promise<void>;
  remove: (id: string, name: string) => Promise<void>;
  tab: string;
  onTabChange: (tab: string) => void;
};
export function CampaignDirectory({
  api,
  onSaved,
  removeDraft,
  state,
  focus,
  onOpen,
  rename,
  openControls,
  activity,
  archive,
  remove,
  tab,
  onTabChange,
}: Props) {
  const [search, setSearch] = useState(""),
    [filter, setFilter] = useState("all"),
    [newName, setNewName] = useState(""),
    [error, setError] = useState("");
  const [dialog, setDialog] = useState<
      "rename" | "archive" | "delete" | "upcoming" | "cancel" | null
    >(null),
    [deleteName, setDeleteName] = useState(""),
    [busy, setBusy] = useState(false);
  const [events, setEvents] = useState<any[]>([]),
    [cursor, setCursor] = useState<number | undefined>(),
    [more, setMore] = useState(false),
    [loading, setLoading] = useState(false);
  const campaigns = useMemo(() => campaignModels(state), [state]);
  const groups = useMemo(() => draftGroups(state), [state]);
  const active = campaigns.find((c: any) => c.id === focus),
    draft = groups.find((g) => g.id === focus);
  useEffect(() => {
    setEvents([]);
    setCursor(undefined);
    setMore(false);
    setDialog(null);
    setError("");
  }, [focus]);
  useEffect(() => {
    let live = true;
    if (!active || tab !== "Activity") return;
    setLoading(true);
    activity(active.id)
      .then((result) => {
        if (live) {
          setEvents(result.activity);
          setCursor(result.next_cursor);
          setMore(result.has_more);
        }
      })
      .catch((error) => {
        if (live) setError(error.message);
      })
      .finally(() => {
        if (live) setLoading(false);
      });
    return () => {
      live = false;
    };
  }, [focus, tab]);
  const run = async (action: () => Promise<void>) => {
    setBusy(true);
    setError("");
    try {
      await action();
      setDialog(null);
    } catch (error) {
      setError((error as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const choose = (
    event: React.MouseEvent<HTMLButtonElement>,
    value: "rename" | "archive" | "delete",
  ) => {
    const menu = event.currentTarget.closest("details");
    menu?.removeAttribute("open");
    menu?.querySelector("summary")?.focus();
    setNewName(active?.name || "");
    setDeleteName("");
    setDialog(value);
  };
  if (focus) {
    if (!active)
      return (
        <section className="panel campaign-workspace">
          <button className="text-link" onClick={() => onOpen(null)}>
            <ArrowLeft size={15} />
            All campaigns
          </button>
          <div className="section-heading">
            <div>
              <h2>
                {draft
                  ? "Draft campaign for " + draft.rows[0]?.professor_name
                  : "Campaign unavailable"}
              </h2>
              <p>
                {draft
                  ? `${draft.rows.length} professors. Review your email content, documents and schedule below. Nothing sends until you approve.`
                  : "Return to campaigns to choose a workspace you can access."}
              </p>
            </div>
            <Badge status="draft" />
          </div>
          {draft && (
            <>
              <button
                className="danger"
                disabled={busy}
                onClick={() => setDialog("delete")}
              >
                Delete Draft
              </button>
              {dialog === "delete" && (
                <Dialog
                  title="Delete Draft"
                  busy={busy}
                  danger
                  onClose={() => setDialog(null)}
                >
                  <h3>
                    Delete Draft campaign for {draft.rows[0]?.professor_name}?
                  </h3>
                  <p>
                    This deletes only this unapproved draft and its document
                    selections. Your documents remain available, including files
                    shared by other campaigns.
                  </p>
                  <div className="dialog-actions">
                    <button disabled={busy} onClick={() => setDialog(null)}>
                      Keep draft
                    </button>
                    <button
                      className="danger"
                      disabled={busy}
                      onClick={() =>
                        run(async () => {
                          await removeDraft(
                            draft.rows.map((m: any) => m.id),
                            "Draft campaign for " +
                              draft.rows[0].professor_name,
                          );
                          onOpen(null);
                        })
                      }
                    >
                      Confirm Delete Draft
                    </button>
                  </div>
                  {error && <p role="alert">{error}</p>}
                </Dialog>
              )}
            </>
          )}
        </section>
      );
    const timeline = [
      ...active.initial.map((m: any) => ({
        id: m.id,
        name: m.professor_name,
        title: "Initial email",
        date: m.scheduled_at,
        zone: m.timezone,
        status: m.status,
      })),
      ...active.steps.map((f: any) => {
        const root = active.rows.find((m: any) => m.id === f.root_id),
          child = active.rows.find((m: any) => m.id === f.child_id);
        return {
          id: f.child_id,
          name: root?.professor_name,
          title: "Follow-up " + f.step,
          date: f.due_at,
          zone: root?.timezone,
          status: f.cancel_reason
            ? "cancelled"
            : child?.status || "conditional",
          rule: `${f.delay_value} ${f.delay_unit} after ${f.relative_to === "original" ? "the initial email" : "the previous email"}, only if no reply`,
        };
      }),
      ...active.legacy.map((a: any) => ({
        id: a.message_id + ":legacy",
        name: active.rows.find((m: any) => m.id === a.message_id)
          ?.professor_name,
        title: "Follow-up",
        date: a.due_at,
        zone: active.rows.find((m: any) => m.id === a.message_id)?.timezone,
        status: a.cancel_reason ? "cancelled" : "conditional",
        rule: `${a.days} days after confirmed initial delivery, only if no reply`,
      })),
    ].sort(
      (a: any, b: any) =>
        (a.date == null ? Infinity : new Date(a.date).getTime()) -
        (b.date == null ? Infinity : new Date(b.date).getTime()),
    );
    const locations = (state.reply_locations || []).filter((r: any) =>
      active.rows.some((m: any) => m.id === r.message_id),
    );
    const replied = active.initial.filter(
      (m: any) =>
        m.status === "replied" ||
        locations.some((r: any) => r.message_id === m.id),
    );
    const readableAction = (action: string) =>
      ({
        "provider.sent_confirmed": "Email delivery confirmed",
        "campaign.renamed": "Campaign renamed",
        "campaign.archived": "Campaign archived",
        "campaign.restored": "Campaign restored",
        "campaign.cancelled": "Campaign cancelled",
        "campaign.approved": "Campaign approved",
        "sequence.step_queued": "Follow-up scheduled",
        "campaign.duplicate_override":
          "Previously contacted recipients acknowledged",
        "notification.reply": "Professor reply recorded",
      })[action] || action.replaceAll(".", " ").replaceAll("_", " ");
    return (
      <div className="campaign-workspace">
        <div className="campaign-meta">
          <button className="text-link" onClick={() => onOpen(null)}>
            <ArrowLeft size={15} />
            All campaigns
          </button>
          <Badge status={active.archived_at ? "archived" : active.status} />
          <span>
            Created{" "}
            {new Date(active.approved_at).toLocaleDateString(undefined, {
              month: "short",
              day: "numeric",
              year: "numeric",
            })}
          </span>
          <span>{active.initial_count} professors</span>
          <details
            className="context-menu"
            onKeyDown={(event) => {
              if (event.key === "Escape") {
                event.currentTarget.removeAttribute("open");
                event.currentTarget.querySelector("summary")?.focus();
              }
            }}
          >
            <summary>
              Campaign actions <MoreHorizontal size={17} />
            </summary>
            <div className="context-menu-content">
              <button onClick={(event) => choose(event, "rename")}>
                <Pencil size={16} />
                Rename campaign
              </button>
              {active.archived_at ? (
                <button
                  disabled={busy}
                  onClick={(event) => {
                    event.currentTarget
                      .closest("details")
                      ?.removeAttribute("open");
                    run(() => archive(active.id, true));
                  }}
                >
                  <RotateCcw size={16} />
                  Restore Campaign
                </button>
              ) : (
                <button
                  disabled={busy || !active.can_archive}
                  onClick={(event) => choose(event, "archive")}
                >
                  <Archive size={16} />
                  Archive Campaign
                </button>
              )}
              {["scheduled", "active"].includes(active.status) && (
                <>
                  <button
                    onClick={(event) => {
                      event.currentTarget
                        .closest("details")
                        ?.removeAttribute("open");
                      setDialog("upcoming");
                    }}
                  >
                    <Pencil size={16} />
                    Edit Upcoming Emails
                  </button>
                  <button
                    className="destructive-text"
                    onClick={(event) => {
                      event.currentTarget
                        .closest("details")
                        ?.removeAttribute("open");
                      setDialog("cancel");
                    }}
                  >
                    Cancel Remaining
                  </button>
                </>
              )}
              <button onClick={openControls}>
                <CalendarClock size={16} />
                Sending and follow-up controls
              </button>
              <hr />
              <button
                className="destructive-text"
                disabled={busy || !active.can_archive}
                onClick={(event) => choose(event, "delete")}
              >
                <Trash2 size={16} />
                Delete Permanently
              </button>
              {!active.can_archive && (
                <p>
                  Resolve pending work and uncertain deliveries before archiving
                  or deleting. These actions never cancel sending.
                </p>
              )}
            </div>
          </details>
        </div>
        <div
          role="tablist"
          aria-label="Campaign workspace"
          className="view-tabs detail-tabs"
        >
          {["Overview", "Professors", "Schedule", "Replies", "Activity"].map(
            (name) => (
              <button
                key={name}
                role="tab"
                aria-selected={tab === name}
                id={"campaign-tab-" + name}
                aria-controls="campaign-tab-content"
                onKeyDown={(event) => {
                  if (
                    ["ArrowLeft", "ArrowRight", "Home", "End"].includes(
                      event.key,
                    )
                  ) {
                    event.preventDefault();
                    const values = [
                        "Overview",
                        "Professors",
                        "Schedule",
                        "Replies",
                        "Activity",
                      ],
                      index = values.indexOf(tab);
                    const next =
                      event.key === "Home"
                        ? values[0]
                        : event.key === "End"
                          ? values[4]
                          : values[
                              (index + (event.key === "ArrowRight" ? 1 : 4)) % 5
                            ];
                    onTabChange(next);
                    document.getElementById("campaign-tab-" + next)?.focus();
                  }
                }}
                tabIndex={tab === name ? 0 : -1}
                onClick={() => onTabChange(name)}
              >
                {name}
              </button>
            ),
          )}
        </div>
        {error && (
          <p role="alert" className="feedback error">
            {error}
          </p>
        )}
        <section
          id="campaign-tab-content"
          role="tabpanel"
          aria-labelledby={"campaign-tab-" + tab}
          className="campaign-tab-content"
        >
          {tab === "Overview" && (
            <>
              <div className="campaign-summary-grid">
                {[
                  ["Professors", active.initial_count],
                  ["Initial emails sent", active.sent],
                  ["Replies", active.replies],
                  ["Follow-ups remaining", active.followups],
                ].map(([name, value]) => (
                  <div key={String(name)}>
                    <small>{name}</small>
                    <strong>{value}</strong>
                  </div>
                ))}
              </div>
              <div className="dashboard-columns">
                <section className="panel">
                  <div className="section-heading">
                    <h2>Next scheduled action</h2>
                    <CalendarClock size={18} />
                  </div>
                  <div className="panel-body">
                    <strong>
                      {active.next
                        ? formatSchedule(active.next, state.profile.timezone)
                        : active.followups
                          ? "Waiting for a confirmed email"
                          : "No pending actions"}
                    </strong>
                    <p>
                      {active.followups
                        ? "Follow-ups remain conditional on no reply. Safety checks can postpone delivery."
                        : "Your sending history remains available in this campaign."}
                    </p>
                    <button
                      className="text-link"
                      onClick={() => onTabChange("Schedule")}
                    >
                      View schedule <ArrowRight size={15} />
                    </button>
                  </div>
                </section>
                <section className="panel">
                  <div className="section-heading">
                    <h2>Approved and protected</h2>
                    <ShieldCheck size={18} />
                  </div>
                  <div className="panel-body">
                    <p>
                      Original approval records stay immutable. Future unsent
                      emails can use a separately reviewed and approved
                      revision. Review each professor and message from the
                      Professors tab.
                    </p>
                    <button
                      className="text-link"
                      onClick={() => onTabChange("Professors")}
                    >
                      View professors <ArrowRight size={15} />
                    </button>
                  </div>
                </section>
              </div>
              {locations
                .filter((r: any) => ["Spam", "Trash"].includes(r.location))
                .map((r: any) => (
                  <div
                    key={r.provider_id || r.message_id}
                    className="inline-alert location-warning"
                  >
                    <Mail size={18} />
                    <div>
                      <strong>Reply received in {r.location}</strong>
                      <p>
                        Check this folder in your connected Gmail. Remaining
                        eligible follow-ups have stopped.
                      </p>
                    </div>
                    <button
                      className="text-link"
                      onClick={() => onTabChange("Replies")}
                    >
                      View reply
                    </button>
                  </div>
                ))}
            </>
          )}
          {tab === "Professors" && (
            <div className="section-heading">
              <div>
                <h2>Professors and email review</h2>
                <p>
                  Search recipients, inspect approved messages and see their
                  sending status below.
                </p>
              </div>
            </div>
          )}
          {tab === "Schedule" && (
            <section className="panel">
              <div className="section-heading">
                <div>
                  <h2>Campaign timeline</h2>
                  <p>
                    Each time includes its scheduled timezone. Conditional dates
                    appear after delivery is confirmed.
                  </p>
                </div>
              </div>
              {timeline.length ? (
                <ol className="schedule-timeline">
                  {timeline.map((item: any) => (
                    <li key={item.id}>
                      <span className="timeline-dot" />
                      <div>
                        <span className="section-kicker">{item.title}</span>
                        <strong>{item.name}</strong>
                        <p>{formatSchedule(item.date, item.zone || "UTC")}</p>
                        {item.date && item.zone !== state.profile.timezone && (
                          <small>
                            Your time:{" "}
                            {formatSchedule(item.date, state.profile.timezone)}
                          </small>
                        )}
                        {item.rule && <small>{item.rule}</small>}
                      </div>
                      <Badge status={item.status} />
                    </li>
                  ))}
                </ol>
              ) : (
                <EmptyState
                  title="No scheduled activity"
                  description="Your approved schedule will appear here."
                />
              )}
            </section>
          )}
          {tab === "Replies" && (
            <section className="panel">
              <div className="section-heading">
                <h2>Professor replies</h2>
                <Mail size={18} />
              </div>
              {replied.length ? (
                replied.map((m: any) => {
                  const location =
                    locations.find((r: any) => r.message_id === m.id) ||
                    locations.find((r: any) =>
                      active.steps.some(
                        (f: any) =>
                          f.root_id === m.id && f.child_id === r.message_id,
                      ),
                    );
                  return (
                    <article
                      className={
                        "activity-item" +
                        (["Spam", "Trash"].includes(location?.location)
                          ? " location-warning"
                          : "")
                      }
                      key={m.id}
                    >
                      <Mail size={18} />
                      <div>
                        <strong>{m.professor_name}</strong>
                        <small>{active.name}</small>
                        <p>
                          {location
                            ? "Reply in " + location.location
                            : "Reply recorded"}
                        </p>
                        <small>
                          Received date:{" "}
                          {location?.received_at
                            ? formatSchedule(
                                location.received_at,
                                state.profile.timezone,
                              )
                            : "not supplied by the current workspace data"}
                        </small>
                      </div>
                      <Badge status="replied" />
                    </article>
                  );
                })
              ) : (
                <EmptyState
                  title="No replies yet"
                  description="Replies from this campaign will appear here. Inbox replies are shown normally; Spam and Trash retain clear warnings."
                />
              )}
            </section>
          )}
          {tab === "Activity" && (
            <section className="panel">
              <div className="section-heading">
                <h2>Campaign activity</h2>
              </div>
              {loading ? (
                <p role="status" className="quiet-empty">
                  Loading activity...
                </p>
              ) : events.length ? (
                events
                  .filter(
                    (e) => !/^scheduler\.|^sync\.|^usage\./.test(e.action),
                  )
                  .map((event) => (
                    <div className="activity-item" key={event.id}>
                      <span className="timeline-dot" />
                      <div>
                        <strong>{readableAction(event.action)}</strong>
                        <small>
                          {formatSchedule(
                            event.created_at.includes("T")
                              ? event.created_at
                              : event.created_at.replace(" ", "T") + "Z",
                            state.profile.timezone,
                          )}
                        </small>
                      </div>
                    </div>
                  ))
              ) : (
                <div className="quiet-empty">
                  No campaign activity is available yet.
                </div>
              )}
              {more && (
                <div className="panel-body">
                  <button
                    className="secondary"
                    disabled={loading}
                    onClick={async () => {
                      setLoading(true);
                      try {
                        const result = await activity(active.id, cursor);
                        setEvents((previous) => [
                          ...previous,
                          ...result.activity,
                        ]);
                        setCursor(result.next_cursor);
                        setMore(result.has_more);
                      } catch (error) {
                        setError((error as Error).message);
                      } finally {
                        setLoading(false);
                      }
                    }}
                  >
                    Load earlier activity
                  </button>
                </div>
              )}
            </section>
          )}
        </section>
        {dialog === "cancel" && (
          <Dialog
            title="Cancel remaining campaign emails"
            busy={busy}
            danger
            onClose={() => setDialog(null)}
          >
            <h3>{active.name}</h3>
            <p>
              Cancel future unsent emails and conditional follow-ups? Already
              delivered emails cannot be recalled. Cancelled messages cannot be
              reactivated.
            </p>
            <button disabled={busy} onClick={() => setDialog(null)}>
              Keep scheduled
            </button>
            <button
              className="danger"
              disabled={busy}
              onClick={() =>
                run(async () => {
                  await api(`/campaigns/${active.id}/cancel`, "POST", {});
                  await onSaved();
                })
              }
            >
              Confirm Cancel Remaining
            </button>
            {error && <p role="alert">{error}</p>}
          </Dialog>
        )}
        {dialog === "upcoming" && (
          <UpcomingEditor
            campaign={active.id}
            api={api}
            documents={state.documents || []}
            onClose={() => setDialog(null)}
            onSaved={onSaved}
          />
        )}
        {dialog === "rename" && (
          <Dialog
            title="Rename campaign"
            busy={busy}
            onClose={() => setDialog(null)}
          >
            <form
              onSubmit={(event) => {
                event.preventDefault();
                run(() => rename(active.id, newName));
              }}
            >
              <label>
                Campaign name
                <input
                  value={newName}
                  maxLength={160}
                  required
                  onChange={(event) => setNewName(event.target.value)}
                />
              </label>
              <p>
                Only the display name changes. Approved messages and dates stay
                the same.
              </p>
              <div className="dialog-actions">
                <button
                  className="secondary"
                  type="button"
                  disabled={busy}
                  onClick={() => setDialog(null)}
                >
                  Cancel
                </button>
                <button className="primary" disabled={busy || !newName.trim()}>
                  Save name
                </button>
              </div>
            </form>
            {error && <p role="alert">{error}</p>}
          </Dialog>
        )}
        {dialog === "archive" && (
          <Dialog
            title="Confirm campaign archive"
            busy={busy}
            onClose={() => setDialog(null)}
          >
            <h3>Archive {active.name}?</h3>
            <p>
              This hides the campaign from the default view. Approved content,
              receipts, replies and duplicate-professor protection remain.
              Archiving does not free storage.
            </p>
            <div className="dialog-actions">
              <button
                className="secondary"
                disabled={busy}
                onClick={() => setDialog(null)}
              >
                Keep campaign
              </button>
              <button
                className="primary"
                disabled={busy}
                onClick={() => run(() => archive(active.id, false))}
              >
                Confirm Archive
              </button>
            </div>
            {error && <p role="alert">{error}</p>}
          </Dialog>
        )}
        {dialog === "delete" && (
          <Dialog
            title="Confirm permanent campaign deletion"
            busy={busy}
            danger
            onClose={() => setDialog(null)}
          >
            <h3>Delete {active.name} permanently?</h3>
            <p>
              This removes the campaign workspace, display-name edits,
              notifications and attachment associations. Unused files are queued
              for cleanup; shared files stay.
            </p>
            <div className="retention-notice">
              <strong>Audit records are retained</strong>
              <p>
                Immutable approvals and approved message content, sending
                receipts and attempts, recipient contact and reply history
                remain. These preserve duplicate-professor protection. This is
                not full account erasure. Gmail messages and your connection
                remain.
              </p>
            </div>
            <label>
              Type the exact campaign name
              <input
                aria-label="Campaign name confirmation"
                autoComplete="off"
                value={deleteName}
                onChange={(event) => setDeleteName(event.target.value)}
              />
            </label>
            <div className="dialog-actions">
              <button
                className="secondary"
                disabled={busy}
                onClick={() => setDialog(null)}
              >
                Keep campaign
              </button>
              <button
                className="danger"
                disabled={busy || deleteName !== active.name}
                onClick={() =>
                  run(async () => {
                    await remove(active.id, deleteName);
                    onOpen(null);
                  })
                }
              >
                Confirm permanent deletion
              </button>
            </div>
            {error && <p role="alert">{error}</p>}
          </Dialog>
        )}
      </div>
    );
  }
  const rows = campaigns.filter(
    (c: any) =>
      (filter === "archived"
        ? !!c.archived_at
        : !c.archived_at && (filter === "all" || filter === c.status)) &&
      c.name.toLowerCase().includes(search.toLowerCase()),
  );
  return (
    <div className="campaign-directory">
      <div className="directory-toolbar">
        <div className="view-tabs" aria-label="Campaign views">
          {["all", "active", "scheduled", "completed", "archived"].map(
            (value) => (
              <button
                key={value}
                aria-pressed={filter === value}
                onClick={() => setFilter(value)}
              >
                {value === "all" ? "All" : statusName(value)}
              </button>
            ),
          )}
        </div>
        <label className="more-views">
          <span className="sr-only">More campaign views</span>
          <select
            aria-label="More campaign views"
            value={["drafts", "cancelled"].includes(filter) ? filter : ""}
            onChange={(event) => setFilter(event.target.value || "all")}
          >
            <option value="">More views</option>
            <option value="drafts">Drafts</option>
            <option value="cancelled">Cancelled</option>
          </select>
        </label>
      </div>
      <div className="directory-search">
        <label className="search">
          <Search size={17} />
          <input
            aria-label="Search campaigns"
            placeholder="Search campaigns"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
        </label>
        <small>
          {filter === "drafts" ? groups.length : rows.length} campaigns
        </small>
      </div>
      <section className="panel">
        <div className="table-scroll">
          <table className="campaign-table">
            <thead>
              <tr>
                <th>Campaign</th>
                <th>Professors</th>
                <th>Sent</th>
                <th>Replies</th>
                <th>Next scheduled action</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {["all", "drafts"].includes(filter) &&
                groups
                  .filter((g) =>
                    ("Draft campaign " + g.rows[0]?.professor_name)
                      .toLowerCase()
                      .includes(search.toLowerCase()),
                  )
                  .map((g) => (
                    <tr key={g.id}>
                      <td>
                        <button
                          className="table-title"
                          onClick={() => onOpen(g.id)}
                        >
                          Draft campaign for{" "}
                          {g.rows[0]?.professor_name || "professors"}
                        </button>
                        <small>Ready for your review</small>
                      </td>
                      <td data-label="Professors">{g.rows.length}</td>
                      <td data-label="Sent">0</td>
                      <td data-label="Replies">0</td>
                      <td data-label="Next action">
                        <small>Review and approve to schedule</small>
                      </td>
                      <td data-label="Status">
                        <Badge status="draft" />
                      </td>
                    </tr>
                  ))}
              {rows.map((c: any) => (
                <tr key={c.id}>
                  <td>
                    <button
                      className="table-title"
                      onClick={() => onOpen(c.id)}
                    >
                      {c.name}
                    </button>
                    <small>
                      {new Date(c.approved_at).toLocaleDateString(undefined, {
                        month: "short",
                        day: "numeric",
                        year: "numeric",
                      })}
                    </small>
                  </td>
                  <td data-label="Professors">{c.initial_count}</td>
                  <td data-label="Sent">{c.sent}</td>
                  <td data-label="Replies">{c.replies}</td>
                  <td data-label="Next action">
                    <small>
                      {c.next
                        ? formatSchedule(c.next, state.profile.timezone)
                        : c.followups
                          ? "After confirmed delivery"
                          : "No pending actions"}
                    </small>
                  </td>
                  <td data-label="Status">
                    <Badge status={c.archived_at ? "archived" : c.status} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {!rows.length &&
          (!["all", "drafts"].includes(filter) || !groups.length) && (
            <EmptyState
              title={
                search
                  ? "No matching campaigns"
                  : filter === "archived"
                    ? "No archived campaigns"
                    : "No campaigns in this view"
              }
              description={
                search
                  ? "Try another campaign name."
                  : "Create a campaign or choose another view to continue."
              }
            />
          )}
      </section>
      <details className="storage-details">
        <summary>Campaign and storage management</summary>
        <p>
          {
            campaigns.filter(
              (c: any) =>
                !c.archived_at && ["active", "scheduled"].includes(c.status),
            ).length
          }{" "}
          active /{" "}
          {
            campaigns.filter(
              (c: any) => c.status === "completed" && !c.archived_at,
            ).length
          }{" "}
          completed /{" "}
          {
            campaigns.filter(
              (c: any) => c.status === "cancelled" && !c.archived_at,
            ).length
          }{" "}
          cancelled / {campaigns.filter((c: any) => c.archived_at).length}{" "}
          archived / {campaigns.filter((c: any) => c.can_archive).length}{" "}
          eligible for deletion
        </p>
        <p>
          {(state.documents || [])
            .reduce((n: number, d: any) => n + Number(d.size || 0), 0)
            .toLocaleString()}{" "}
          bytes in listed ready attachments. Archiving keeps all history and
          does not free storage. Per-user database size is unavailable.
          Unreferenced files are cleaned up after deletion.
        </p>
      </details>
    </div>
  );
}
