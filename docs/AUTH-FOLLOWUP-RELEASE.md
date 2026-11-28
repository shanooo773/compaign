# Authentication and follow-up release — October 26, 2026

Production: https://ms-professor-agent-malang43.vercel.app/

## Production investigation

Read-only D1 evidence identifies an initial-only approval, rather than a broken authorized schedule. Irshad's message `b9f7968b-e210-4f1e-b423-914788915161` is confirmed sent at `2026-10-26T16:04:45.637Z`; its immutable authorization has `followup_authorized=0`, a null approved follow-up, and its campaign has `followup_count=0`. The imported one-day subject/body are retained as a proposal, with no automation row. The hypothetical due time is October 27, 2026, 21:04:45.637 Asia/Karachi. It will not send without a separate explicit approval.

Talat's message `1bc4043f-4068-4589-af36-b3ac9c62ac8e` is confirmed sent at `2026-10-26T16:01:48.344Z` and its current status is `replied`. Its campaign also approved initial emails only. No follow-up was activated for either recipient, and neither initial message was resent.

## Implementation

- An explicit review button approves the exact inactive follow-up separately, retaining original campaign/authorization records. Due times derive from confirmed initial sending. Changed proposals, replies, suppression, missing reply access, and incomplete mailbox checks block approval. Approval does not resend the initial email.
- Follow-up delivery performs another complete provider reply check after token/attachment preparation, with a final database fence against a replied parent. Existing unique jobs, leases, uncertain-outcome reconciliation, quotas, cancellation and retry rules remain.
- Optional standards-based WebAuthn through SimpleWebAuthn supports multiple named resident passkeys, verified registration/login, removal with password reauthentication, and passkey-based password recovery. Origin/RP ID come exclusively from APP_ORIGIN. Challenges expire in five minutes and are atomically consumed. User verification is mandatory. Ordinary password login remains.
- Ten 128-bit recovery codes are displayed once and can be downloaded. Only SHA-256 hashes are stored. Generation requires password reauthentication and replaces prior codes. Redemption/password replacement/session revocation share a D1 transaction. Recovery endpoints apply IP, global and address limits with generic account/code errors.
- Turnstile uses managed widgets, hostname/action/age validation, server-side Siteverify, single-use validation and a D1 replay fence. Signup rate limits remain. Keys alone do not activate enforcement: TURNSTILE_ENABLED must also be true. Cloudflare secret material remains in secret_text storage.
- Labels distinguish confirmed Gmail delivery from simulation, display Email Not Verified, describe separately approved due times and reply cancellation, and provide mobile-friendly security setup/recovery flows.
- Zod and compatible tool dependencies are security-patched. Import validation uses Zod 4's explicit record key/value schema.

## Migration and preservation

Migration 0007 adds recovery_codes, passkeys, auth_challenges and followup_approvals. Existing campaign approvals, scopes, historical deliveries, Gmail credentials and accounts are not rewritten. Original follow-up audit remains immutable. The automation insert guard accepts only the exact separately approved rule when initial approval excluded follow-ups. Existing account deletion also cleans enrolled security options. Private production verification retains aggregate SHA-256 fingerprints rather than storing sensitive database rows.

## Verification and pending configuration

Automated checks cover cryptographically signed synthetic WebAuthn responses, wrong origin, absent user verification, replay/expiry, passkey isolation/removal, concurrent single-use recovery, account cleanup, mail-disabled signup, Turnstile failure/replay, exact separate follow-up approval, immutable original approval preservation, replies, due times and duplicate queueing. Existing campaign/provider/session/isolation tests remain.

Native Workers runtime checks exercise real WebAuthn cryptography and intercepted Turnstile Siteverify, plus Gmail send/threading/reply/profile/token HTTP. Local Chromium checks use an isolated database and virtual authenticator; no production account or real email is created.

Automatic approval review rejected changing the existing workspace verification gate, including an explicit dashboard/profile/professor/private-document route allowlist. The user was asked for explicit approval of that scope. Until approved, new accounts can register and sign in but remain workspace-gated; pending accounts are preserved. This requested registration-access change is not represented as completed.

Deployment identifiers and final check counts are recorded after release.

## Verified release results

Application source commit: `404cd55bed42a4b99c77b693dbb0967aec3b04bc`, pushed to the existing private main branch. GitHub CI succeeded: https://github.com/Malang43/MS-Professor-Agent/actions/runs/40369608865 .

244 automated tests passed in 14 files. Both workspace TypeScript checks, the optimized frontend build and full npm audit passed; audit reported zero vulnerabilities. Both native Workers checks passed. Local browser authentication/recovery and original Excel/campaign workflow checks passed with zero deliveries.

Migration `0007_auth_options.sql` applied successfully to production. Worker version `e70b7eb6-7ac5-4718-ae68-26066e05fb32` is deployed on the unchanged service and minute cron. The retrieved deployed module exactly matches the reviewed bundle, SHA-256 `434f48d19ac6fdfee1f7b7de95dc7cb963a0b0ec03205183e0a16e11f0e9cb2a`.

Vercel automatically deployed application commit 404cd55 and reported READY as deployment `dpl_3ZDnRRCP5QoNCNsqnWJa636oA9Zw`, retaining the canonical URL. Canonical production assets include the recovery/passkey and separate-follow-up approval UI and the Turnstile CSP entries. Direct Worker and Vercel proxy checks both passed: Gmail provider/live status and mailbox readiness, KV storage, required passkey user verification and canonical RP ID, no-store caching, authentication denial and foreign-origin denial.

### Remaining owner actions

1. Irshad: review the exact proposal in the existing email details and click **Approve this exact automatic follow-up once** only if desired. This is separate explicit consent; the original initial-only campaign stays unchanged. No approval has been applied by this release.
2. **Subsequently approved and implemented: see [LIMITED-WORKSPACE-RELEASE.md](LIMITED-WORKSPACE-RELEASE.md).** Original request: approve the pending question for signed-in unverified users to view their own dashboard, edit their academic profile, manage professors, and upload/read/delete private documents while mailbox connections and email sending remain verification-gated. Automatic approval review rejected that gate change; it has not been applied.
3. Turnstile: production keys and a Managed widget already exist for the exact hostname, but enforcement is off. The locally prepared, ignored owner helper can open a visible verification browser when the owner explicitly invokes `node apps/api/.wrangler/verify-turnstile-browser.cjs --headed` from the project root. Complete the challenge. Only after its PASS confirms genuine hostname/action-matched Siteverify should the owner set **Workers & Pages → ms-professor-outreach-api → Settings → Variables and Secrets → TURNSTILE_ENABLED = true** and deploy the settings change. Do not paste the secret into chat, Git or frontend environment variables. No widget creation or key purchase is needed.
