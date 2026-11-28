# Production source synchronization — November 28, 2026

Repository: https://github.com/Malang43/MS-Professor-Agent

The existing repository is public. Its default branch is `main`. At the start of this review, local `main` and freshly fetched `origin/main` both pointed to `f47bc20` (`Validate controlled recipient sequences without approving campaigns`); neither side had unique commits. Significant subsequent production work existed only as local changes and untracked source files.

## Source verification

- The production Vercel deployment is `dpl_EvHgkvSiatnHFdm4GkJxwddpddCA`, uploaded using the CLI. Its metadata does not identify a Git commit. All **52 uploaded source files** match the local files by SHA-1, including the frontend, shared modules and build inputs.
- The production Cloudflare Worker runs version `7e8b9474-1d6e-4d93-a25d-d5c939ecc355` at 100%. A fresh local dry-run build matches its JavaScript artifact **byte-for-byte**. The cron remains `* * * * *`.
- The synchronized source includes migrations 0011–0019, campaign lifecycle and revision workflows, Google/Gmail activation, attachment handling, UI redesign, active message capacity, and the latest D1 read-quota work. The existing conditional schedule-write optimization is preserved.
- The release previously described as 523 tests gained one regression afterward. The current suite contains **524 tests**. A full-day scheduler simulation exceeded the default five-second timeout on this machine; only that test's timeout was increased to 30 seconds. No application behavior changed during this synchronization.
- Validation passed: **524 tests across 29 files**, both workspace typechecks, the frontend production build, and the Worker dry-run build. Ignored recovery snapshots were moved outside the API workspace to prevent duplicate test discovery. The exact staged source tree also passed Gitleaks without leaks.

## Recovery and security

The local recovery branch `recovery/pre-github-sync-20261128` preserves the original Git tip. A separate ignored local snapshot preserves the original 296 source files before reconciliation. No reset, force-push or removal of local work is part of this procedure.

Gitleaks scanned all 39 existing commits without finding credentials. The working-source scan identified one synthetic password used only in a network-blocked, in-memory account-erasure test; it was reviewed and annotated narrowly. The public workbook and date-cell fixtures contain synthetic example addresses. UI screenshots originate from the existing isolated fixture harness, not production campaign captures.

Environment files, OAuth state, credentials, private diagnostics, encrypted backups, database files and student attachments remain excluded. An explicit `*.dpapi` exclusion protects encrypted backups even outside Wrangler state. Generated release-folder markers are ignored without deleting them. Public synthetic workbooks and intended application images remain included.

The repository's checked-in Wrangler configuration is a safe baseline, **not a complete copy of live production secrets or operational settings**. Do not deploy it blindly over production. Credentials and private release evidence must remain outside Git.

## Deployment-safe branch strategy

Vercel is connected to `Malang43/MS-Professor-Agent`, with `main` configured as its production branch and `apps/web` as its root directory. A push or merge to `main` must therefore be treated as a production deployment trigger. No Vercel setting was changed.

Use `sync/production-source-2026-11-28` for this source synchronization, leaving `main` unchanged. Vercel may create a preview deployment for this branch; it must not replace the production alias. Verify the production deployment ID and Worker version after pushing.

The existing GitHub Actions workflow runs installation, typechecks, tests and the frontend build on pushes and pull requests. It has no Worker deployment, database migration or email-sending step. Cloudflare release scripts are explicit operator commands; merely committing them does not execute them.

## Future workflow

1. Make local Codex changes on a feature branch; keep credentials and operational artifacts ignored.
2. Run `npm ci`, `npm run typecheck`, `npm test`, `npm run build`, and an appropriate Worker dry-run build. Run focused browser or migration-preservation checks when needed.
3. Review the exact staged diff and run a secret scan. Commit source, tests, migrations, safe templates and documentation together.
4. Push the feature branch to GitHub and inspect CI and any Vercel preview. Do not exercise live Gmail or production mutations from preview QA.
5. Review and approve the release before merging into `main`, because the merge can deploy Vercel automatically. Coordinate backend compatibility and reviewed migrations before frontend activation where necessary.
6. Deploy the Worker through an explicitly approved release using verified production bindings and secrets. Preserve the cron, approved campaigns and OAuth connections. Do not add automatic migrations to the existing CI without review.
7. Verify active deployment IDs, source/artifact hashes, health, protected records and scheduling behavior. Record release evidence without uploading private data.

The installed Next.js build reports an existing security advisory and succeeds using its normal retry mechanism. A separate security upgrade remains recommended; dependencies were not upgraded as part of this source sync.
