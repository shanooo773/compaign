import { documentLearningLimits as limits } from "../../../shared/learning-config";
export type Guide = {
  title: string;
  page: string;
  steps: string[];
  tip: string;
};
export const guides: Guide[] = [
  {
    title: "What is MS Professor Agent?",
    page: "Overview",
    steps: [
      "Students can organise professor records, academic documents and personalised MS or PhD enquiries in one private workspace.",
      "Prepare a campaign, review every recipient, message, attachment and date, then explicitly approve. Importing alone never authorises sending.",
      "The application scheduler submits eligible approved messages through your connected Gmail account. Pacing, reply checks and provider limits can delay delivery.",
      "A research match means a professor may share your interests. It is not a verified scholarship, open position, admission offer or funding guarantee.",
    ],
    tip: "Check current opportunities on official university pages. Never claim funding is available without evidence.",
  },
  {
    title: "Account registration",
    page: "Settings",
    steps: [
      "Choose Create account on the sign-in page. Enter your name, email, password and confirmation, accept the policies, and complete Cloudflare Turnstile.",
      "Use a unique password of at least 15 characters. Follow the live password requirements; never reuse your Gmail password.",
      "Sign in with your email and password. New unverified accounts can use their private profile, professor records and documents, but mailbox actions need verified access.",
      "After registration and login, click Verify with Google & Connect Gmail. Choose the Google account with exactly your registered email. The server validates Google-signed identity evidence, ownership, and Gmail permissions before activating your account. Authorization attempts expire after 10 minutes and are single-use.",
      "Email-based Forgot password is unavailable without transactional delivery. Registered passkeys and saved recovery codes remain the supported alternatives. Configure them in Account security and store recovery codes privately. Google activation is not password recovery or Google login.",
    ],
    tip: "No transactional email provider is needed. Gmail and authoritative Google Workspace addresses are supported. A mismatched or unsupported third-party address remains unverified; register the correct address separately rather than merging accounts.",
  },
  {
    title: "Gmail connection",
    page: "Settings",
    steps: [
      "New unverified students use Verify with Google & Connect Gmail on Overview or in Settings. This verifies the matching Google identity and connects Gmail together. Existing verified users retain their normal Gmail connection controls. Never enter your Gmail password into this application.",
      "OAuth grants delegated access: identity/email identifies the connected account; gmail.send submits approved messages; gmail.readonly, when requested, reads tracked threads to detect replies. Review the actual Google consent screen.",
      "Return to Settings and confirm the displayed Gmail address and connection status before approving outreach. Reconnect when status requests renewed authorisation; Google testing-mode consent can expire.",
      "Disconnecting removes mailbox access and can prevent pending campaigns from sending or checking replies. Inspect and deliberately cancel pending outreach first if you intend to stop it; disconnection cannot retract an accepted email.",
      "Application quotas, per-account pacing and Google limits all apply. A scheduled time is an earliest eligible time, not a guaranteed delivery time. Read the limits/status shown for your account; no tutorial control increases them.",
    ],
    tip: "An unverified account restriction is different from a system-wide mail outage. A connected Gmail account does not itself enable sending.",
  },
  {
    title: "Academic profile",
    page: "Academic profile",
    steps: [
      "Open Academic profile and enter your name, university, degree, GPA where relevant, and a clear description of research interests.",
      "Choose your IANA timezone, such as Asia/Karachi. Save changes and check that the values remain visible.",
      "Describe actual projects and skills. Profile information helps prepare editable academic outreach; review every generated statement before approval.",
      "Return here to update your profile. Updating a profile does not rewrite already approved campaign snapshots.",
    ],
    tip: "A specific interest such as low-power embedded vision is more useful than a broad claim such as all of computer science.",
  },
  {
    title: "Documents and attachments",
    page: "Documents",
    steps: [
      `Open Documents and upload your CV, transcript or supporting file. The current storage configuration allows PDF, DOCX and UTF-8 TXT: ${limits.fileMiB} MiB per file, ${limits.studentMiB} MiB and at most ${limits.maxFiles} documents per student. Import spreadsheets have a separate 5 MiB frontend limit.`,
      "Files are private and ownership-checked. Unsafe or unsupported content is rejected. Do not upload sensitive documents you do not need to share.",
      `Ordinary document retention is ${limits.retentionDays} days. The interface shows expiry; approved campaign attachment pins can retain documents for their campaign. Do not assume an expired file remains usable.`,
      "During complete campaign review, select files in Email Attachments. The default selection attaches them to initial messages only. Configure each follow-up separately if it needs a file, and check recipient-specific selections.",
      "Gmail receives actual MIME attachments, not a public document link. A message can contain up to 3 attachments totalling 2 MiB. Review names and sizes before approval.",
      "Manage or delete files from Documents. Files referenced by outstanding messages or armed follow-ups can be protected from deletion. Re-upload an expired document and review a new plan rather than changing frozen approval content.",
    ],
    tip: "Practice Campaign uses a fictional CV label only. It never reads your uploaded documents.",
  },
  {
    title: "Finding and adding professors",
    page: "Professors",
    steps: [
      "Open Professors and choose Add professor. Enter the actual name, email, university and research interests, then save.",
      "Use official university faculty pages to check institutional addresses and research interests. The verification action records your confirmation and official source; it is not independent proof of an open scholarship.",
      "Edit and maintain records before preparing outreach. Active duplicate email addresses are skipped during import; check the result before retrying.",
      "Keep potential research matches separate in your judgement from explicitly advertised, current opportunities. Do not invent affiliations or publications.",
    ],
    tip: "Confirm both name and address. A syntactically valid address can still belong to the wrong person.",
  },
  {
    title: "Smart Import: text, tables and Excel / CSV",
    page: "Smart Import",
    steps: [
      "Open Smart Import and choose Paste Text, Paste Table or Excel / CSV Upload. Each method has a template beside it; expand the template panel on mobile.",
      "Copy Prompt for AI and paste it into your own ChatGPT, Gemini, Claude or DeepSeek account. Give verified professor sources, student details and explicit dates/timezone. No provider login, API key or AI tokens are used inside Professor Agent.",
      "Paste Text requires === PROFESSOR === blocks, exact field names and <<< / >>> body delimiters. It preserves multiline content and never guesses missing fields. Repeat the block for each professor.",
      "Paste Table accepts quoted CSV/TSV, semicolon-separated tables, Markdown tables or strict JSON arrays of flat row objects. Markdown does not support multiline cells; use quoted CSV or structured text for them.",
      "Edit the preview, resolve missing fields and duplicates, and use Local date/time to UTC with an explicit IANA timezone. Add to Campaign creates unapproved drafts only. Then select your CV and attachments, review the entire plan and explicitly approve once; track messages and replies in Outreach and Follow-ups.",
      "Download the official professor-only CSV or campaign CSV / XLSX template below. Keep headers exactly as supplied. Required professor headers are name and email; professor_name is not an alias in the active parser.",
      "Professor-only columns are name,email,university,interests. Campaign rows also need subject,body,scheduled_at; legacy spreadsheet timezone is optional and defaults to Asia/Karachi. Smart Import requires an explicit timezone. Use one professor per row.",
      "Campaigns support up to 25 rows; professor-only import supports up to 500. Use valid email addresses, nonempty personalised subjects and bodies, and no duplicate or blank headers.",
      "Use UTC ISO text for scheduled_at, for example 2026-11-20T04:00:00Z. Replace example dates with future dates within the campaign horizon. Preserve commas and line breaks by quoting CSV cells.",
      "For each follow-up N from 1 to 10 use follow_up_N_subject, follow_up_N_body, follow_up_N_delay_value, follow_up_N_delay_unit and follow_up_N_relative_to. Start at 1 with no gaps. Units are minutes, hours or days; anchors are original or previous.",
      "The parser also accepts follow_up_sequence JSON or the single-step timing fields shown in existing templates. Do not mix sequence representations or legacy followup_days with sequence timing.",
      "Import into review, inspect validation errors, fix the source file and retry. The downloadable practice example uses the actual shared campaign parser and reserved example addresses. It is for practice, not for approval in real outreach.",
    ],
    tip: "Subject allows up to 500 characters on one line; body up to 20,000. A file passing parsing still needs live account, schedule, attachment and approval validation.",
  },
  {
    title: "Timezones and scheduling",
    page: "Outreach",
    steps: [
      "Pakistan Standard Time is Asia/Karachi, UTC+05:00. Korea Standard Time is Asia/Seoul, UTC+09:00. Seoul is 4 hours ahead of Karachi.",
      "For example, 20 November 2026 at 09:00 Karachi equals 13:00 Seoul and scheduled_at 2026-11-20T04:00:00Z. Z means UTC.",
      "The scheduling form converts the entered local time using the selected timezone. The stored scheduled_at is UTC; inspect both local and UTC dates before approval.",
      "Excel date cells have no timezone. The importer interprets them using the explicit row timezone; ambiguous or invalid dates can fail. UTC ISO text in CSV avoids this ambiguity.",
      "Choose future dates and keep the full initial-plus-follow-up sequence within 60 days. Provider pacing, reply checks, queue backlog and quotas can postpone actual sending.",
    ],
    tip: "Never change a date to force an already approved campaign to run. Material timing changes require new review and approval.",
  },
  {
    title: "Preparing personalised emails",
    page: "Outreach",
    steps: [
      "Use a short factual subject, such as MS research enquiry - embedded systems. Address the professor by the verified name.",
      "Mention a research topic confirmed on an official source and connect it to a real project, course or skill. Ask politely about potential supervision or advertised opportunities.",
      "Enter manual content or use the configured factual template assistance, then edit it. When optional Groq assistance is configured, it selects audited templates; it is not evidence of funding or admission.",
      "Check spelling, recipient, academic claims, attachments and dates. Avoid generic mass messages and fabricated scholarship claims.",
    ],
    tip: "A concise, accurate enquiry is more respectful than unsupported praise or copied publication titles.",
  },
  {
    title: "Automatic follow-ups",
    page: "Follow-ups",
    steps: [
      "A campaign supports up to 10 configurable follow-ups and a complete horizon of 60 days. Every step needs its own subject, body, positive integer delay, unit and timing anchor.",
      "Units are minutes, hours and days. original counts from the initial email timing; previous adds to the previous step. Planned times must strictly increase and stay in the horizon. Runtime safety checks may postpone them.",
      "Example: step 1 is 7 days original; step 2 is 7 days previous, giving planned offsets of 7 and 14 days. Choose considerate intervals for real professors.",
      "Reply detection on tracked connected-mailbox threads cancels remaining eligible follow-ups. Recorded declines, opt-outs and bounces suppress further outreach as supported. Replies outside tracked threads may need manual outcome recording.",
      "Inspect Follow-ups for progress, cancellation reasons and delayed states. A missing or stale reply check can postpone sending. Short minute intervals belong in isolated tests, never real professor outreach.",
    ],
    tip: "An email already accepted by Gmail cannot be recalled by a later reply or cancellation.",
  },
  {
    title: "Complete campaign review and approval",
    page: "Outreach",
    steps: [
      "Import file → review professors → review initial emails → review follow-ups → select CV / attachments → review schedules → approve the complete displayed campaign once.",
      "Importing creates reviewable data; it does not authorise sending. Confirm the connected sender account and every recipient.",
      "Inspect all initial content, every follow-up and timing anchor, attachment selections for each recipient / step, and timezone conversions. Resolve errors before approval.",
      "One explicit approval authorises the displayed initial emails and approved follow-ups together. Approved content and timing are immutable snapshots.",
      "Material edits require a new review and approval. Do not approve example recipients or content accidentally. Cancel pending outreach deliberately when needed; cancellation cannot recall an email accepted by the provider.",
    ],
    tip: "Use Practice Campaign to learn approval first. Simulate Approval never calls a real approval endpoint.",
  },
  {
    title: "Scheduled and sent emails",
    page: "Outreach",
    steps: [
      "Open Outreach to inspect application campaigns and message statuses. Application-scheduled messages live in this app until submitted; they do not appear in Gmail Scheduled.",
      "Successfully sent Gmail messages appear in the connected account Sent folder. Verify that you are checking the same account shown in Settings.",
      "Pending means waiting for eligibility. Sent means successful provider confirmation; delayed or postponed work may be waiting on pacing, limits or reply checks. Inspect failure details and transport status before retrying.",
      "Failed, uncertain or cancelled states need careful inspection. Do not create a duplicate just because a provider response was ambiguous. The scheduler reconciles supported uncertain deliveries.",
    ],
    tip: "Exact delivery at the selected minute is not guaranteed. Do not manually trigger production jobs to check whether scheduling works.",
  },
  {
    title: "Replies and campaign tracking",
    page: "Follow-ups",
    steps: [
      "The scheduler polls supported tracked threads on the connected mailbox. Detected professor replies update tracking and stop remaining eligible follow-ups.",
      "Inspect Outreach, Follow-ups and the activity history for sent messages, pending steps, cancellation reasons and errors. Reply detection is periodic, not instantaneous.",
      "Record supported manual outcomes for replies, opt-outs or bounces outside tracked threads. Respect declines; do not start another campaign to bypass suppression.",
      "Use the existing cancel action for pending outreach and read its confirmation carefully. Pause, stop and disconnect have broader effects; never use them merely to explore the interface.",
    ],
    tip: "Practice includes a simulated reply button so you can observe cancellation without contacting anyone.",
  },
  {
    title: "Troubleshooting",
    page: "Getting Started",
    steps: [
      "Invalid professor header / missing fields: use name and email exactly, not professor_name. Campaigns also need subject, body and scheduled_at. Remove blank and duplicate headers.",
      "Invalid email / duplicate professor: correct whitespace and address syntax, confirm the institutional address, and check existing active records before importing again.",
      "Excel timezone error: use an explicit valid IANA timezone or convert scheduled_at to UTC ISO text ending in Z. Choose a future date and check the full 60-day horizon.",
      "Unsupported timing / invalid delay: use a positive integer, minutes/hours/days, and original/previous. Keep 1–10 steps consecutive and strictly increasing. Do not combine legacy days with sequence columns.",
      "Upload error / expired document: use supported PDF, DOCX or TXT, at most 2 MiB; check the 10-file and 20 MiB limits. Re-upload expired files. Documents required by pending campaigns may be protected from deletion.",
      "Gmail disconnected / failed send: inspect Settings and the exact error. Reconnect if authorisation expired. Do not blindly resubmit uncertain deliveries. Provider limits and safety checks may postpone follow-ups.",
      "Google activation unavailable: check that Google OAuth is configured and your account is allowed by Google?s consent-screen test-user or production settings. A mismatch needs the Google account with exactly your registered email. Unsupported third-party identities remain restricted; there is no automatic verification bypass.",
      "Nothing in Gmail Scheduled: expected; this app manages its own queue. Look here for pending messages and in the connected Gmail Sent folder after successful delivery.",
      "Missing attachment: confirm the file is available and selected for the correct initial or follow-up message and recipient during review. Selecting a CV for initials does not attach it to every follow-up.",
    ],
    tip: "Read the actual error before retrying. Repeated imports or approvals can create confusion; check existing records first.",
  },
];
