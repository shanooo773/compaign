> Historical release record. Current limits, templates, timezone handling and safety behavior are documented in [Excel-driven follow-up upgrade](EXCEL-FOLLOWUP-UPGRADE.md).

# Repeat campaigns and campaign-scoped duplicate prevention

October 29, 2026, Asia/Karachi.

## Correction

Previously, Excel imports searched all historical messages for matching professor, content and UTC schedule, and Gmail approval fingerprints were global across campaigns. A cancelled, completed or removed message could therefore prevent a genuinely new campaign. Professor deletion also inserted an address-wide `professor_deleted` suppression.

Each new upload now receives its own import identity, with fresh message records and later fresh immutable campaign authorizations. Duplicate prevention uses that import identity plus recipient. The same upload retries safely, even concurrently; changing its payload under the same submission ID is rejected. Uploading the exact same workbook again creates new drafts, including when every content field and scheduled timestamp matches history. Dates are taken from the newly reviewed workbook, not copied from an old campaign. Legacy row-array API clients retain draft retry deduplication and can import again after approval, cancellation, archive or deletion.

Approval fingerprints include the new import identity, or the unique draft identity for independently composed messages. A single approval cannot contain duplicate initial recipients. Repeating approval of already approved message IDs cannot create another send. Existing provider idempotency, uncertainty reconciliation, rate limits, authorization fences, and test-recipient safeguards remain in force.

Professor deletion cancels that record's pending messages and follow-ups, but no longer creates an address-wide block. New imports may create fresh active professor records while deleted records remain tombstones. Migration 0010 removes existing deletion-only suppressions, preserves genuine recipient decline/opt-out/bounce evidence as a historical recipient block when necessary, and leaves manual/account-level blocks intact. Reimport also checks historical suppression evidence. Removing a campaign from the dashboard stops all of its remaining multistep follow-ups permanently. No cancelled or deleted campaign is rearmed, and old approvals are not rewritten.

## One approval

The Excel wizard retains Manual / Use Excel content and AI-assisted preparation, followed by individual review or complete campaign review. Complete review displays every initial email and every proposed conditional follow-up, exact recipients/content, intervals, timing references, stop conditions and maximum message count. Initial messages are expanded for review. The single final button remains `APPROVE & SCHEDULE COMPLETE CAMPAIGN`.

That approval persists the full exact sequence. No later manual preparation or approval is required for its authorized steps. Reply checks, declines, opt-outs and account restrictions still stop sending. Existing minute/hour/day scheduling and up to five controlled-test steps remain unchanged. AI preparations are cached within the upload so a retry cannot silently regenerate different approved content. Excel upload alone never authorizes sending.

## Verification

- 300 API tests across 17 files: repeated campaigns after completed/cancelled/archived/deleted/removed/replied history; identical content/schedules in fresh uploads; concurrent import retries; changed-payload rejection; repeated approval rejection; duplicate recipients within a campaign; preserved genuine suppressions; a complete new five-step sequence approved once after cancelling its identical predecessor; all existing scheduling/provider/authentication regressions.
- Migration regression starts with the historical schema and checks deletion-only cleanup, retained decline/account-block evidence, and unchanged old message fields.
- Native Workers runtime with real local D1 applies all migrations, retries a cancelled import, creates a new import to the same recipient, and retains scheduler, Gmail-threading and duplicate-send checks. All provider traffic is intercepted.
- Browser regression uploads the real XLSX template, approves once, cancels, uploads the identical workbook again, approves the fresh campaign once, and checks that the old message and authorization remain unchanged. Individual review, AI fallback and mobile layout also pass. No real emails are sent.
- Both workspaces typecheck and the production frontend builds.

## Production

Migration `0010_campaign_import_identity.sql` applied successfully to existing production D1. The two existing deletion-only restrictions were removed; production suppression counts are now empty. No new import was created or approved in production during verification.

- GitHub application commit: `9de18ba` on `main` in the existing private repository.
- Worker version: `e8db29c0-005f-4aba-aa26-1ecb737eaf8e`.
- Deployed Worker bundle SHA256: `f9ba0f8f3312e3653b80098b025f674c3fd2e0766388455ce3f0bc85f57c30ba`, matched byte-for-byte against the tested release bundle.
- Vercel deployment: `dpl_GW6f3aHEywvxTnbR3jVVkZRFnRfC`, READY and aliased to `https://ms-professor-agent-malang43.vercel.app`.
- Canonical live API health: HTTP 200, Gmail ready, live sending enabled, KV storage. Unauthenticated state access and cross-origin requests remain blocked. Live XLSX/CSV downloads match local release bytes.
- Automatic cron remains registered every minute; post-release start/completion timestamps advance with no recorded failure. No manual scheduler run or real email was used for verification.
- Production variables and binding metadata exactly match the pre-release baseline. Protected account/document/connection hashes and immutable message authorizations match. Existing Gmail, OAuth, Turnstile, passkey/recovery, Groq, account and document settings were not reconfigured. No paid service was activated and no historic email was resent.
