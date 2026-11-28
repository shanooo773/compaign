# Active message capacity investigation and release

## Root cause and production evidence
The original `message_capacity` trigger in `0002_storage_integrations.sql` ran before every message insertion:
`count(messages WHERE user_id=NEW.user_id)>=100 OR count(messages)>=1000`.
It counted all retained message rows, including sent, replied, failed and cancelled messages and rows retained after permanent workspace deletion. Archive flags did not affect it. It did not count approval/audit rows separately. There was no evidence of counting the same message row twice; unmaterialized follow-up plans were instead omitted.

Smart Import and CSV/XLSX review both submit to `POST /api/imports/drafts` in `src/index.ts`. Sixteen professors with five follow-ups each insert **16 message rows** with 80 proposal steps. The old import needs 16 free rows, not 96: it rejects when existing student usage exceeds 84 or global usage exceeds 984. A transaction rolls back the import on rejection.

A fresh, read-only production snapshot found two accounts at **100 retained messages each**, with zero pending initial messages:
- Anonymous account 1: 79 sent, 9 replied, 11 cancelled, 1 failed; 50 outstanding planned follow-ups.
- Anonymous account 2: 66 sent, 9 replied, 25 cancelled; 192 outstanding planned follow-ups.
- Another account: 6 drafts and 24 proposal steps.
Global retained message usage was **206**, leaving **794** under the old global quota. Both capped accounts had zero individual availability. The request does not identify which of the two capped accounts submitted the CSV; both exhibit the same confirmed blocker. No email addresses or private content are included here.

## Policy
The shared policy in `shared/message-capacity.ts` is **400 active messages/student** and **4,000 globally**. This supports ten fully allocated students without becoming unlimited. This is a preparation quota, separate from sending allowances.

| Record | Old usage | New active usage |
| --- | --- | --- |
| Initial draft or approved/pending message | 1 | 1 |
| Unapproved valid follow-up proposal | 0 until queued | 1 per proposed step |
| Approved, unmaterialized sequence step | 0 until queued | 1 per outstanding step |
| Legacy armed automatic follow-up | 0 until queued | 1 |
| Materialized pending follow-up | 1 | 1, replacing its reservation |
| Sent/replied/failed terminal message | 1 | 0, unless delivery is unresolved |
| Cancelled message or cancelled step | message row: 1 | 0, unless delivery is unresolved |
| Leased/submitting/uncertain transport | message row: 1 | underlying message counted once |
| Archived or workspace-deleted campaign | retained message rows: 1 each | 0 for terminal content; existing lifecycle rules require no active/uncertain work |
| Immutable approval, revision, sending receipt, audit row | 0 directly | 0 |

Archived campaigns remain restorable: restoration restores visibility, never sending or cancelled work. Permanent workspace deletion preserves approvals, receipts and contact evidence under the existing policy. Completed initials may have outstanding follow-up reservations; only those remaining steps consume capacity.

Before release, corrected global usage was **272** (242 approved outstanding steps plus 30 draft/proposal slots). The capped accounts have **350** and **208** free slots; adding a 96-message campaign yields **146** and **288** active slots respectively.

## Implementation and entry points
- Migration `0018_active_message_capacity.sql` replaces the old database trigger, adds a read-only active-usage view, and enforces reservations atomically on message insert/status/proposal changes, sequence creation, and legacy automation creation/rearming. It changes no existing campaign/message rows.
- `scripts/generate-message-capacity.cjs` generates the migration from shared limits; `--check` detects drift. Do not rewrite an applied migration for future policy changes: create a new migration.
- `src/index.ts`: imports, direct draft creation, approvals, quota error mapping, authenticated `GET /api/capacity`.
- `src/live-approval.ts`: approved sequence/legacy reservations; existing batch remains atomic.
- `src/followup-approval.ts`: separately approved legacy follow-up reservation.
- `src/followup-sequence.ts` and `src/automation.ts`: materialized children replace reservations, without consuming a second slot.
- `src/draft-deletion.ts`, `src/campaigns.ts`, `src/campaign-archive.ts`, `src/campaign-deletion.ts`: existing deletion/cancellation/archive protections remain.
- Smart Import and spreadsheet review use shared policy plus an on-demand backend availability preflight. Existing import IDs bypass the additional-slot preflight for safe idempotent retries; backend triggers remain authoritative against races.

No counter table or periodic quota-write job was added. Capacity is calculated from existing rows. The scheduler's conditional due-date update is unchanged. Offline replay still shows zero matched rows on repeated unresolved-schedule passes, versus 157 per pass for the pre-optimization query. This is SQLite matched-row evidence, not a live D1 billing benchmark.

## Verification
- **520 tests passed across 28 test files**.
- API/frontend typechecks and production frontend build passed.
- Chromium passed text/table/CSV/XLSX, editing, timezone handling, draft-only behavior, document selection and mobile/dark/practice regressions.
- Targeted Chromium test imported 16 initials + 80 follow-ups with 100 historical message rows, then rejected a 401-slot request in the frontend before posting.
- Isolated backend test reproduced the old rejection, preserved the historical rows, imported 96 potential messages after migration, and retried without duplicates.
- Boundaries: 100 existing active + 96; 400 accepted; 401 rejected with rollback; independent students; ten students/global 4,000; cancelled/draft/deleted/archive/restore accounting; immutable approvals; legacy and modern reservation transfer; uncertain delivery counted once.
- Existing tests preserve 50-email rolling allowance, minute intervals, reply detection/cancellation, duplicate warning consent, opt-outs and sending authorization. No real test emails were sent.
- Compared 998 existing production Worker functions: only `route`, quota-error propagation in `approveFollowup`, and the capacity notification text in `queueFollowups` changed; `messageCapacity` was added. Core sending and schedule functions are unchanged.

## Backup, deployment, limitations
Encrypted Windows-user DPAPI backups were decrypted, hash-verified and restored into local memory before changes. Starting backup: `apps/api/.wrangler/onboarding-production-1795023878754.dpapi`; refreshed pre-release backup: `apps/api/.wrangler/onboarding-production-1795025494356.dpapi`. The latter comparison found unchanged immutable records, cron/bindings and message statuses. Offline migration replay preserved every existing data row. Backups remain ignored/private and require the same Windows account/profile.

Production deployment: **complete and verified** at https://ms-professor-agent-malang43.vercel.app/.
- Migration 0018 applied; Worker version: `42027a93-562c-48bc-8fad-764c466f696f`.
- Vercel deployment: `dpl_EvHgkvSiatnHFdm4GkJxwddpddCA`, READY with the existing production alias.
- Live Worker bytes match the tested upload; health/landing/templates pass; unauthenticated state and capacity return 401 with no-store.
- Published frontend assets passed the isolated 96-message import and 401-slot rejection browser test.
- Final verified encrypted backup: `apps/api/.wrangler/onboarding-production-1795027678042.dpapi`.
- Original approvals, receipts, content, schedules, connection identities, bindings and minute cron match the baseline. Two pre-existing approved follow-ups naturally queued and sent during release; offline comparison verified exact prior content, authorization and original due times, plus Gmail receipts. No test emails were sent or cron manually invoked.
- Final aggregate usage: **270 active slots**, **208 retained message rows**, **16 campaign approvals**, **165 receipts**, **3 Gmail connections**. The change from the investigation snapshot reflects the two normal scheduled deliveries.
- Private verification artifacts: `capacity-production-verification.json`, `capacity-natural-transitions.json`, `capacity-diagnosis.json` and `capacity-browser-results.json` under ignored `apps/api/.wrangler`.

The build reported an existing Next.js security advisory and succeeded through its normal retry mechanism. A separate Next.js security upgrade is recommended; this release does not change dependencies. Active usage reads are computed rather than cached, trading read work for no additional D1 counter writes. Historical physical database storage still follows existing retention policy; the workspace quota does not impose a physical audit-storage limit. No paid service, account reset, historical deletion or sending-limit increase was performed.
