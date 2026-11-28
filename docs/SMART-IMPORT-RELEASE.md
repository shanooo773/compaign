# Smart Import release — 3 November 2026

Production: https://ms-professor-agent-malang43.vercel.app/

**Status: live and verified.** Frontend deployment `dpl_7uYY5vE62AveSHEdAK4819YLQf22` is READY at the existing production URL. Published frontend assets passed the browser journey against an isolated database. Post-release production integrity and health checks passed. No Worker deployment or database migration was performed.

## Delivered behavior

| Requested outcome | Implementation / evidence |
| --- | --- |
| Three import options | Permanent **Smart Import** navigation entry: Paste Text, Paste Table, Excel / CSV Upload. Original Professors upload remains available. |
| No-AI text extraction | Deterministic explicit `=== PROFESSOR ===` blocks and named fields. `<<<` / `>>>` delimit multiline bodies. Multiple professors, UTF-8, blank lines, leading spaces, quoted content and Windows body line endings are retained. No free-form inference or invented missing data. |
| Table formats | Quoted CSV and TSV, semicolon-delimited tables, Markdown tables with escaped pipes, and strict JSON arrays of flat row objects. Papa Parse handles CSV/TSV quoting and multiline cells. |
| Existing files | `.xlsx` uses the existing read-excel-file reader and shared scalar/date normalization; CSV uses the same authoritative spreadsheet draft validator. The legacy importer and its preparation choices remain available. |
| Templates | Desktop template panel beside the input; mobile panel starts collapsed. Visible example, required and optional fields, ten-step conventions, UTC guidance, copy controls, CSV and XLSX downloads. |
| Copy Prompt for AI | Copies instructions for the student's own ChatGPT/Gemini/Claude/DeepSeek account. Requires factual sources, verified addresses, complete personalised content, explicit dates/timezones and the exact supported format. Professor Agent makes no AI request and collects no AI-provider password or API key. |
| Authoritative schema | Template columns are exported by `shared/spreadsheet.ts` and consumed by Smart Import. Generated CSV/text and XLSX round-trip through the actual importer. The XLSX download is generated locally with fflate; dates are literal UTC text cells and default to a future sample date. |
| Scheduling | Existing shared timezone converter, explicit IANA zones, local-date input and UTC display. Karachi and Seoul conversion, DST ambiguity, past dates, increasing follow-up offsets and initial-plus-last-follow-up 60-day horizon are checked. No approved schedule is edited. |
| Editable preview | Editable recipient grid plus full message and follow-up editors, local/UTC conversion, conditional follow-up date estimates, validation status, recipient removal and follow-up editing/removal. Summary distinguishes initial emails from conditional follow-ups. |
| Add to Campaign | Calls existing authenticated `/imports/drafts` only, with an idempotency ID scoped to student and payload. Backend independently validates before creating `draft`, `approved=0`, `authorized=0` messages. Retries reuse drafts. |
| Existing review / approval | Prepared drafts open the existing complete review, existing private CV/document selector, sender selection, schedules and exact follow-up review. Explicit one-time approval remains separate and unchanged. No new approval endpoint or sending engine. |
| Beginner help | Getting Started import lesson, animated outreach walkthrough and page-specific tour explain all three methods, copying prompts, fixing errors, selecting CVs, approving once and tracking replies. |
| Practice isolation | Same browser-only Smart Import UI is available in Practice Campaign with no API client. It accepts reserved example addresses through the existing practice validator, uses fictional attachments, simulates approval/sends/replies, and never writes live records. |
| Security | Input limits, strict headers, scalar cells, duplicate detection, unambiguous parsing, React-escaped rendering, existing server validation, session/Origin/tenant controls and existing approval protections. Pasted text is not executed or sent to external services. |
| Existing execution | No Gmail sender, OAuth refresh, reply detector, cancellation handler, cron, limits or existing approved campaign was edited for this upgrade. |

## Production protection

A fresh production baseline was captured **before development**:

`apps/api/.wrangler/onboarding-production-1793699752092.dpapi`

All application database tables were captured read-only, encrypted using Windows CurrentUser DPAPI, decrypted for hash verification, and restored into an in-memory SQLite database with integrity and foreign-key checks. Relevant retained private documents were read-only checksum/size checked. Backup content and credentials were not printed. The backup requires this Windows user/profile; it is not a complete offline archive of all KV objects or Gmail data.

Baseline and post-deployment checks:

| Protected state | Baseline | Post-deployment |
| --- | ---: | ---: |
| Campaign approvals | 6 | 6 |
| Pending initial emails | 5 | 5 |
| Pending generated follow-up messages | 0 | 0 |
| Remaining unqueued follow-up steps | 45 | 45 |
| All follow-up history records | 54 | 54 |
| Gmail connections | 2 | 2 |
| Delivery records | 17 | 17 |
| Mailbox events | 5 | 5 |
| Attachment references | 10 | 10 |
| D1 migration receipts | 14 | 14 |

Existing recipients, immutable content, approval snapshots, schedules, follow-up definitions, account states, connection identity/scopes, attachment metadata, cron and Worker bindings match. The scheduler heartbeat is healthy. No campaign transitions required reconciliation during this upgrade, including the post-deployment comparison. The reply and cancellations documented in the earlier Google activation release predate this new baseline.

Read-only post-deployment inspection confirms the live Worker version remains `d2160dec-3097-49d9-b9f1-2c64cf982cc8` at 100%, with module SHA-256:

`2356b3e99951197d125e57a8a3114cc263aa71c1bb10c1160f506344931aa110`

No production data was mutated by the development/test process. No approval, manual send, cron invocation, cancellation, reschedule, token reset or reconnect was performed. Production snapshots are read-only.

## Verification

- **427 tests passed in 23 files**, including all existing tests and new Smart Import coverage.
- Single- and ten-professor text; zero/ten follow-ups; minutes/hours/days; original/previous anchors; quoted multiline CSV/TSV; Markdown; JSON; schema-compatible templates; invalid/missing/duplicate fields; malformed/oversized input; hostile markup; exact content; UTF-8 and Windows line endings.
- Karachi/Seoul/UTC conversion, missing zone, invalid calendar dates, ambiguous/nonexistent DST times, past dates and 60-day boundary.
- Generated XLSX read back through the actual Excel reader and validated through the actual shared campaign parser. Text and CSV templates likewise validated.
- Isolated backend imports from all three representations yield the same unapproved draft. Retry idempotency and tenant isolation verified. Zero approvals, authorizations, transports, deliveries and queued follow-ups from the new draft test.
- Isolated Chromium: actual registration/Turnstile/login and signed Google identity fixtures; Smart Import text/table/CSV/XLSX; fixing invalid email; exact body retention; local-to-UTC conversion; copy template/prompt; generated Excel download and upload; existing CV selection; complete review visible without approval; desktop/mobile/dark/reduced motion; simulated approval and reply cancellation with no live API writes; original CSV review regression. Provider traffic intercepted; no real mail.
- Native Worker/D1/KV checks passed for imports, ten follow-ups, attachments/MIME/retention, Gmail transport/threading/reply/profile reads, scheduler compatibility, WebAuthn/Turnstile and document security. Any approval/send behavior in these regression checks uses isolated fixture databases and intercepted/forbidden provider traffic.
- API/frontend typechecks and frontend production build passed. Production dependency audit: zero vulnerabilities.
- The same browser journey also passed using assets fetched from the published production frontend, with every API action routed to the isolated fixture backend. No authenticated production student was impersonated and no production draft was written.
- Screenshots inspected for desktop and mobile/dark layout. No horizontal document overflow; the populated recipient grid scrolls within its own container on mobile, and the template panel opens/closes with the keyboard. The final frontend correction added explicit grid overflow after the additional mobile check caught clipping; it passed both local and published-asset browser tests.

## Limits and operating notes

- Campaigns remain limited to 25 professors. The old professor-only importer still supports 500 records. Smart paste limit is 1 MiB; upload limit is 5 MiB.
- Structured text must follow the published format. Unknown/duplicate headers and ambiguous prose are rejected with guidance, rather than guessed.
- Markdown trims outer cell padding and does not support multiline cells or HTML-to-newline conversion. Use quoted CSV/TSV or structured text for exact multiline bodies. JSON must be valid; no automatic repair is attempted.
- Preview validation is repeated at Add to Campaign; backend and approval checks remain authoritative if time or account state changes.
- Pasted/edited content is kept in page memory. Leaving Smart Import before creating a draft discards that preview. Only hashes and retry IDs are stored in sessionStorage; messages are not stored there.
- Practice uses its existing shared date/follow-up controls across fictional recipients, initialised from the first imported row. This is visibly explained before simulated approval. Real drafts retain each professor's individual timing and content.
- Google Testing-audience restrictions from the prior release remain unchanged. Smart Import does not expand Google approval or bypass account verification.
- No new paid service, AI service, custom domain or external credentials are required.
- Authenticated production test drafts were not created through another user's session. Real draft creation/review was verified with the actual backend in isolated databases; production record integrity is checked read-only.

## Deployment

Frontend-only deployment completed successfully:

- Production: https://ms-professor-agent-malang43.vercel.app/
- New Vercel deployment: `dpl_7uYY5vE62AveSHEdAK4819YLQf22` (READY).
- Previous Vercel deployment retained: `dpl_DtQaNmWx9DHGhgjRnPBApjdX98pq`.
- Existing API rewrite and security headers are unchanged.
- Published frontend browser checks passed against the isolated backend, including creation of unapproved drafts and existing review/CV selection.
- `/api/health`: HTTP 200, Gmail ready, KV storage, live-email enabled; private/no-store response.
- Worker module SHA-256 and active 100% version match the pre-release observation exactly.
- Post-release encrypted snapshot `apps/api/.wrangler/onboarding-production-1793701345974.dpapi` passed read-back and local restore verification. All immutable records and cron/bindings match; there were zero message transitions requiring reconciliation.
- Production approval, authorization, message, transport and delivery counts match the new baseline. Delivery count remains 17. No real test email was sent or approved.
- No Worker upload/deployment, migration, production D1/KV write, Gmail reconnect, manual scheduler invocation or sending-limit change was performed.

No external configuration or additional service is needed to use Smart Import. Refresh the application, open Smart Import, and choose a method. Review remains mandatory; parsing and draft creation never authorize mail.
