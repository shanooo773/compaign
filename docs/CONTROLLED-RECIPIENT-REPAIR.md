> Historical release record. Current limits, templates, timezone handling and safety behavior are documented in [Excel-driven follow-up upgrade](EXCEL-FOLLOWUP-UPGRADE.md).

# Controlled test recipient recognition � 29 October 2026

## Root cause and configuration

Production LIVE_TEST_RECIPIENTS contained raza1206896@gmail.com and muslim1206896@gmail.com, but omitted the owner-controlled irshad1206896@gmail.com. testRecipients() normalizes the comma-separated server variable, and complete campaign approval checks exact membership. Consequently this address reached the external rule that permits one follow-up after at least three days. This was a missing server configuration entry, not an Excel-column defect.

The owner explicitly attested ownership/control and authorized the existing secure allowlist mechanism. The deployed configuration appends exactly irshad1206896@gmail.com, preserves both existing entries, and preserves LIVE_OWNER_USER_IDS and all other bindings. This is administrative owner verification under the existing mechanism, not a newly performed Gmail ownership challenge. No domain-wide exception, spreadsheet authorization flag, opt-out removal or external-recipient relaxation was introduced.

## Safe validation

The existing POST /api/messages/approve endpoint now accepts dry_run:true. It builds and validates the same complete plan as real approval and returns before the D1 write batch. Its response reports would_schedule, would_authorize_followups, controlled_test, and exact step timings, while scheduled and authorized_followups remain zero. A dry run never creates an authorization or permits future sending; a real approval always reruns the checks. Dry-run requests cannot fall through to the mock approval branch.

Normal one-time approval is unchanged: the existing transaction stores the initial email snapshot and all exact conditional follow-ups together. No second approval is required per step. The existing reply-trigger cancellation, suppression/decline/opt-out protections, owner gate, reply scope/readiness checks, immutable authorization snapshots, idempotency, and duplicate-send protections remain in force.

## Validation

- 312 tests passed across 19 files. New tests cover the exact controlled address, four five-minute steps, zero database writes/network calls on dry-run success, external safeguards when absent from the allowlist, opt-out refusal, reply/readiness requirements, and safe mock-mode dry-run routing.
- Existing regression tests verify one-time exact multi-step authorization, no duplicate queue/send, and cancellation of all remaining steps when a reply arrives after zero through four follow-ups. Provider calls in these tests are intercepted; no production approvals or real emails are involved.
- Native Workers/workerd with isolated D1 passed the controlled Gmail dry-run for one initial plus four five-minute steps, along with import concurrency and rollback checks. All outbound requests are forbidden; authorization, campaign-approval, follow-up-step and delivery tables stay empty.
- Workspace type checks and the optimized frontend build passed.
- Production counts for messages/approval states, authorizations, follow-up steps, Gmail connection states, deliveries, campaigns and suppressions stayed unchanged. A digest confirms all unrelated production bindings are unchanged.
- No already-approved pending message or active uncancelled follow-up existed for this recipient when recognizing it, so the change has no preauthorized target work to activate.

Worker version: b99da672-2821-4a87-bf0e-f67242c5bf93. The existing Vercel site uses its same-origin rewrite to this Worker; no UI or infrastructure replacement is required.

Production browser verification passed: reconstructed XLSX from the saved campaign, Manual content, complete campaign review, and actual POST /api/messages/approve with dry_run:true returned HTTP 200, controlled_test:true, would_schedule:1, would_authorize_followups:4 and total_messages:5. All steps are five minutes (first relative to original, others relative to previous). To avoid another campaign, the QA harness replayed the exact existing payload under its original submission ID; import returned created:0 and the same draft ID. The existing draft remained status=draft, approved=0, live_ready=0, with zero authorizations and zero follow-up records. No real approval button was clicked and no send endpoint was called. No further allowlist configuration is required.
