# PDF document upload validation fix

Released November 1, 2026 (Asia/Karachi).

## Findings

The reported generic error originates in `apps/api/src/storage.ts`, not the frontend. The Documents frontend filters selectable extensions, checks the 2 MiB limit and displays the Worker's error response.

The previous Worker required all PDF conditions to pass in one boolean expression:
- Exact `application/pdf` MIME.
- A `.pdf` extension after the filename had already been truncated to 80 characters.
- A `%PDF-` header and nearby EOF marker.
- No raw `/JavaScript`, `/JS`, `/Launch`, `/EmbeddedFile` or `/OpenAction` token anywhere in the bytes.

This incorrectly rejects legitimate PDFs with harmless opening-page destinations, missing/generic MIME metadata, or long filenames. It also scans raw content rather than parsing PDF objects and previously accepted a signature-only synthetic file without a valid PDF structure.

The original CV was not available in this session, so its exact failed condition cannot be conclusively identified. The code defects above are confirmed; the new errors identify the validation stage on any subsequent rejected upload.

## Changes

- Validate the original normalized extension before storage filename truncation.
- Accept PDF MIME values `application/pdf`, `application/x-pdf`, generic `application/octet-stream`, or an empty type, including normalized case and MIME parameters. Conflicting specific types remain rejected.
- Require a valid PDF version header, final EOF, cross-reference offset, parseable catalog and page tree.
- Parse PDF objects with `pdf-lib`, including compressed objects and escaped names.
- Permit opening-page destination arrays and local GoTo actions. Keep rejecting scripts, launch actions, embedded files and unsupported active content.
- Store validated PDFs with canonical `application/pdf` content type and preserve their original bytes.
- Return specific errors for size, empty files, unsupported extensions, conflicting PDF MIME, signature, EOF, cross-reference, parsing/encryption and active content.
- Replace the old fake PDF acceptance fixture with a structurally valid generated PDF.

The 2 MiB per-file limit, quotas, private downloads, owner checks, checksums, 30-day expiry, KV writes and deletion behavior are preserved. No schema migration or frontend change was required. Outreach, Gmail, follow-up, authentication and campaign implementation files were not changed.

## Verification

- Complete Vitest suite: **325 passed across 20 files**.
- Focused PDF/storage tests: **25 passed**, including 13 new PDF test cases.
- Worker TypeScript check: passed.
- Native Workers/D1/KV smoke test (`node scripts/document-runtime.cjs`): passed with all outbound requests blocked. Verified generic-MIME PDF upload with harmless OpenAction, canonical MIME, exact downloaded bytes, private headers, malformed/scripted PDF rejection and no storage rows for rejected uploads.
- Tests cover classic cross-reference tables, compressed cross-reference/object streams, local GoTo, long filenames, MIME variations, unsupported extensions, invalid signatures/catalogs/EOF, trailing payload, escaped/compressed active content and exact/over-limit 2 MiB uploads.
- Fixtures are synthetic valid PDFs, including Microsoft Word producer metadata; no actual Word-exported user CV was used.
- Production dependency audit: zero known vulnerabilities.
- Git whitespace check: passed.

## Deployment

Worker: `ms-professor-outreach-api`
Version: `ff1a8cf4-bf8c-442b-960d-a3ffc189cf83`
Deployment: `82c5e55f-9f9b-417e-adc7-e722f81a967e` (100%)
Artifact SHA-256: `6ff6275c0ad9326a5e522589dd824bef4b83834cfddc031477cbf7e03be4e994`

Verified the deployed module exactly matches both the release build and dry-run build. All 26 production bindings (including live variables and secret binding metadata) and cron schedules match the captured pre-release settings.

Direct Worker and canonical Vercel proxy health, no-store headers, unauthenticated document upload rejection and cross-origin rejection passed. No production CV was uploaded for verification and no email was sent by release checks.

Vercel redeployment was unnecessary: the existing frontend already displays the Worker's precise error and uses the same Worker proxy.
