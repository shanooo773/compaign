# Professor Agent UI audit and preservation plan

Completed before frontend implementation, November 6, 2026.

The application is a Next.js static-export single-page workspace. `/` is the only product route; view state selects the destinations below. `/api/*` remains the existing Vercel rewrite. Verification/reset fragments, policy fragments and provider callbacks remain unchanged. Existing tutorial destination keys will be retained internally even when displayed names change.

| Existing destination | Existing components/workflow | Planned destination |
|---|---|---|
| Overview | Twelve metric cards, activation, Welcome, notifications, message table | Dashboard: four defined metrics, campaign table, next activity, recent replies |
| Outreach | CampaignDirectory plus draft/message review | Campaigns, with Overview/Professors/Schedule/Replies/Activity detail tabs |
| Smart Import | SmartImport and ImportWizard | Create Campaign: name, add professors, review, documents, approval |
| Professors | Search, filters, import, add/edit, verify, compose | Professors; preserve all row actions and existing modals |
| Documents | Upload, preview, downloads, delete, expiry | Documents with a quieter upload affordance and existing file controls |
| Follow-ups | SequenceSteps, SchedulerStatus, campaign controls | Settings > Sending & follow-ups; campaign detail schedule links here |
| Academic profile | Existing editable profile form | Settings > Academic profile |
| Settings | AccountSettings, SecuritySettings, connections, notifications, usage, suppressions | Settings with local section navigation; notifications move to a dedicated inbox |
| Getting Started | LearningCenter and ProductTour | Secondary navigation: Getting started |
| Practice Campaign | PracticeCampaign using fictional records | Secondary navigation: Practice campaign |
| Audit history | Existing owned audit events | Settings > Activity history |
| Privacy/Terms/auth | AuthPanel, GoogleActivationAction, Turnstile, PolicyNotice | Preserved; shared tokens improve visual consistency |

Problems: competing gradient/card treatments, multiple CSS token layers, oversized repeated setup information, tiny uppercase labels, 11 equally weighted navigation choices, twelve dashboard counters, repeated notifications in dashboard/settings/follow-up areas, persistent rename/destructive controls, flat campaign cards with long prose, and a separate message table obscuring campaign detail structure. Import and approval safeguards are valuable and will be reorganized, not removed.

Tokens: background #F8FAFC; surface #FFFFFF; navy #172554; primary #2563EB; muted #64748B; border #E2E8F0; success #15803D; warning #D97706; destructive #DC2626. Dark theme uses matching semantic surface/text/status tokens. Headings 28/19px, body 14-16px, metadata at least 12px; 8-12px radii; no decorative page-entry animation or dashboard gradients.

Research: folk (https://www.folk.app/) for compact contact records; Streak (https://www.streak.com/features) for email-related pipeline organization; Linear (https://linear.app/now/behind-the-latest-design-refresh) for consistent location/action hierarchy; shadcn (https://ui.shadcn.com/blocks?category=dashboard) for sidebar and table composition. Screenrove could not be retrieved. No assets, branding, paid library or proprietary layout will be copied.

Preservation checklist:
- Keep every backend source file and migration byte-identical; record SHA-256 hashes before and after.
- Preserve every-minute cron, D1 optimization, API polling cadence and all existing API payloads.
- Preserve OAuth, Turnstile, sessions, verification, account erasure and explicit destructive confirmations.
- Preserve approved content/timing, 50-email rolling allowance, pacing, reply cancellation and folder warnings.
- Preserve duplicate rechecks, Change Recipients, explicit Approve Anyway and retained audit policy.
- Preserve Excel/CSV/text/table parsing, timezone requirements, attachments, individual/complete approval modes and practice/tutorial paths.
- Derive dashboard counts from actual messages, confirmed receipts and uncancelled follow-up obligations; label conditional dates honestly.
- Use existing localStorage only for presentation preferences/checklist dismissal; add no timers or repeated writes.
- Test all production-asset interactions with an in-memory API; never mutate or send through a production campaign.
- Capture before/after views, six responsive widths, keyboard dialogs/drawer, contrast and reduced motion before frontend-only publication.
