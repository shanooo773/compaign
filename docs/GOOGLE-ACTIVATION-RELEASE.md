# Google student activation release — 3 November 2026

Production: https://ms-professor-agent-malang43.vercel.app/

**Status: deployed and verified for the real new-student Google activation. After the owner added the student to Google's Test users, the student completed real authorization. Read-only production checks at 07:42 UTC confirmed matching verified identity, Gmail connection and real outreach eligibility. Unrestricted public access remains subject to Google's publishing and scope-verification requirements.**

## Requested outcomes

| Requirement | Result |
| --- | --- |
| Verify new Gmail users without Brevo | Confirmed for the real student after addition to Google's Test users; no transactional provider dependency. |
| Verify identity and connect Gmail together | One flow validates a Google-signed ID token, matching verified email, UserInfo, required scopes, offline access and the actual Gmail profile, then commits verification and a new Gmail connection atomically. |
| Beginner dashboard | “Verify with Google & Connect Gmail” on Overview and Account Settings; explicit created / verification required / in progress / verified / Gmail required / connected / outreach readiness states. |
| Real outreach eligibility | A successful activation creates a tenant-scoped Google identity entitlement. Ordinary Gmail connection, provider readiness, quotas, suppression, review and explicit campaign approval remain required. Owner-only administrative controls are not granted. |
| Mismatch handling | No verification, merge or token overwrite. Clear guidance to retry the matching Google account or register the correct email separately. |
| Password recovery and non-Google limitations | Existing passkeys/recovery codes remain. Google activation is not password reset or Google login. Email-based recovery remains unavailable with transactional delivery disabled. Non-Gmail accounts need authoritative matching Workspace evidence and an enabled Gmail mailbox. |
| Brevo requirement | No Brevo sender, API key, domain or service is required by Google activation. Current student activation prompts and sample setup no longer direct users to configure Brevo. The previously existing optional transactional recovery adapter remains dormant; its deployed settings stay disabled. |
| Original professor campaigns | Protected baseline comparison passed, including original account states, existing Gmail connection metadata, immutable approvals/content/timing, attachments and cron. One legitimate tracked reply cancelled five follow-ups naturally. |
| Deployment | Worker `d2160dec-3097-49d9-b9f1-2c64cf982cc8` serves 100%; Vercel deployment `dpl_DtQaNmWx9DHGhgjRnPBApjdX98pq` is READY at the existing alias. |
| Google configuration | Owner added the student to Test users and the real test passed. Arbitrary-student public access requires Google's production publishing/verification requirements; it is not enabled or certified here. |

## Exact implementation

An authenticated, exact-Origin `POST /api/auth/google/start` is allowed before general workspace verification gating. It is narrowly restricted to new, unverified, non-grandfathered users; the request body cannot choose another user's ID or registered address. Existing verified/grandfathered users retain normal connection controls.

The existing Google client and callback URI are reused:

`https://ms-professor-agent-malang43.vercel.app/api/oauth/gmail/callback`

No OAuth client, secret, redirect URI, consent audience, provider setting or existing mailbox credential was replaced. Cloudflare Turnstile remains enabled in production registration and continues to be verified server-side. Passing Turnstile never sets email verification.

OAuth starts retain the existing account/global attempt budgets. Each activation has a random state, PKCE verifier/challenge, browser-binding cookie, ten-minute expiry, initiating authenticated session binding and a random OIDC nonce. The activation purpose, nonce and registered email are encrypted in the existing state record. A successful callback consumes state once before exchanging a code.

The activation branch uses JOSE `6.2.15` and Google's fixed public JWKS endpoint to verify RS256 signatures, issuer, client audience, expiration, issued-at freshness, nonce and authorized party where present. It checks `email_verified === true`, a stable nonempty `sub`, exact registered-email equality after lowercasing, optional access-token hash, required identity/Gmail scopes and valid offline token lifetime. It cross-checks UserInfo `sub`/email/verified status and Gmail's profile address.

Gmail addresses are authoritative; non-Gmail identities must include a matching Google Workspace hosted-domain claim and a functioning matching Gmail mailbox. A third-party email merely attached to a Google account is not silently treated as current ownership proof. Missing evidence or an unsupported domain leaves the account restricted.

Migration `0014_google_student_activation.sql` adds only an identity ledger and an immutable-binding trigger, plus its migration receipt. It does not alter, copy or delete any existing table or row. The ledger binds one Google `sub` to one local user, with a unique user constraint. An identity already connected to another existing account cannot be stolen for activation.

D1 batch activation guards the still-active initiating session, unchanged registered email, unverified non-legacy state and absence of a conflicting connection. Verification, identity binding, a NEW encrypted Gmail connection, initial read-only mailbox readiness, audit and session rotation commit atomically. Existing Gmail connection rows are never upserted by activation. All old sessions and overlapping OAuth attempts for that newly activated student are revoked; a fresh HttpOnly/Secure/Strict session is issued. Short-lived ID tokens are not stored in mailbox credentials. Failure rolls back activation and connection writes together.

The student's entitlement is consulted by the existing recipient/access checks; it does not grant administrator controls or bypass explicit campaign approval, account ownership, attachment checks, Gmail permissions, suppression, limits or provider pacing. The full scheduled handler and OAuth refresh implementation were compared with the pre-change source and are unchanged.

## Production protection and deployment evidence

Before mutation, all application database tables and settings were captured using a single read-only data statement, encrypted with Windows CurrentUser DPAPI, decrypted/read-back hash verified, and restored into in-memory SQLite with successful integrity and foreign-key checks. Active retained attachment bytes were read-only checked against stored size/SHA-256. Credentials and campaign content were never printed.

Private initial baseline:

`apps/api/.wrangler/onboarding-production-1793688882660.dpapi`

Initial plaintext-payload SHA-256:

`423b3d68c5cb07732282c6455580562e07ef91022d08ba918d3c171f2b3bb732`

These ignored backups require the same Windows account/profile for decryption. They back up application database state; they are not a complete offline archive of all private KV objects or Gmail data.

The pre-change local Worker source bundle matched the deployed Worker after comment/whitespace normalization. Release settings were regenerated from captured production settings. The inactive version's binding metadata matched every production binding, including all five secret binding names; secret values were preserved without secret-put operations. No Worker schedules API was called. The version was deployed through the deployments API, avoiding any cron-trigger update.

An initial automated approval review rejected the exact Worker/frontend production mutations. Deployment stopped; the user then explicitly approved Worker `d2160dec-3097-49d9-b9f1-2c64cf982cc8` at 100% and the tested frontend publication. Only that approved version was released.

The tested upload and exact deployed Worker bytes match SHA-256:

`2356b3e99951197d125e57a8a3114cc263aa71c1bb10c1160f506344931aa110`

The original active version before release was `afffbaf0-add2-4fad-8b3f-9cdcca4af561`. An inactive version upload changes Cloudflare's latest-upload content endpoint, so deployment safety used the actual active-deployments record rather than mistaking the latest upload for live traffic.

### Legitimate processing during the release

The existing scheduler detected one real tracked reply during read-only checks, before the new Worker served traffic. The new provider mailbox event was correlated with the original message's `sent → replied` transition. Five remaining follow-up steps acquired the expected reply-cancellation reason, and one related attachment pin was released. No additional delivery occurred.

| Protected records | Initial baseline | Post-release observed |
| --- | ---: | ---: |
| Campaign approval records | 6 | 6 |
| Pending initial messages | 5 | 5 |
| Pending generated follow-up messages | 0 | 0 |
| Unqueued, uncancelled follow-up steps | 50 | 45, due to the confirmed reply |
| All follow-up records, including cancelled/history | 54 | 54 |
| Original Gmail connections | 1 | 1 preserved; 1 separate new student connection added with consent |
| Delivery records | 17 | 17 |
| Mailbox events | 4 | 5, one genuine reply |
| Original verified account states | Preserved | Preserved; only the consenting new student was newly verified |

Existing recipients, approval snapshots, initial subjects/bodies/dates, exact step delays/units/anchors/authorization timestamps, transport snapshots and attachment metadata match. The existing Gmail connection identity/scopes and authorization were preserved. Its encrypted credential record rotated naturally while the original Worker was still active: baseline expiry 07:03:42 UTC advanced to 08:03:42 UTC, first observed in the 07:15 UTC snapshot, before the new Worker deployment at 07:27 UTC. Refresh leases were clear. That same encrypted credential record remained unchanged across the immediate pre-deployment and post-deployment snapshots. The original refresh implementation is unchanged; no manual refresh or credential reset was requested. New Google activation records remained zero after the reported 403, confirming no false verification or connection from that failure.

Minute cron and Worker binding fingerprints match baseline; the scheduler heartbeat remains fresh with no recorded failure. No real test email, campaign approval, manual send/cron invocation, cancellation, reschedule, destructive migration, D1/KV reset or existing-token update was performed.

## Tests and production checks

- **381 automated tests passed in 22 files**, including 25 new activation tests.
- Tests cover signed identity success, incorrect audience/issuer/nonce/authorized party, expired/future/forged tokens, nonboolean or false email verification, missing scopes, conflicting UserInfo/Gmail identity, third-party email rejection, Workspace evidence, inactive sessions, foreign origins, anonymous starts, state expiry/replay, conflicting existing Google connections, rollback and tenant isolation.
- Registration tests require Turnstile when enabled and assert it does not verify email ownership.
- Isolated Chromium passed the complete registration/Turnstile/login/Google authorization journey, mismatch then retry, matching activation, Gmail connection, outreach access, CSV preparation and campaign review. It asserted **zero approvals, authorizations, transports and deliveries** for that new student. Desktop/mobile/dark rendering passed. Google/Turnstile traffic was intercepted with cryptographically signed fixtures, not real identity approval.
- Native Workers/D1/KV passed signed Google activation, atomic session rotation, replay rejection and outreach state with no approvals or sends.
- Native Gmail, signed WebAuthn/Turnstile, document and follow-up compatibility checks passed with external provider traffic intercepted or forbidden. Existing automated approval tests use isolated local fixture databases; no production campaign was approved.
- API/frontend typechecks and production builds passed. Production dependency audit reported zero vulnerabilities.
- Canonical health returned HTTP 200 with Gmail ready, KV storage and live-email enabled.
- Production anonymous activation start returned HTTP 401; foreign-origin activation start returned HTTP 403; forged callback state returned HTTP 400. API responses retained private/no-store headers.
- Active-deployment inspection confirms the exact approved version at 100%, and deployed bundle bytes match the tested artifact.

## Real Google authorization and live verification

The first attempt was blocked upstream by Google's Testing audience restriction (`403 access_denied`). The project owner then added the exact student Gmail address to Test users and reported successful real Google authorization and Gmail connection. No OAuth client, secret, scope or original account connection was changed by this task.

Read-only production verification at **2026-11-03 07:42:19 UTC** confirmed all of the following:

- Email verification is present and its timestamp matches the Google identity ledger.
- Registered email, Google verified email and connected Gmail address match.
- The connection's stable Google subject matches the immutable student identity binding.
- Gmail is connected, encrypted credentials exist, the access token is current, and both sending and reply-reading permissions are present.
- The mailbox readiness check passed and activation has an audit record.
- The student's outreach entitlement is enabled. The deployed access checks therefore permit real outreach preparation and review, subject to normal limits and explicit approval.
- The student has **zero campaign approvals, zero transports and zero deliveries**. No real-send test was performed.

The deployed dashboard maps these records to the verified-email, Gmail-connected and outreach-ready states. The actual authenticated student screen was not independently opened by the agent; the user reported the successful connection, and the backing production records were independently verified. Fresh registration and Turnstile were exercised in the isolated browser journey; this real test activated the already-created student account.

Private evidence: `apps/api/.wrangler/google-activation-live-student-check.json`. No credentials, email addresses or Google subjects appear in that evidence.

The final encrypted database snapshot was read-back and restore verified. Original immutable campaign records, schedules, account states, attachments, cron and bindings match the initial baseline. The only reviewed campaign transitions remain the one genuine reply and five resulting follow-up cancellations. Delivery records remain 17. The new account's separate connection accounts for the total Gmail connection count increasing from one to two.

A tester list is a limited pilot, not an open student product. Google documents up to 100 listed testers in Testing and authorization expiry after seven days. Publishing status and verification status are separate. Publishing alone does not certify requested Gmail scopes or remove unverified-app limits.

For public access, the project owner must review Google's app publishing, brand/domain ownership, scope verification and restricted-data security assessment requirements. `gmail.readonly` is needed by the existing server-side reply detection; removing it would break the requested workflow. No domain was purchased, no paid assessment was initiated, and no service upgrade was accepted. Whether the existing hosted domain and project can satisfy Google's review must be confirmed by Google; this task does not promise unrestricted public access within the no-domain/no-paid-service constraints.

Official references:

- Google ID-token verification and authoritative email rules: https://developers.google.com/identity/gsi/web/guides/verify-google-id-token
- Testing audience and publishing status: https://support.google.com/cloud/answer/15549945
- OAuth app-state overview and user limits: https://developers.google.com/identity/protocols/oauth2/production-readiness/overview
- Production/domain requirements: https://developers.google.com/identity/protocols/oauth2/production-readiness/policy-compliance
- Restricted-scope requirements and exceptions: https://developers.google.com/identity/protocols/oauth2/production-readiness/restricted-scope-verification

## Remaining work and limits

Real Google authorization and the matching student's activation are now verified. The earlier failed attempt did not verify an account; verification occurred only after the successful matching authorization. This certifies the tested account's activation, not unrestricted Google approval for all future students.

Google OAuth scope approval/public publishing is an external owner/Google action. The complete “every legitimate new student” public-access objective is therefore outstanding. Email password recovery remains unavailable; retain passkeys/recovery codes. Non-authoritative third-party addresses remain restricted. Existing verified/grandfathered users and their scheduled campaign behavior are preserved; no blanket account-state migration was performed.

The workspace contained many pre-existing uncommitted changes. They were preserved; no broad commit/push or reset was performed. The logo export remains untouched.

Final result: the real student is email verified, Gmail connected and eligible for real outreach. No campaign was approved or sent during verification. Original campaigns and the original Gmail authorization remain protected. No additional deployment was needed after the owner corrected the Google tester configuration.
