> Historical release record. Current limits, templates, timezone handling and safety behavior are documented in [Excel-driven follow-up upgrade](EXCEL-FOLLOWUP-UPGRADE.md).

# Flexible follow-ups and scheduler repair

Release date: October 29, 2026 (Asia/Karachi).

## October 27 incident

Production D1 identifies initial message `893084fc-92e2-4acf-a33b-d52931700a11` as Gmail-confirmed, provider ID `1a17e57c94e294a3`. Its requested time was October 27 at 22:05 Pakistan time, but actual confirmed sending was `2026-10-27T17:10:44.966Z` (22:10:44.966 Pakistan time). The authorized one-day follow-up was correctly due `2026-10-28T17:10:44.966Z` (October 28 at 22:10:44.966 Pakistan time), Unix milliseconds `1793207444966`.

At `2026-10-28T16:24:45Z` (21:24:45 Pakistan time), the stored notification/audit records show that OAuth refresh failed and the mailbox entered `reconnect`. Its encrypted tokens were removed. This happened before the due time. The scheduler correctly refused to send without a valid mailbox and fresh reply evidence. The initial message remains sent, its exact follow-up authorization remains intact, and automation remains ungenerated (`generated=0`). No follow-up child or follow-up provider receipt exists. It was never queued or attempted through this application; the initial email's provider ID is not a follow-up receipt.

The old refresh handler erased tokens for any rejected refresh, including errors that did not establish revocation. Historical refresh responses were not categorized, so the retained evidence cannot distinguish Google's `invalid_grant` from another rejected token request. Claiming a specific Google revocation/expiration reason would be unsupported. The new handler retains tokens for transient/configuration/malformed-response failures, requires explicit `invalid_grant` evidence before invalidating refresh credentials, and logs only fixed diagnostic categories and numeric HTTP status.

The existing minute cron was registered on October 21 and remained registered during investigation. Historical per-tick records did not exist, so registration alone does not prove every past tick succeeded. The release adds persistent scheduler start/completion/failure evidence. Reconnect the same Google account with send and reply access in Settings to resume eligibility; do not recreate or resend the initial campaign. Reconnection may allow its already overdue, already approved follow-up to run after a fresh reply check. No historic emails were manually resent during development.

## Scheduling and approval

- Existing day-based imports, approvals and queue records are preserved. No migration authorizes historical proposals or changes old due times.
- Flexible sequences have 1-5 immutable steps: exact subject/body, integer delay, minutes/hours/days, original/previous timing, authorization timestamp, due time, deterministic child ID and cancellation reason. Sending state and provider receipts come from the existing outbox.
- Original means actual confirmed initial sending. Previous means actual successful sending of the immediately preceding follow-up. A step also waits for all earlier steps to be confirmed. UTC is stored internally; follow-up status displays Asia/Karachi and UTC.
- Schedules must increase and finish within 30 days. Minute values are earliest eligible times, never exact-to-the-second delivery guarantees. Cron currently rotates queueing, sending and maintenance across three phases; a due message may wait several minutes or longer under provider/rate-limit backoff.
- Only addresses on the server-maintained controlled-test allowlist may receive accelerated or multiple follow-ups. Excel flags cannot verify recipients. New external outreach approvals permit at most one follow-up after at least three days. Existing approved one-day campaigns are preserved.
- Upload ? Manual or AI preparation ? entire campaign review ? one approval persists the exact full sequence. Imports never authorize sending. Both approval dialogs list every step and maximum authorized message count. Approved content/timing/recipients are immutable; changes require a new draft and approval.
- The composer supports minutes, hours and days for a single proposed follow-up; Excel supports full five-step sequences.

## Stop rules and duplicate prevention

Every sequence send checks every distinct prior Gmail thread, deduplicating shared threads and using the earliest tracked message in each. This handles changed subjects that created separate threads. Incomplete or failed reads postpone submission. Replies, declines, opt-outs, professor deletion, cancellation and failed sequence steps stop remaining steps. Queueing uses deterministic child IDs, existing unique parent constraints and atomic batches. The final provider-submission fence checks sequence authorization and current reply/cancellation state. Existing leased/submitting recovery, rate limits, OAuth refresh leases and uncertain-delivery reconciliation remain in use. An uncertain send is reconciled and never blindly resent.

The legacy scheduler now targets the actual due parent's mailbox rather than relying on whichever message happened to be background-polled within the preceding minute. This fixes a separate queue-starvation condition when multiple old threads are being rotated.

## Excel template

Download `/professors-email-template.xlsx` or `.csv`. All timestamps are UTC ISO text. Legacy `followup_*` and `follow_up_*` day fields remain supported. Use one timing format per row:

1. Legacy `follow_up_days`, `follow_up_subject`, `follow_up_body`.
2. Simple flexible `follow_up_delay_value`, `follow_up_delay_unit`, `follow_up_relative_to`, with `follow_up_subject` and `follow_up_body`; clear the legacy day field.
3. Numbered `follow_up_1_subject`, `_body`, `_delay_value`, `_delay_unit`, `_relative_to`, through step 5; clear legacy follow-up fields.
4. A JSON array in `follow_up_sequence` containing those five step properties without prefixes; clear legacy and numbered fields.

The workbook includes a controlled example using previous-step minute delays `[5,10,15,30,30]`, corresponding nominally to 5,15,30,60,90 minutes after the initial send. Actual previous-step schedules account for actual sending delays. Conflicting formats, gaps, invalid intervals, empty content, non-increasing schedules and conflicting duplicate recipients are rejected. Identical duplicate rows remain safely deduplicated for compatibility.

## Verification

## Deployment evidence

- GitHub application commit: `f475d78` on the existing private repository's `main` branch.
- Cloudflare Worker version: `44f20fbf-4c70-4bc9-83d6-270dd656c13c`.
- Vercel production deployment: `dpl_EYghB8aT7dpoee43BR4SG7iVUwg3` (READY), canonical alias `https://ms-professor-agent-malang43.vercel.app`.
- Remote D1 migration 0009 applied successfully. Production variables and all existing binding metadata compare exactly to the pre-release baseline; protected-record hashes, old queue state and immutable authorizations match.
- Automatic cron executions completed at October 29, 00:42:42, 00:43:43 and 00:44:43 Pakistan time, covering all three scheduler phases with no recorded failure. No manual scheduler request was used to produce those heartbeats. Continued reliability and live Gmail delivery require ongoing observation, not just registration.
- Canonical production health returns HTTP 200, Gmail provider, KV storage, live sending enabled and `gmail_ready=false`, consistent with the required reconnection. Authentication/origin rejection and byte-for-byte XLSX/CSV downloads pass against the live alias.

## Owner action

The account owner must reconnect Gmail; local code cannot restore deleted/revoked provider credentials. Then approve an exact five-step controlled test inside the app and test replies at selected stages. No real test emails were sent during development. Verify actual inbox arrival and Gmail threading against dashboard provider IDs, and confirm live scheduler heartbeats advance without manual runs. No paid service or plan change is required by this release. Cloudflare's existing Free-plan CPU/provider quotas still apply; passing local runtime tests does not promise an outage-free service.

The optional full local production database export was rejected by automatic approval review because of sensitive-data copying. No such export was performed.
