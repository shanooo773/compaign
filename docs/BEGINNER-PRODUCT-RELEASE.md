# Beginner product release and production campaign safety

Release date: 3 November 2026 (Asia/Karachi).

Production: https://ms-professor-agent-malang43.vercel.app/

Vercel deployment: `dpl_9ZJGSELNjWt6zFKGnk3WsqQTRYWr`, state `READY`, existing project `ms-professor-agent`, existing root `apps/web`.

The frontend learning release is deployed and browser-verified. Live new-account email verification is **not activated**: the owner confirmed that Brevo is not configured. This report does not claim that a real verification email reached an inbox or that unrestricted Gmail access is available to every student.

## 1. Exact verification diagnosis and solution

Read-only production settings confirmed `MAIL_PROVIDER=disabled`, `MAIL_DELIVERY_ENABLED=false`, `MAIL_FREE_PLAN_CONFIRMED=false`, `MAIL_SENDER_VERIFIED=false`, and no `BREVO_API_KEY` binding. The existing account-mail adapter therefore deliberately reports unavailable. Gmail outreach is separately enabled in production; this is not evidence of a system-wide Gmail outage.

Two frontend defects were corrected: the limited-workspace footer incorrectly reported unavailable delivery even when `mail_delivery_ready` was true, and Account Settings used a hardcoded unavailable message. The activation panel now reads actual account verification and capability state, explains account restrictions, offers refresh, and enables Resend Verification Email when configured. Existing-account access rules are preserved.

The existing secure backend was retained: hashed verification tokens, 24-hour expiry, explicit confirmation, single-use transactional redemption, canonical production-origin fragment links, and resend limits of 3 per address per hour with additional IP/global limits. No verification bypass, automatic verification or Mailjet code was added.

The isolated browser test covers both unavailable and configured delivery: it requests a resend through the actual account endpoint, intercepts Brevo HTTP with a synthetic acceptance, extracts that generated link, confirms it through the real verification route, and verifies fragment clearing and verified dashboard access. Existing account tests cover expiry, reuse, rate limits and isolation. This is functional test coverage, not genuine inbox delivery certification.

Remaining operator setup:

1. Create an eligible Brevo Free account; complete any required transactional approval and verify a sender you control.
2. Install the API key privately as `BREVO_API_KEY`; never put it in chat, Git or a frontend environment variable.
3. Confirm an owner-controlled inbox can receive a provider probe, and confirm sender/domain requirements for this account.
4. Configure the exact verified `MAIL_FROM`, `MAIL_PROVIDER=brevo`, `MAIL_FREE_PLAN_CONFIRMED=true`, `MAIL_SENDER_VERIFIED=true` and finally `MAIL_DELIVERY_ENABLED=true`. Capture current deployed Worker settings first and change only account-mail settings. Do not deploy the repository's default disabled outreach settings over live production.
5. Certify actual signup, inbox receipt, confirmation, resend, expired/reused links and password recovery with an owner-controlled account before claiming live delivery works.

Brevo currently documents 300 daily sends, transactional email and no card requirement on Free: https://help.brevo.com/hc/en-us/articles/208589409-About-Brevo-s-pricing-plans . Sender/domain authentication and actual delivery still require validation: https://help.brevo.com/hc/en-us/articles/14925263522578-Comply-with-Gmail-Yahoo-and-Microsoft-s-requirements-for-email-senders . No provider account, purchased domain or paid service was provisioned here.

Resend was considered, but its testing sender can only send to the owner's inbox; other recipients require a verified domain: https://resend.com/docs/knowledge-base/403-error-resend-dev-domain . Switching would also require a new adapter and credentials. Retaining the already-tested Brevo adapter avoids unnecessary backend deployment.

## 2. Dashboard redesign

The dashboard now includes a prominent activation panel, a research-journey welcome area, a four-step account checklist, setup progress and direct Getting Started / Practice Campaign actions. Duplicate unverified overview panels and the redundant old hero were removed. Existing verified-user statistics and campaign access remain available. The header distinguishes verified outreach, controlled testing and account-specific restrictions.

Spacing, cards, primary-button contrast, typography, responsive columns, progress bars and theme-aware surfaces were reviewed in Chromium screenshots. Sidebar navigation remains scrollable. The existing developer photograph and Muhammad Farhat Mehdi attribution, Computer Engineering, Session 2023, UET Taxila were preserved and passed existing browser checks.

## 3–4. Permanent Getting Started and all fourteen modules

The sidebar entry remains available to limited and verified students. It includes module search, read/continue controls, browser-local per-account progress, template downloads, links to relevant application sections and page tutorials.

| Lesson | Content provided |
| --- | --- |
| 1 | Application purpose, intended users, scheduling, research matches versus confirmed opportunities, no admission/funding guarantee |
| 2 | Registration/login, password requirements, Turnstile, verification/resend, recovery, passkeys and recovery codes |
| 3 | Gmail OAuth, delegated permissions, connection/reconnection, sender confirmation, disconnect consequences, verification and quota restrictions |
| 4 | Academic profile fields, university/degree/interests, updating and use in factual preparation |
| 5 | CV/transcripts, supported PDF/DOCX/TXT, actual file/storage/count limits, privacy, expiry, campaign retention, initial/follow-up attachments and MIME behavior |
| 6 | Manual professors, official institutional sources, maintenance, duplicates and opportunity verification |
| 7 | Exact `name` / `email` schema, personalised content, UTC schedule, sequence columns, templates and validation |
| 8 | Karachi UTC+05, Seoul UTC+09, UTC ISO text, Excel date interpretation, future dates and scheduler delays |
| 9 | Professional subjects, factual research personalisation, academic projects, manual content and configured template assistance |
| 10 | Ten follow-ups, sixty days, positive delays, minutes/hours/days, original/previous anchors, reply cancellation and reasonable intervals |
| 11 | Full review sequence, attachment/schedule review, one approval, frozen plans and material-change reapproval |
| 12 | Application scheduling versus Gmail Scheduled, Gmail Sent, pending/sent/delayed/failed/cancelled/uncertain interpretation |
| 13 | Tracked replies, progress/failures, manual outcomes, opt-outs and cancellation limitations |
| 14 | Header/email/date/follow-up validation, missing fields, duplicates, uploads/expiry, OAuth, failed sends, verification, Gmail folders, postponed steps and attachments |

The build reads current storage constants and document-count quota from `apps/api/src/storage.ts` through `scripts/generate-learning-config.cjs`; generated public limits are imported by the guide. Current values are 2 MiB per file, 20 MiB per student, 10 documents and ordinary 30-day retention. No secret or private data enters that generated module.

## 5. Interactive tours

A dependency-free lightweight React tour offers new empty workspaces a nonblocking invitation. It never automatically opens a modal over an existing campaign dashboard. Next, Back, Skip, Finish, Replay and Resume are available. Major pages have tutorials; real Add professor, Compose, university field and upload controls have tour targets. Account state changes Gmail guidance to verification guidance for limited users.

Progress uses browser localStorage under a separate learning key; no campaign record is updated. Escape skips, arrow keys navigate, focus moves to the tutorial and returns on close, and controls remain keyboard-accessible. There is no page-covering interaction blocker. Reduced-motion styling suppresses learning animations. Completion, skip, replay, resume and persistence were browser-tested.

## 6. Isolated Practice Campaign

Permanent sidebar section with the explicit banner **PRACTICE MODE — NO REAL EMAILS WILL BE SENT**.

The sequence supports fictional professor inspection, fresh sample CSV download, local CSV import or simulated import, content preview, future UTC time selection with Karachi/Seoul previews, up to ten configurable follow-ups, timeline validation, fictional CV selection for initials/follow-ups, complete review, Simulate Approval, animated clock advancement, simulated replies, automatic cancellation, statistics and restart.

Only reserved example.com / example.org / example.net addresses are accepted by practice validation. The simulator module has no fetch, request client, credentials, provider integration or production identifiers. No private document bytes are read; Fictional CV.pdf is a label. Leaving the page resets the practice session. Learning progress is separate and persistent in the browser.

Chromium observed zero mutating API requests during practice and asserted zero messages and zero approvals in the fixture database. Unit tests assert per-recipient reply cancellation, unchanged frozen copies, attachment choices, supported timing, maximum steps, increasing offsets, future dates and the complete 60-day horizon.

## 7. Two automatically generated demonstrations

Getting Started includes two animated interface-fixture demonstrations: A, Registration & Gmail; B, Complete Professor Outreach. Both provide Play/Pause, Back, Next and Restart/Replay controls and progress. They cover verification availability, login, account setup, profile/documents, import, personalisation, schedules, follow-ups, attachments, one approval, tracking and replies.

These are in-app video-like walkthroughs, not exported video files. No recording is required. No real registration, Gmail connection, upload or sending occurs inside them. Exported MP4/WebM generation was not implemented or claimed.

## 8. Contextual help and review usability

Inline help appears for professor imports, outreach review, documents and follow-ups, plus practice timezone and delay controls. Campaign preparation now has a visible checklist covering recipients, initial content, all follow-ups, CV/attachments, sender and local/UTC schedules. Attachment help explains initial-only defaults and separate follow-up selections. Existing attachment-selection and approval behavior was preserved.

## 9. CSV / Excel compatibility

Official CSV/XLSX template links remain available. The fresh downloadable practice CSV uses a future date and the actual shared `spreadsheetDraft` parser; Papa Parse round-trip and follow-up parsing are tested. It uses supported `name`, `email`, personalised subject/body, `scheduled_at`, timezone and numbered step columns. Incorrect `professor_name` is explained as unsupported.

The existing static campaign templates deliberately contain placeholder dates such as 2099. The guide explicitly requires replacing sample dates with future dates within the current campaign horizon. Parser compatibility does not authorise sending or bypass final live validation. Existing full browser tests passed actual XLSX import, private attachment selection, complete review and one-time approval in isolated local storage.

## 10–12. Production campaign preservation and no test sends

No production Worker deployment, migration, cron update, sending-limit update, OAuth update, account approval, campaign approval, cancellation, reschedule, queue deletion or manual scheduler execution was performed.

Before deployment a single read statement captured all application-table data, including campaign approvals, initial/follow-up content, recipients in frozen transport snapshots, document references, encrypted connection records, schedules and processing state. Schema stability was checked around capture. The full snapshot and settings were encrypted using Windows CurrentUser DPAPI; encrypted disk read/decrypt hashes were verified. Every application table was restored to local in-memory SQLite and passed integrity and foreign-key checks. Private values never appeared in the report or logs.

The private baseline is `apps/api/.wrangler/onboarding-production-1793683432718.dpapi`. It is Git-ignored and excluded from Vercel upload by the existing .wrangler exclusion. DPAPI decryption requires the same Windows account/profile. It is a verified application-database backup, not a backup of all KV document bytes or provider-side Gmail data.

Cloudflare's SQL export endpoint was intentionally avoided because its documentation says export can temporarily make the database unavailable: https://developers.cloudflare.com/api/resources/d1/subresources/database/methods/export/ . The read-only snapshot did not pause cron or lock the scheduler through an export operation.

After deployment, baseline comparisons passed for existing campaign approvals, message authorisations, follow-up approvals, message attachments, frozen transport snapshots, initial content/dates, exact follow-up content/delays/anchors/authorisation time, document identity/checksum/size and Gmail connection identity/scopes. Cron and Worker bindings matched. Connection token refresh and ordinary processing fields were not treated as frozen campaign content.

Observed production baseline and post-deployment counts:

| Record | Before | After |
| --- | ---: | ---: |
| Campaign approval records | 6 | 6 |
| Pending initial messages | 5 | 5 |
| Pending generated follow-up messages | 0 | 0 |
| Unqueued, uncancelled follow-up steps | 50 | 50 |
| All follow-up step records, including historical/cancelled | 54 | 54 |
| Gmail connections | 1 | 1 |
| Delivery records | 17 | 17 |
| Mailbox event records | 4 | 4 |

No message status transitions occurred in the observed comparison window, so no legitimate send/reply transition needed special reconciliation. Any future comparison with transitions flags them for review rather than silently assuming they are legitimate. A naturally advancing scheduler heartbeat remained fresh with no recorded failure. The active retained private attachment was fetched read-only and matched its database SHA-256 and byte size; expired unpinned documents were not claimed accessible.

All test provider traffic was intercepted or forbidden. No real outreach or verification email was sent by testing. Production delivery/event counts remained unchanged during the recorded release window. Existing future scheduled sends remain free to process naturally after this observation.

## 13. Validation and deployment results

- 356 automated tests passed across 21 files, including 4 new practice/parser tests.
- API and frontend TypeScript checks passed.
- Next.js production build passed, including generated storage-guide configuration.
- Local Chromium onboarding passed registration, unavailable verification, configured resend with synthetic Brevo acceptance, actual link confirmation, URL-fragment clearing, guide progress, tours, demonstrations, simulation and responsive theme checks.
- The same onboarding journey passed against deployed production assets with every API request fulfilled by isolated local fixtures. No production test account or real campaign was created.
- Existing full Chromium campaign regression passed XLSX import, individual/complete review, one approval, historical retention, private document upload, initial/per-follow-up attachments, ten-step/sixty-day sequences and cancellation.
- Native Worker Gmail regression passed with outbound requests intercepted.
- Native Worker security regression passed signed WebAuthn and intercepted Turnstile verification.
- Native D1/Worker import/follow-up regressions passed concurrent retries, rollback, dry-run, exact approval, deduplication, threading and scheduler-health checks in local storage.
- Native document runtime passed actual private KV round-trip and unsafe/malformed PDF rejection with all outbound network forbidden.
- Production dependency audit: zero vulnerabilities reported.
- Existing Vercel project deployment finished READY and its canonical production alias was updated.
- Canonical landing page: HTTP 200. Health: HTTP 200, Gmail ready, KV storage, live email enabled. Unauthenticated auth/me: HTTP 401 as expected. API responses retained private/no-store headers. Both CSV and XLSX downloads returned HTTP 200 with expected types.

## 14. Remaining limitations and ownership of changes

Genuine verification inbox delivery remains blocked on the owner's provider account, approval/sender and credentials. No paid service or card-dependent plan was added. The operator setup above is necessary; the frontend cannot make an unconfigured transactional sender work.

Tour/lesson progress is browser-local and does not synchronise between devices. Practice deliberately resets on page exit. Demonstrations are illustrated scenes, not actual exported videos. Accessibility checks covered keyboard operation, focus behavior, semantic controls, mobile overflow, light/dark screenshots and reduced motion; a formal screen-reader audit was not performed.

Backend Gmail reply cancellation and MIME behavior were tested with intercepted providers; no live professor reply or live send was manufactured to certify them. Production checks preserve their existing architecture and data rather than claiming universal inbox/reply detection guarantees.

The workspace already had substantial uncommitted backend, importer and frontend changes when this task began. They were preserved. This task added learning/practice modules, guide-config generation, UI integration, contextual campaign help and safety/browser tooling. It did not redeploy those pre-existing Worker changes, run migrations, or commit/push the entire working tree.

Relevant implementation: `apps/web/app/learning-ui.tsx`, `learning-content.ts`, `product-tour.tsx`, `shared/practice-campaign.ts`, `scripts/generate-learning-config.cjs`, `scripts/learning-browser.cjs`, `scripts/onboarding-production-safety.cjs`, and `apps/api/tests/practice.test.ts`.

Final operational recheck: Cloudflare briefly returned internal errors/timeouts during an additional read-only check. No deployment or production mutation followed those errors. A bounded health probe then returned HTTP 200 and a fresh successful scheduler heartbeat. The subsequent reduced-query full capture, encrypted round-trip/local restore, attachment checksum and baseline comparison all passed again: 6 approvals, 5 pending initials, 50 unqueued uncancelled follow-up steps, 17 delivery records, no message status transitions and unchanged cron/Worker bindings. The last successful encrypted snapshot is `apps/api/.wrangler/onboarding-production-1793684393680.dpapi`. The checker now derives column metadata locally from captured schema and bounds network requests, reducing production inspection load.
