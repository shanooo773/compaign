# Excel-driven follow-up upgrade and retired-provider removal

Released November 1, 2026 (Asia/Karachi).

Historical release: its 30-day horizon is superseded by [the complete 60-day upgrade](COMPLETE-UPGRADE.md).

## Delivered behavior

- The external-recipient restriction of one follow-up after at least three days has been removed from approval, draft creation, queueing and send execution.
- Campaigns support zero through ten optional Excel/CSV-defined follow-ups per recipient. Only supplied steps are imported; missing steps are never invented.
- The shared `MAX_FOLLOWUPS` constant in `shared/followup-sequence.ts` controls importer and API validation. Template generation reads that constant. The database no longer contains the old five-step ceiling.
- All numbered fields through `follow_up_10_subject/body/delay_value/delay_unit/relative_to` are published in both templates. Existing legacy day fields, flexible single-step fields and JSON sequences remain compatible.
- Delays are positive integers in minutes, hours or days. Values and anchors are preserved exactly. Sequences must increase in requested time and complete within a requested 30-day horizon. The existing limit of 25 recipients per campaign remains.
- Blank follow-up fields mean no follow-ups. Numbered steps must be consecutive and complete. Out-of-range numbered fields, invalid units/anchors/delays, conflicting formats and malformed schedules receive specific errors.
- Identical duplicate recipients within an import are deduplicated; conflicting duplicates are rejected. Import retries reuse the submission ID; a new upload remains a new campaign.

## Schedules and Excel dates

UTC ISO text timestamps remain absolute and are not shifted by the display timezone.

Native Excel date cells are interpreted as wall-clock components using the row's explicit IANA timezone. The Excel reader handles the workbook's 1900/1904 date system. Numeric Excel serials use the standard 1900 system. Date cells/serials without an explicit timezone are rejected rather than guessed. Nonexistent or ambiguous DST wall times are rejected; UTC text resolves ambiguity.

Example: November 1, 2026 at 17:30 in Asia/Karachi becomes 12:30 UTC. The same wall time in Asia/Seoul becomes 08:30 UTC.

`original` delays use the original confirmed send. `previous` delays use the preceding successfully sent message; the first step uses the original email. Approval does not change requested delay values.

## One-time approval and cancellation

Complete campaign review displays every included professor/address, initial subject/body, initial UTC/local schedule, each follow-up's exact content/delay/anchor, planned sequence estimates and maximum email count.

A single approval atomically persists the initial messages and all exact conditional authorizations. No per-follow-up approval is required. The updated wizard also supplies its reviewed message snapshot; if recipient, content, timezone, timing or sequence changed before approval, the API requires review again.

Approved messages, sequence content/delays and authorization records remain immutable. Changes require a new draft/campaign and approval. Existing authorizations are not expanded or rewritten by migration.

The owner-scoped `POST /api/campaigns/:id/cancel` action atomically cancels future initial messages and remaining follow-ups. It is available in both the wizard receipt and Follow-ups dashboard. Delivered mail and immutable approval records remain retained.

## Scheduler and safeguards

- Due-time comparisons use earliest eligibility, including overdue work after cron delays. Scheduler rotation uses the event's scheduled timestamp rather than delayed arrival time.
- Failed mailbox checks receive retry backoff and fair candidate ordering, preventing one failing campaign from monopolizing selection.
- Every follow-up checks all distinct prior Gmail threads before submission. Grouped polling reduces D1 overhead so the tenth follow-up remains within the tested free-plan subrequest budget.
- Replies cancel remaining steps; declines, opt-outs, bounces and blocks remain enforced. Failed/partial reply checks postpone sending.
- Existing leases, deterministic child IDs, unique delivery receipts, send fences and uncertain-send reconciliation prevent duplicate sends.
- Permanent rejections are not automatically retried.
- Gmail readiness, ownership, OAuth permissions, user/profile controls and sending limits remain enforced.
- Existing pacing remains one submission per minute and ten per day per user/mailbox, with the global cap unchanged. Consequently an initial email plus ten follow-ups can span multiple days. Provider/safety delays postpone actual sending without modifying the approved requested intervals.

## Retired transactional provider

Mailjet adapter code, environment types, API calls, certification/runtime scripts, obsolete tests, setup documentation and example environment requirements were removed. No separate dependency existed for the HTTP adapter.

The two production Mailjet secret bindings were deleted. Verification confirmed no Mailjet code in the deployed Worker and no Mailjet environment entries in Vercel.

No frontend account-connection or onboarding component referenced that provider. There are no remaining provider-specific registration or sending gates. Independent email verification/reset logic, hashed single-use tokens, session revocation, passkeys, recovery codes and ownership checks remain. The unrelated optional transactional adapter remains disabled in production; no new service was enabled or required. Gmail OAuth and sending remain intact.

## Verification

- Full suite: **337 tests passed across 20 files**.
- Both workspace TypeScript checks and production Next.js build passed.
- Production dependency audit: **zero known vulnerabilities**.
- Native Workers/workerd/D1/KV checks passed for all migrations, exact follow-up authorization, timing/threading, duplicate prevention, ten-step import dry runs, concurrent import retries, forced rollback, scheduler health and document storage/privacy.
- Isolated browser QA passed: actual XLSX upload; complete and individual review; one approval; cancellation and fresh repeat campaign; ten-step review, sequence estimates, single approval and atomic cancellation; AI fallback; mobile layout; zero deliveries.
- All provider traffic in runtime tests was intercepted or forbidden. Browser tests used an in-memory database.
- Covered 0/1/3/5/10 external follow-ups; mixed minute/hour/day delays; original/previous anchors; reply after initial/between follow-ups; whole-campaign cancellation; duplicates; changed review; provider quotas; ten distinct prior threads; delayed cron phases.
- Actual synthetic 1900/1904 workbooks verified date-cell parsing. Pakistan, Korea, UTC, invalid zones and DST boundaries were tested.
- Migration regression verified old approved content, due times, queued/cancelled state and authorization snapshots; immutable/cancellation/authorization triggers and foreign-key/integrity checks passed.

## Production deployment and preservation

Migration `0011_excel_followup_capacity.sql` applied successfully to the existing production D1 database. Remote foreign-key checks passed.

Worker version: `f55992e8-ff94-43ec-b885-bd225ef63893` (100%).
Worker artifact SHA-256: `2a20aef2f08d2917f2e390aeee96790cf7f2007f00babebf020f8d574297bcd1`.
Vercel deployment: `dpl_Cg5dkPCAbrrbyChUZzL7VgiUKxSi`, READY.
Production: https://ms-professor-agent-malang43.vercel.app/

The deployed Worker exactly matched both release and dry-run builds. Live CSV/XLSX templates matched the tested files. Worker/Vercel health, private API caching, authentication rejection, cross-origin rejection and page security headers passed.

Hash comparisons confirmed unchanged production users, documents, Gmail connections/credentials, immutable approvals, campaigns and existing follow-up rows. All unrelated Worker bindings/settings and cron schedules matched the baseline. Only the two retired secret bindings were removed. No paid service or plan upgrade was introduced.

No production campaigns were imported, approved or cancelled by verification, and no real email was sent by development/release checks.

A managed Cloudflare D1 recovery bookmark was recorded. Automatic approval review rejected an optional full local SQL export because it could copy private records and credentials; no such export was performed.

## Owner steps

Refresh the production application, import the existing five-follow-up file, review the entire campaign and approve once when ready. The old external-recipient restriction no longer prevents its approval. Standard supported field, timing and safety validation still applies.

No credential setup, service activation, payment card or additional deployment is required. Existing approved campaigns retain their original scope; uploading a changed plan does not alter their approvals.
