# Campaign management release ? November 4, 2026

Production: https://ms-professor-agent-malang43.vercel.app/

## Required final report

| # | Requested result | Outcome |
|---|---|---|
| 1 | Previous Gmail reply coverage | Read metadata from known Gmail threads and match recipient/date. No explicit Spam/Trash message-list search, folder metadata, or folder-specific warnings. It was not restricted to an INBOX label, so it would be inaccurate to describe previous coverage as Inbox-only. |
| 2 | New Gmail reply coverage | Known-thread metadata plus paginated sender searches with `includeSpamTrash=true`; Inbox, Spam, Trash, archived/All Mail and custom-label messages. Cross-thread candidates require a known thread or matching RFC References/In-Reply-To. Matching also checks sender, sent time and SENT labels. |
| 3 | Spam/Trash cancellation | Confirmed replies use the existing reply/sequence cancellation transaction. Remaining unsent steps stop. A reply to a follow-up also marks the original recipient Replied. |
| 4 | Inbox styling | Existing normal reply styling retained. Warning styling applies only to `reply_warning`; Inbox does not produce a red folder warning. |
| 5 | Dashboard notifications | Persistent per-user normal notifications and additional Spam/Trash warnings include campaign context. Unread count, mark-read and campaign navigation are present. Repeated polls do not duplicate a reply; folder moves update metadata and warning state without resetting read status. A real already-known Trash reply acquired its additional warning during observation. |
| 6 | Daily allowance | 50 outgoing submissions per user and connected mailbox over the preceding 24 hours, enforced atomically in D1 at submission reservation. Initial emails and follow-ups share the ledger. Existing attempts and legacy delivery evidence count. Usage and next allowance are shown. |
| 7 | Pacing | Exact 60-second minimum enforced for both user and mailbox, including across calendar-minute boundaries. Existing provider restrictions, global safeguards and retry/reconciliation behavior remain. Exhaustion postpones approved work. |
| 8 | Campaign names | Editable name in the shared approval controls, including manual entry and all import methods. Names are trimmed, nonempty and limited to 160 characters. Approved campaigns persist the name. |
| 9 | Campaign-first Outreach | Named approved-campaign cards, separate draft import groups, name search and Drafts/Scheduled/Active/Completed/Cancelled filters. Cards show counts, status and next-action information. Draft names are suggested; users edit the campaign name during approval. |
| 10 | Scoped campaign details | Stable campaign/import IDs scope professor/message rows and selection. Initial emails and follow-ups are labeled. Existing message review provides approved contents, schedules and attachments. Activity is ownership-checked and paginated; sequence steps and reply locations are included. |
| 11 | Existing campaigns/renaming | Original approval IDs and records retained. Generic/unnamed historical campaigns get a date-based display fallback. Renames use separate owner-checked metadata and never modify immutable approvals, message content or timing. |
| 12 | Previous-contact detection | Server-side normalized-email checks span the same user's campaigns and legacy initial outreach. Evidence distinguishes submitted/sent, pending, replied and active follow-ups. Draft-only, cancelled-unsent and failed-before-submission records are not falsely described as contacted. |
| 13 | Individual duplicate highlighting | Every matching professor/address and previous campaign/status appears individually in the red duplicate review. Multiple prior matches remain visible. |
| 14 | Change Recipients / Approve Anyway | Change Recipients returns control to the editable review without authorizing mail. Approve Anyway requires a separate unchecked acknowledgment plus a separate confirmation button. Final approval repeats the server check. |
| 15 | Duplicate audit | Immutable duplicate review records retain the exact acknowledged history; audit records identify the override campaign. A database approval fence rejects concurrent/stale history. Repeated approval cannot create additional transports or sends. Mandatory suppressions still apply. |
| 16 | Protected campaigns/attachments | All 9 original approvals, 51 authorizations, approved message content/timing, 92 follow-up step definitions, 66 attachment references and 42 attachment pins preserved. Both Gmail connections and the third connection retained their identities/states. Five active private attachments passed read-only checksum/size checks. Natural scheduler activity is detailed below. |
| 17 | Tests | Final full suite: 453 tests across 24 files. API/frontend typechecks, production frontend builds, baseline/new Worker builds, local migration restore/integrity checks, native Worker Gmail and native authentication/Turnstile checks passed. Desktop/mobile and light/dark browser checks passed locally and against published assets, with every API request fulfilled by isolated fixtures. |
| 18 | Deployments | Cloudflare Worker `0c261307-2e4e-4b62-84e8-992e6f3520b7` active at 100%; bytes match tested upload and bindings match. Vercel `dpl_Eq2kKLzkczZ2rKEfyNpb4j64Go2D` READY on the existing production alias. Public health is HTTP 200 with Gmail ready and KV storage; unauthenticated state remains HTTP 401/private/no-store. |
| 19 | Manual/configuration action | No new provider, subscription, payment card, credential or account setup is required. Refresh the application. Existing Gmail/Google provider restrictions still apply. Use the existing campaign cancellation controls via the link in campaign details. |

## Production preservation evidence

The first operation against production was a read-only snapshot. Wrangler authentication was refreshed after an expired-token response; Gmail tokens were never reset. Full D1 tables/schema and Worker settings/schedules were encrypted with Windows CurrentUser DPAPI, decrypted for round-trip verification and restored only into local memory. Integrity and foreign-key checks passed. Active attachment objects were read and checksummed; no KV object was changed. These are private local artifacts under the ignored `apps/api/.wrangler` directory, not public deployment files.

- Starting backup: `onboarding-production-1793797270069.dpapi`.
- Final protected-state observation: `onboarding-production-1793800649311.dpapi`.
- Additive migration: `0015_campaign_management.sql`. It creates metadata/review tables, indexes, views and guards; it does not update, delete, recreate or reschedule existing campaigns.
- The migration was first applied to the restored production snapshot, proving every existing table row unchanged.
- Before deployment, source comparison accounted for one already-existing equivalent extraction of spreadsheet field constants; all other normalized baseline Worker code matched production.
- The one-minute cron, bindings, plain variables, secret bindings and Google connections were preserved.

| Protected/runtime measure | Starting observation | Final observation |
|---|---:|---:|
| Campaign approvals | 9 | 9 |
| Message authorizations | 51 | 51 |
| Message records | 67 | 67 |
| Pending initial emails | 9 | 3 |
| Unqueued uncancelled follow-ups | 74 | 74 |
| Follow-up step records | 92 | 92 |
| Attachment references | 66 | 66 |
| Attachment pins | 42 | 42 |
| Connections | 3 | 3 |
| Delivery records | 32 | 38 |
| Delivery attempts | 30 | 36 |

Six previously approved initial emails became due and were sent naturally by the existing scheduler during the release window. Each transition was checked against its original approval, original scheduled timestamp, existing transport backoff, one new attempt, confirmed Gmail receipt and `provider.sent_confirmed` audit entry. There were no test/development sends and no manual scheduler invocation. Original delivery history remained unchanged. Five previously null runtime follow-up dates materialized from actual delivery time plus their unchanged approved delay; these are legitimate relative scheduling calculations, not edits to approved timing. No existing follow-up was cancelled by this work.

The poller also added location metadata for an existing Trash reply and one additional `reply_warning`. It did not duplicate the mailbox reply event.

## Verification artifacts and limits

Private evidence includes `management-final-tests.json`, `management-migration-verification.json`, `management-source-comparison.json`, `management-natural-transitions.json`, `management-production-verification.json`, encrypted snapshots and browser screenshots. Published-asset browser checks use an isolated in-memory backend; they do not create production test campaigns, approve existing messages or send Gmail mail.

Reply checking remains bounded polling with the existing per-thread backoff, not push delivery. Confirmed replies stop unsent follow-ups immediately when processed. Custom labels are represented neutrally by reliable label metadata; human-readable custom label names are not guessed. The existing global anti-abuse budget and Gmail restrictions can postpone work even when a user's rolling allowance has space.

Automatic approval review rejected adding another cancellation action. The safer completed alternative preserves the existing controls and links to them from campaign details. No additional cancellation action was deployed.

Gmail API reference used to verify folder-inclusive listing: https://developers.google.com/workspace/gmail/api/reference/rest/v1/users.messages/list
