# Complete MS Professor Agent upgrade

Released November 1, 2026 (Asia/Karachi). This is the current release; earlier reports describe historical limits.

## Delivered behavior

- The complete requested follow-up sequence now supports 60 days and up to ten Excel-defined steps. Exact positive integer minute/hour/day delays and original/previous anchors are preserved. No missing step is invented. Valid 4445-day files are accepted; sequences beyond 60 days receive a specific error. Existing approved schedules are unchanged.
- Importer, API validation, scheduler, manual composer, review and downloadable CSV/XLSX templates agree. UTC ISO timestamps remain absolute. Excel date cells require explicit timezones; 1900/1904 workbooks and Pakistan/Korea conversions are tested without guessing timezone.
- The deployed UI includes refreshed public/account pages, dashboard, navigation, tables, import/review, documents, settings, status and progress indicators, responsive light/dark styling, keyboard support and reduced-motion handling.
- The supplied photograph is copied unchanged from apps/web/developer-photo.jpeg to apps/web/public/developer-photo.jpeg. The introduction uses /developer-photo.jpeg, all five exact requested credit lines, circular portrait, subtle animation and an obvious skip control. It does not interrupt authenticated navigation.
- Complete review includes Email Attachments with private owner document names, types, sizes and availability. Select the same CV for all professors, multiple files, or per-professor initial overrides. Initial-only is the default; follow-up files require explicit selection for each step.
- One Approve Complete Campaign action records the complete immutable recipients, content, schedules, sequence and attachment plan. Subsequent edits require fresh review and approval. Existing approvals are neither expanded nor rewritten.
- Selected files become actual Gmail MIME attachments, not download links. Ownership, checksum, structure, availability and size are checked before approval and again before sending. Missing required files postpone delivery; they never become an attachment-free message.
- Existing two MiB per-file limit remains. Campaign selection permits at most three distinct documents and two MiB total attachments per message; encoded MIME has a four MiB safety ceiling.
- Approved active campaigns pin private files through the scheduled start plus 60 days and a seven-day retry window. Near-expiry active pins renew securely. Completed/cancelled plans release pins; ordinary expiry/deletion cleanup resumes. A separate physical-object expiry ledger keeps KV capacity/account-deletion reservations accurate even after logical retention ends or deletion fails.
- Reply checks cover prior threads before every follow-up. Replies, declines, opt-outs and blocks cancel remaining work. Overdue scheduling resumes without changing requested delays. Leases, send fences, deterministic children and receipt reconciliation preserve duplicate prevention.
- One-minute pacing and ten-per-day limits remain. Actual delivery can occur later than requested because of provider limits, failed reply checks or safety controls. Permanent provider rejections are not automatically retried.
- Gmail OAuth, account isolation, passkeys, recovery, Turnstile and existing authentication protections remain. Mailjet remains removed from active code, configuration requirements and deployment. No paid service or new hosting was introduced.

## Verification

All 352 automated tests passed across 20 files. Both workspace typechecks and production frontend build passed. Production dependency audit found zero known vulnerabilities; patch whitespace check passed.

Coverage includes zero/one/three/five/ten follow-ups; 30/44/45/60-day sequences and over-limit rejection; exact mixed delays; timezone/date conversion; replies after initial and between steps; cancellation; duplicates; immutable approval; prior campaign migration; selected initial and explicit follow-up MIME files; ownership/expiry/corruption/size rejection; no send with unavailable files; 45-day retention and cleanup; and failed-deletion physical quota accounting.

Native Workers/workerd/D1/KV tests passed with all migrations, actual private uploads, complete approval, ten-step/60-day scheduling, real MIME construction, cancellation, cleanup and intercepted provider traffic.

Isolated browser tests passed actual XLSX/CSV import, complete and individual review, one-time approval, repeated campaigns, document selection, explicit tenth-step attachments, mobile/dark dashboard, photo/introduction/skip and reduced motion. Live read-only desktop/mobile checks passed photo/introduction rendering and no horizontal overflow. No actual outreach email was sent and no existing production campaign was approved.

Production account counts, document integrity metadata, Gmail connection identifiers/status/scopes, approval identities, campaign counts/times and exact scheduling state matched pre-upgrade non-sensitive fingerprints. Worker settings and cron schedules also matched. Credentials were not exported or reset. D1 foreign-key checks passed.

The earlier PDF fix remains included: normalized extension and safe generic MIME support, proper PDF parsing and precise errors replace the original combined boolean/raw-token rejection. Benign Word-style opening destinations are allowed while malformed, spoofed and active-content files remain rejected. The user's original CV was not supplied, so its exact historical failing branch remains unconfirmed; see PDF-UPLOAD-FIX.md.

## Production deployment

Production: https://ms-professor-agent-malang43.vercel.app/

- Cloudflare Worker version: afffbaf0-add2-4fad-8b3f-9cdcca4af561 (100%).
- Worker artifact SHA-256: e224f3d5f6559392b5ef353fb26b260a2b0b216bb817f3e3f51c2c7318db5302.
- Vercel deployment: dpl_EqcYj3JcXCQjGGPUtw6YnXBxXnnV (READY; existing production aliases).
- Additive migrations 0011, 0012 and 0013 applied. Existing records and immutable approvals preserved.
- Deployed Worker exactly matches both dry-run and release artifacts. Published CSV/XLSX match local templates. Original photo bytes match production exactly.
- Photo SHA-256: 2c409da7a9888f0ce9e83a245a75f57da549dec6d4a9c6df592c3f4629a59c5c.
- Direct Worker and Vercel proxy health, Gmail/KV configuration, unauthorized access rejection, foreign-origin rejection, private API caching and page CSP passed.

## User action

Refresh the application, upload/select the CV in Documents, import the existing workbook, review all messages/timing/attachments and click Approve Complete Campaign once. A newly uploaded KV file may need its displayed propagation delay before approval. No Excel workaround for the former one-follow-up/three-day or 30-day restriction is required. No new credentials or paid service setup is required.
