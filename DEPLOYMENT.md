# No-card deployment and integration runbook

Current release: [Complete 60-day campaign, private attachment and UI upgrade](docs/COMPLETE-UPGRADE.md).

Prepared 2026-10-21 for private repository `Malang43/MS-Professor-Agent`. The mock-default application was deployed with explicit authorization on 2026-10-21. See [the production deployment report](docs/DEPLOYMENT-STATUS.md) for live URLs, resource IDs, verification results, and remaining tasks. Default production uses **Vercel Hobby + Workers Free + D1 Free + Workers KV Free**. No card, trial, paid upgrade, R2 subscription, purchased domain or real professor outreach is authorized. If an account/setup step requires payment details or an ineligible plan, stop that step and report it. No unlimited free usage is promised.

## One-time campaign approval and automatic follow-ups

See [CAMPAIGN-AUTOMATION-RELEASE.md](docs/CAMPAIGN-AUTOMATION-RELEASE.md) for the October 23 release: one Excel upload, full campaign review, one explicit approval of initial emails plus their exact conditional follow-ups, immutable authorizations, actual due times and safe archive/delete/remove actions. Existing Gmail delivery and reply detection are preserved. No real email is sent during release verification; earlier reports below describe their historical releases.

## Real Gmail activation

The current owner has authorized restricted live activation for `raza1206896@gmail.com` and `muslim1206896@gmail.com`, with no email sent before approval of its exact content in the app. See [LIVE-GMAIL-ACTIVATION.md](docs/LIVE-GMAIL-ACTIVATION.md) for the current release and final steps. Normal production disables mock dispatch and simulation controls. Historical mock receipts never become real sends. Professor outreach requires the separate owner-only activation button after successful controlled deliveries and a detected reply. Preserve existing Groq configuration, Gmail credentials and production data. Earlier release reports below record their historical disabled-live state and do not override this release.

## Current simplified campaign workflow

The current repeat-campaign correction is documented in [REPEAT-CAMPAIGN-RELEASE.md](docs/REPEAT-CAMPAIGN-RELEASE.md): new uploads create independent campaigns even for previously contacted recipients, retries are scoped to the upload, deletion alone never permanently blocks an address, and genuine opt-outs remain enforced. One complete approval still authorizes every displayed initial email and conditional follow-up.

## Historical transactional account email

The provider integrations below are retained for compatibility and are inactive in production.

## Excel-to-Gmail automation verification

See [EXCEL-GMAIL-VERIFICATION.md](docs/EXCEL-GMAIL-VERIFICATION.md) for the full Excel template, atomic import and retry behavior, inactive follow-up proposals, configurable 1-30 day delays (including 3), final reply checks, mailbox limits, verification and live-test boundaries. That report describes the earlier disabled-live release; the current restricted-live release is documented above.

## Previous Research Studio production release

The Research Studio/account-security release is deployed and verified. See [STUDIO-PRODUCTION-STATUS.md](docs/STUDIO-PRODUCTION-STATUS.md) for actual Worker/Vercel revisions, checks and owner-dependent blockers. Live outreach remains disabled; the owner's existing Groq configuration is preserved. Transactional verification/reset delivery is not yet configured.

## Account and Research Studio release

See [STUDIO-RELEASE.md](docs/STUDIO-RELEASE.md) for the additive 0003 account-security migration, identity/verification/recovery/deletion behavior, responsive light/dark UI, validation and owner setup. Existing accounts retain legacy access; new accounts are gated until genuine email verification. Transactional delivery is unconfigured and must not be claimed operational. The current owner production Groq configuration is enabled and must be preserved during release, alongside Gmail credentials, encryption key, administrator quota allowlist and LIVE_EMAIL_ENABLED=false. Source defaults remain mocked/disabled for new deployments. No migration deletes existing production data or resets quotas.

## Historical readiness before live activation

For the October 21 live quota, Gmail and stopped-outreach investigation, see [PRODUCTION-DIAGNOSIS.md](docs/PRODUCTION-DIAGNOSIS.md). The normal OAuth allowance is 5 starts per UTC day; the designated server-allowlisted test account retains 15, with a shared global cap of 50. Gmail and Outlook share the budget and failed/cancelled starts count. The observed October 21 allowance resets October 22 at 05:00 AM Asia/Karachi. The quota reporting fix was approved for commit, push and Worker deployment on October 21; limits and existing credentials must remain unchanged.

| Component                                                                                 | State                                                                                                                                                         |
| ----------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Profiles, imports, dashboard, approvals, UTC scheduling, mock drafting/delivery and audit | Implemented; existing tests preserved                                                                                                                         |
| KV uploads/downloads/deletion, quotas, expiry and cleanup                                 | Implemented; fault tests and real local Worker smoke check passed                                                                                             |
| Same-origin Vercel proxy, cookies, CSRF and no-store                                      | Production Chromium signup/login/logout, import, upload/download/delete, isolation, CSRF and no-store checks passed; small-height sidebar limitation recorded |
| Gmail/Outlook OAuth, encrypted tokens, refresh/disconnect and API adapters                | Implemented and mocked-tested; registrations, credentials, consent and live certification missing                                                             |
| Outbox, claims, quotas, uncertain reconciliation, replies and capped follow-up            | Implemented with mocked-provider tests; live sending disabled                                                                                                 |
| Groq                                                                                      | Optional safe template selection implemented; key/model/free-account confirmation missing; fallback works                                                     |
| Cloudflare access                                                                         | Authenticated account; Workers Free confirmed by owner; D1 and KV created and migrated, Worker deployed; no R2                                                |
| Vercel access                                                                             | Authenticated as malang43; m-farhat-mehdi Hobby scope verified; frontend deployed using CLI                                                                   |
| Production                                                                                | Mock production verified; OAuth enabled for connection testing; real sending and Groq remain off                                                              |

## Temporary administrator OAuth test allowance

The server-only `OAUTH_ADMIN_TEST_USER_IDS` configuration permits **15 OAuth connection starts per UTC day** for explicitly allowlisted existing account IDs. All other accounts retain **5**, and the application-wide limit remains **50**. Gmail and Outlook share the same account budget. This grants no other administrator privileges and does not enable sending or AI.

The designated test email was resolved through a read-only D1 lookup to its existing immutable account ID. The prepared allowlist contains only that ID in ignored `apps/api/.wrangler/oauth-admin-test-config.json`; no personal identifier is embedded in application source or `.env.example`. Request bodies, profile names, email claims and client-side flags cannot set this configuration or override the authenticated user ID. An absent/empty/unmatched allowlist retains the normal limit.

Existing `usage_counters` keys, values and UTC periods are reused unchanged. At a count of 5, an allowlisted account receives at most 10 additional starts, subject to the shared global allowance. Failed/cancelled attempts still count. There is no quota reset or separate fresh administrator counter.

Per owner preference, the override remains until explicitly removed. Clearing/removing the allowlist restores 5 without rewriting usage; an account already above 5 must wait for the next UTC period. It does not cancel an already started OAuth flow or change PKCE/state/session/cookie validation.

The owner approved pushing/deploying the reviewed Worker fix and activating the prepared server-side allowlist on October 21. Keep `OAUTH_ENABLED=true`, `LIVE_EMAIL_ENABLED=false`, `AI_PROVIDER=mock`, existing credential secrets and exact APP_ORIGIN unchanged. No migration, resource creation, quota reset, frontend deployment or credential change is needed. Do not put this variable in NEXT_PUBLIC_ settings or a user-editable profile. Only the designated account receives 15 when this configuration is active; verify its exact membership after deployment.

Validation: **88 tests passed**, both workspace TypeScript checks and production build passed. Nine new tests cover existing-count preservation, shared-provider 15 cap, ordinary students/forged identity fields, absent/empty/email/unmatched configuration, global 50 cap, removal/next UTC period, and concurrent attempts at the boundary. Release approval was subsequently given; production verification must confirm unchanged counters, protected credential bindings and exact single-account membership.

## Exact Vercel settings and proxy

Install from repository root with Node 24 LTS and `npm ci`. The frontend root is **`apps/web`**. Next.js keeps `output: "export"`, generates `apps/web/out`, and disables slash redirects so API paths remain unchanged. Worker code is `apps/api/src/index.ts`; migrations are `apps/api/migrations`.

| Vercel setting             | Value                                                                        |
| -------------------------- | ---------------------------------------------------------------------------- |
| Repository                 | Private `Malang43/MS-Professor-Agent`; grant only required GitHub App access |
| Plan                       | Hobby only if eligible; never upgrade or provide a card                      |
| Framework / Root           | Next.js / `apps/web`                                                         |
| Include outside-root files | Enabled for shared workspace/lockfile                                        |
| Node                       | 24.x                                                                         |
| Install override           | `cd ../.. && npm ci`                                                         |
| Build                      | `npm run build` from frontend root                                           |
| Output                     | Framework default, override off; export creates `out`                        |
| Production branch          | `main`                                                                       |
| Frontend API env           | None; remove obsolete `NEXT_PUBLIC_API_URL`                                  |
| Hostname                   | Exact stable `https://YOUR_PROJECT.vercel.app`                               |

Keep the platform-level rewrite in **`apps/web/vercel.json`**:

```text
/api/:path* -> https://ms-professor-outreach-api.YOUR_WORKERS_SUBDOMAIN.workers.dev/api/:path*
```

The deployed rewrite uses `https://ms-professor-outreach-api.aliraza57616.workers.dev/api/:path*`. For another account, replace the hostname with its verified endpoint, retaining `/api` on both sides. `vercel.json` does not substitute arbitrary Worker environment variables. The fixed upstream is never chosen from client input. Production browser fetches and download links always remain on the Vercel origin; a stale frontend env value cannot bypass the proxy. Development supports `NEXT_PUBLIC_API_URL=http://localhost:8787`. Plain static servers and `next dev` do not execute Vercel rewrites.

Do not add a Vercel Function/middleware proxy, `next start`, or global trailing-slash redirects. Preview/deployment aliases are not the canonical origin. Do not whitelist `*.vercel.app`, inject a trusted Origin, or connect untrusted previews to production data. Disable unwanted previews/access or separately isolate staging D1/KV/Worker and its exact origin. A private source repo does not make the hosted site private.

## Cookies, OAuth, CSRF and caching

The session cookie is host-only `HttpOnly; Secure; SameSite=Strict; Path=/`, seven-day lifetime. Vercel forwards Cookie/Set-Cookie unchanged from HTTPS workers.dev; the browser stores it on the **Vercel** host. Never add Domain or redirect browser API calls to workers.dev. Logout revokes the D1 session hash and expires the cookie with matching attributes. Local HTTP omits Secure.

Mutations require exact `APP_ORIGIN`; missing/null/foreign/Preview origins fail. Wrong Origin GETs fail too; ordinary owner-authenticated downloads may omit Origin. No state-changing GET or forwarded-host trust was introduced. Non-browser clients can spoof Origin, so session and tenant ownership checks remain mandatory.

OAuth's provider redirect cannot rely on the Strict session cookie. A separate **10-minute**, host-only HttpOnly/Secure/**Lax** cookie is narrowly scoped to `/api/oauth/PROVIDER/callback`. The OAuth fix names it `oauth_PROVIDER_STATEHASH`, using the full SHA-256 hash of the random state, so overlapping consent attempts do not overwrite each other. See [the OAuth investigation](docs/OAUTH-CALLBACK-FIX.md) for evidence and rollout requirements. One-use hashed state binds it to the student and initiating active/unrevoked session. PKCE verifiers and tokens are AES-GCM encrypted with user/provider/purpose AAD. Replays, missing binding and revoked/expired sessions fail before exchange. `Referrer-Policy: no-referrer` prevents callback URL referrer leaks. Do not log OAuth query codes, tokens or provider response bodies.

Every Worker response, including errors/preflight/files/redirects, has:

```http
Cache-Control: private, no-store, max-age=0
CDN-Cache-Control: no-store
Vercel-CDN-Cache-Control: no-store
```

Vercel's API path sets the same controls and `x-vercel-enable-rewrite-caching: 0`. Do not add public TTLs, cache-everything rules or API service-worker caches. Vercel can consume CDN-specific headers; inspect browser Cache-Control and actual edge behavior later. Static assets retain normal caching.

## KV storage and quotas

Default production needs only **`DB`** (D1) and **`DOCUMENTS_KV`** (KV). Do not create R2. The `local` environment emulates optional legacy R2 to retain old local document reads without remote R2 activation. Never deploy that local environment. Additive migration preserves old rows as backend R2; it does not copy their bytes. A remote legacy-data move needs a separate private export/re-upload plan, never Git.

D1 owns file metadata, checksums, expiry, lifecycle and access control. KV stores immutable opaque keys with **30-day TTL**. D1 conditional reservations precede writes, serializing concurrent quota checks. Failed/ambiguous uploads remain hidden with reservations retained for cleanup. Missing newly written KV data returns retryable 503 because cross-location visibility can take 60 seconds **or longer**. No strong read-after-write promise is made.

Deletion hides access in D1 immediately; stale KV replicas cannot bypass the owner/state check. Physical cleanup is deferred at least two minutes and retried on failure. Pending message/armed-follow-up references block deletion. User quota releases after successful cleanup; global deleted reservations count until expiry to conservatively account for physical retention. Cron reaps abandoned/expired objects in small batches. Use a dedicated namespace.

| Application guard        | Limit                                                    |
| ------------------------ | -------------------------------------------------------- |
| File                     | 2 MiB; PDF/DOCX/TXT with type/extension/signature checks |
| Student                  | 10 active/reserved files, 20 MiB                         |
| Global reserved bytes    | 100 MiB, including deleted KV rows until expiry          |
| Upload attempts          | 10/student/day, 100/application/day                      |
| Document reads / deletes | 10,000 reads/day; 100 physical deletes/day globally      |
| Live attachments         | At most 3 totaling 2 MiB                                 |

PDF active-content markers and unsafe DOCX containers are conservatively rejected; this is **not antivirus or comprehensive parsing**. Downloads use encoded safe filenames, attachment disposition and nosniff; no document becomes public or trusted HTML. JSON and multipart body streams are bounded even without Content-Length.

KV currently includes finite Free allowances (including 1 GB storage and limited daily operations), with 25 MiB maximum values. App budgets are smaller, but account workloads share provider quotas. Check current limits; exhausted quotas fail/back off, never silently upgrade.

## Deployment order for a fresh installation

1. Review code/commit and no-card plan eligibility. Check Git auto-deploy hooks **before pushing**.
2. Approve Wrangler sign-in; select intended account and Workers Free. Never use a temporary preview account to bypass authorization.
3. After resource approval, create one D1 database and one KV namespace. Fill default production IDs; keep local emulator IDs separate. Choose the free workers.dev endpoint and exact canonical Vercel hostname.
4. Apply all reviewed remote migrations, then deploy the **default** Worker with integration/live defaults off. Verify bindings, health and origin rejection.
5. Fill the fixed Vercel destination and settings, then deploy only the reviewed/approved revision. Perform browser/edge QA before personal data.
6. Optional registrations/secrets/consent do not authorize sending. A live test needs separate approval naming controlled addresses.

The commands below describe a fresh mock-default setup. For this existing installation, preserve current remote flags and protected bindings in a reviewed ignored release configuration; blindly deploying source defaults would overwrite the owner's enabled Groq flags.

Future commands from `apps/api` (PowerShell: `npx.cmd` if necessary):

```sh
npx wrangler login
npx wrangler whoami
npx wrangler d1 create outreach
npx wrangler kv namespace create DOCUMENTS_KV
```

Record actual account/database/namespace IDs. Keep `workers_dev: true`, `preview_urls: false`, `main: "src/index.ts"`, tested compatibility date `2026-10-01`, migrations directory `migrations`, and cron `* * * * *`. Set `APP_ORIGIN=https://YOUR_PROJECT.vercel.app` exactly, no slash/path. Leave `OAUTH_ENABLED=false`, `LIVE_EMAIL_ENABLED=false`, `AI_PROVIDER=mock`, `GROQ_FREE_PLAN_CONFIRMED=false`. No default R2 binding.

```sh
npx wrangler d1 migrations list outreach --remote
npx wrangler d1 migrations apply outreach --remote
npx wrangler d1 migrations list outreach --remote
npx wrangler deploy
```

Production uses the default environment, never `--env local`. Deploy does not apply schema migrations. Never import/reset a local database over production. Privately back up existing data first. `0002_storage_integrations.sql` is additive; `0001_initial.sql` is unchanged. Missing DB/KV or invalid origin fails closed with API 503.

```sh
curl -i https://ms-professor-outreach-api.YOUR_WORKERS_SUBDOMAIN.workers.dev/api/health
curl -i -X OPTIONS https://ms-professor-outreach-api.YOUR_WORKERS_SUBDOMAIN.workers.dev/api/auth/login -H "Origin: https://YOUR_PROJECT.vercel.app" -H "Access-Control-Request-Method: POST"
```

Use `curl.exe` in Windows PowerShell. Expect mock mode, KV storage, live_email false, exact-origin preflight and no-store. Foreign/missing Origin mutations must be 403. Health is not a DB/KV round-trip or migration check.

## Automation and free-runtime boundaries

Mock scheduling still runs each minute, up to 20 messages/tick, atomically recording simulated receipts. Live rows are excluded from the mock ledger. Heavier work rotates across three minute phases: reply checks + follow-up preparation; one live-test job; storage/metadata cleanup. Persisted state resumes on the next turn. Backlogs cause delays; this is not exact wall-clock delivery.

The live snapshot freezes recipient, content, selected account, attachments/checksums/names and logical message key. D1 claims/fences recheck approval, per-message auto consent, connection, controls and suppressions before the external side effect. Proven rejections allow at most three actual submissions with backoff/jitter. Limits are one/student/minute, ten/student/day and 100/application/day. Creation permits 50/student/day and 500/application/day, with active workspace caps of 400/student and 4000/application after migration 0018; initial drafts and planned follow-ups reserve slots, while terminal historical records are retained outside active capacity. Capacity failure does not auto-delete history or buy storage. See docs/MESSAGE-CAPACITY-RELEASE.md. Live tests also require exact `LIVE_TEST_RECIPIENTS` matching.

Timeout/network/5xx ambiguity or an interrupted submitting lease becomes **uncertain**, never blindly resent. Gmail reconciliation uses stable RFC Message-ID; Graph uses a custom outreach header in recent Sent Items. Graph 202 means accepted, not confirmed. Its bounded lookup examines the most recent 25 sent items; absent/ambiguous evidence stays uncertain and requires review. Cancellation cannot undo an already accepted provider request.

Reply checks cover tracked threads for 31 days, one thread and one new event per cron phase (manual user-scoped checks may inspect two threads). Graph pagination persists. Incomplete/oversized/failed reads cannot arm follow-ups. One optional exact-content follow-up can be explicitly authorized for 1-30 UTC elapsed days after confirmation, shown during review and bound to the same recipient/account/files. It requires a fresh complete reply check; known reply/decline/opt-out/bounce, disconnection, cancellation and manual outcomes stop it. Out-of-thread bounces and replies beyond the polling window need manual recording. This is not universal inbox/DSN classification. Manual reminders remain separate.

Workers Free currently has a 10 ms CPU budget. Native hashing, file checks and provider work need real platform measurement after approval. Local wall times do not certify CPU fitness. Never weaken password hashing or upgrade to hide failure. Watch Worker/D1/KV quotas; no paid queue/durable-object service is enabled.

## Single manual setup and production verification checklist

All required external inputs/approvals are here. Never paste secrets into chat, Git, frontend variables, screenshots or logs.

- [ ] **Review and authorize:** review local commit/diff; separately authorize push and no-card deployment. Check auto-deploy hooks and personal/noncommercial Hobby eligibility. Keep source private; never force-push.
- [ ] **Authenticate Cloudflare:** approve interactive Wrangler sign-in, identify intended account/Free plan, then approve only D1/KV creation, migrations and deployment. Stop if a card/trial/paid plan is required. Completed for this deployment; exact resources and account scope are recorded in docs/DEPLOYMENT-STATUS.md.
- [ ] **Fill production configuration:** supply/confirm canonical Vercel URL and Worker subdomain; replace D1/KV IDs and rewrite placeholder; configure exact APP_ORIGIN. Deploy backend before frontend, integrations/live flags initially off.
- [ ] **Browser/edge QA:** verify login/refresh/logout/revoked-token 401, Vercel-host-only HttpOnly/Secure/Strict cookie, unchanged Cookie/Set-Cookie and original Origin forwarding. All API/download links stay under `/api` without slash/host redirects. Test two accounts, foreign file 404, upload/download/delete byte integrity, retry/expiry behavior, no shared edge HIT/STALE, wrong/missing/null Origin rejection, imports and all mock approval/control/scheduling modes. Check actual upload limits and CPU/quotas. If edge behavior differs, investigate rather than relaxing guards.
- [ ] **Optional encryption secret:** generate/store 32 random bytes as base64 in a secure password manager. After remote-change approval use interactive `npx wrangler secret put TOKEN_ENCRYPTION_KEY` from `apps/api`. Never print or commit it. Ciphertext is version v1; key rotation/loss needs reviewed reconnect/re-encryption, not silent replacement.
- [ ] **Optional Google registration:** use a no-card Google Cloud project, enable Gmail API, register a **Web application** client/consent screen, and add controlled Testing users. Exact redirect: `https://YOUR_PROJECT.vercel.app/api/oauth/gmail/callback`. Set GMAIL_CLIENT_ID and GMAIL_CLIENT_SECRET as Worker secrets interactively. Send-only uses openid/email/gmail.send; reply access adds gmail.readonly. Follow Google's sensitive/restricted-scope policies. External Testing Gmail refresh tokens generally expire after seven days; reconnect is expected. Public use may require verification, domain/privacy-policy evidence and a security assessment. If requirements cost money or cannot be met, leave public Gmail disabled. Never bypass verification.
- [ ] **Optional Microsoft registration:** use an existing eligible no-card Entra registration supporting personal and work/school accounts (`AzureADandPersonalMicrosoftAccount`); do not create a card-based Azure trial/tenant. Configure **Web**, not SPA, redirect `https://YOUR_PROJECT.vercel.app/api/oauth/outlook/callback`. Delegated scopes: User.Read, Mail.Send, offline_access, optional Mail.Read for replies/reconciliation; no application-wide mailbox or Mail.ReadWrite permission. Set OUTLOOK_CLIENT_ID/OUTLOOK_CLIENT_SECRET as Worker secrets. Tenant/admin/registration restrictions can block this; skip instead of upgrading. Disconnect wipes local tokens; users remove Microsoft app consent to revoke provider authorization.
- [ ] **Optional account consent:** after valid registrations/secrets, enable OAUTH_ENABLED only, leaving LIVE_EMAIL_ENABLED=false. Deploy an approved backend revision, then consent in Settings. The UI explicitly requests reply access. Verify callback binding, refresh rotation, expiry/reconnect and disconnect using controlled accounts. Missing credentials/verification leave the provider disabled.
- [ ] **Optional Groq:** use only a Free account without payment details; confirm current free model/rate limits. Set GROQ_API_KEY and GROQ_MODEL as Worker secrets. Enable AI_PROVIDER=groq and GROQ_FREE_PLAN_CONFIRMED=true only after account confirmation/approval. No billing API is called. Confirm an official HTTPS source for the professor in the dashboard before Groq can be used; otherwise no model call occurs. Invalid key/rate/quota/model responses fall back to editable templates; manual mail stays usable. Budgets allow five requests/student/day, 50/application/day, with conservative token reservation and reported token tracking. Model output selects a predefined factual template; unrestricted generated prose is intentionally not accepted.
- [ ] **Specific live-email test approval:** name the addresses you own/control and authorize the exact test. Only then set LIVE_TEST_RECIPIENTS and LIVE_EMAIL_ENABLED=true. Select the intended account, approve exact content/files, and validate sent identifiers/threads, delayed replies, bounces/opt-outs/declines, uncertainty and follow-up suppression. Do not use real professors. Turn sending off after the test; unrestricted production outreach is not enabled.
- [ ] **Public readiness:** complete verified identities/recovery/MFA, malware scanning, monitoring/retention, privacy/consent requirements and provider verification before public users/personal data. Keep private backups outside Git. No live certification is implied by local tests.

## Local verification and rollback

Run `npm run typecheck`, `npm test`, `npm run build`, and `npm audit`. Tests apply all actual migrations and enforce D1 binding counts. Provider HTTP is mocked, not sent to live services. Real local Worker smoke checks use emulated D1/KV. `scripts/smoke.mjs` rejects non-local endpoints.

For isolated smoke state, from `apps/api`:

```sh
npx wrangler d1 migrations apply outreach --env local --local --persist-to .wrangler/readiness-release
npx wrangler dev --env local --local --port 8791 --persist-to .wrangler/readiness-release
```

Then from root, with `SMOKE_API_URL=http://localhost:8791/api` and `SMOKE_D1_PERSIST_PATH` set to the absolute `.wrangler/readiness-release` directory used above, run `node scripts/smoke.mjs`. State stays ignored and separate from the user's normal database. Optional local R2 is emulated only, with no subscription. The readiness run passed 59 automated tests, real local KV/D1 smoke checks (deletion/isolation/session revocation), and a local cron invocation. A production dependency audit reported zero known vulnerabilities. Final full check results are in `docs/READINESS.md`.

For updates, apply reviewed compatible migrations before code that needs them. Vercel/Worker rollback does not undo D1 data/schema. Restore backups through a reviewed plan. Do not roll back to old code that might treat a live outbox row as mock delivery.

## Official references

Checked 2026-10-21:

- [Workers no-card start](https://www.cloudflare.com/products/workers/), [Workers limits](https://developers.cloudflare.com/workers/platform/limits/), [D1 setup](https://developers.cloudflare.com/d1/get-started/)
- [KV limits](https://developers.cloudflare.com/kv/platform/limits/), [KV pricing](https://developers.cloudflare.com/kv/platform/pricing/), [KV consistency](https://developers.cloudflare.com/kv/concepts/how-kv-works/)
- [Vercel rewrites/cache opt-out](https://vercel.com/docs/routing/rewrites), [cache controls](https://vercel.com/docs/caching/cache-control-headers), [monorepos](https://vercel.com/docs/monorepos), [limits](https://vercel.com/docs/limits)
- [Google web-server OAuth](https://developers.google.com/identity/protocols/oauth2/web-server), [Testing refresh expiration](https://developers.google.com/identity/protocols/oauth2/), [restricted-scope verification](https://developers.google.com/identity/protocols/oauth2/production-readiness/restricted-scope-verification), [Gmail REST API](https://developers.google.com/workspace/gmail/api/reference/rest)
- [Microsoft authorization code/PKCE](https://learn.microsoft.com/en-us/entra/identity-platform/v2-oauth2-auth-code-flow), [Graph acceptance semantics](https://learn.microsoft.com/en-us/graph/api/user-sendmail?view=graph-rest-1.0)
- [Groq limits](https://console.groq.com/docs/rate-limits), [Groq Free versus Developer billing](https://console.groq.com/docs/billing-faqs)

Atomic professor imports use bounded JSON parameters in one INSERT plus audit, and batch approval uses set-based SQL. This preserves the 500-row import without exceeding the D1 Free per-invocation query budget. [D1 limits](https://developers.cloudflare.com/d1/platform/limits/)

Disabling LIVE_EMAIL_ENABLED stops new submissions/follow-ups, while configured OAuth can continue read-only reply checks and reconciliation of earlier uncertain outcomes. Set OAUTH_ENABLED=false to stop all mailbox-provider activity.
