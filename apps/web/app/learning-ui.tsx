"use client";
import { useEffect, useRef, useState } from "react";
import Papa from "papaparse";
import { SmartImport } from "./smart-import";
import {
  BookOpen,
  CheckCircle2,
  Circle,
  CircleHelp,
  FlaskConical,
  ArrowRight,
  ShieldCheck,
  Play,
} from "lucide-react";
import type { Identity, Api } from "./account-ui";
import { GoogleActivationAction } from "./google-activation-ui";
import { guides } from "./learning-content";
import {
  practiceRows,
  practiceCSV,
  validatePracticeRows,
  approvePractice,
  advancePractice,
  replyPractice,
  type PracticeJob,
} from "../../../shared/practice-campaign";
import {
  delayMilliseconds,
  validateSequence,
  type FollowupStep,
} from "../../../shared/followup-sequence";

function readProgress(key: string): string[] {
  try {
    const value = JSON.parse(localStorage.getItem(key) || "[]");
    return Array.isArray(value)
      ? value.filter((x) => typeof x === "string")
      : [];
  } catch {
    return [];
  }
}
function save(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {}
}
export function downloadPractice() {
  const url = URL.createObjectURL(
    new Blob([practiceCSV()], { type: "text/csv;charset=utf-8" }),
  );
  const a = document.createElement("a");
  a.href = url;
  a.download = "practice-campaign.csv";
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
export function Help({ text }: { text: string }) {
  return (
    <details className="context-help">
      <summary aria-label="Show contextual help">
        <CircleHelp size={17} /> Help
      </summary>
      <p>{text}</p>
    </details>
  );
}
export function ActivationPanel({
  account,
  ready,
  limited,
  live,
  production,
  gmailConnected,
  api,
  refresh,
}: {
  account: Identity;
  ready: boolean;
  limited: boolean;
  live: boolean;
  production: boolean;
  gmailConnected: boolean;
  api: Api;
  refresh: () => Promise<void>;
}) {
  const [busy, setBusy] = useState(false),
    [message, setMessage] = useState("");
  return (
    <section
      className="learn-activation"
      data-tour="activation"
      aria-labelledby="activation-title"
    >
      <ShieldCheck size={27} />
      <div>
        <span className="eyebrow">ACCOUNT ACTIVATION</span>
        <h2 id="activation-title">
          {account.email_verified_at
            ? "Your email is verified"
            : account.legacy_access
              ? "Existing account access retained"
              : "Verify your email to unlock mailbox actions"}
        </h2>
        <p>
          {limited
            ? "Your account is restricted until email ownership is verified. You can still build your profile, save professors, upload documents and practise safely."
            : live
              ? production
                ? "Real Gmail outreach is enabled for this account, subject to connection, review and safety checks."
                : "This account has controlled live testing access. It does not indicate unrestricted outreach."
              : "Real sending is disabled for this workspace by its current access or environment controls. Drafts are not sent. This status alone does not diagnose a system-wide outage."}
        </p>
        {!account.email_verified_at && (
          <GoogleActivationAction api={api} ready={ready} refresh={refresh} />
        )}
        <ol
          className="activation-states"
          aria-label="Account activation progress"
        >
          <li>Account created</li>
          <li>
            {account.email_verified_at
              ? "Account verified"
              : "Email verification required"}
          </li>
          <li>
            {gmailConnected ? "Gmail connected" : "Gmail connection required"}
          </li>
          <li>
            {account.email_verified_at && gmailConnected && live && production
              ? "Outreach ready ? review and explicit approval required"
              : "Outreach awaits account verification, Gmail connection and server readiness"}
          </li>
        </ol>
        <p role="status">{message}</p>
      </div>
    </section>
  );
}
export function Welcome({
  account,
  profile,
  documents,
  gmail,
  limited,
  navigate,
}: {
  account: Identity;
  profile: boolean;
  documents: boolean;
  gmail: boolean;
  limited: boolean;
  navigate: (view: string) => void;
}) {
  const tasks = [
    {
      title: "Verify your email",
      done: !!account.email_verified_at,
      page: "Settings",
      detail: "Confirm ownership before mailbox actions.",
    },
    {
      title: "Tell your academic story",
      done: profile,
      page: "Academic profile",
      detail: "Add your degree, university and research interests.",
    },
    {
      title: "Prepare your documents",
      done: documents,
      page: "Documents",
      detail: "Upload a CV you have reviewed.",
    },
    {
      title: "Connect your Gmail",
      done: gmail,
      page: limited ? "Getting Started" : "Settings",
      detail: limited
        ? "Available after verification; learn how first."
        : "Check the sender address and permissions.",
    },
  ];
  const complete = tasks.filter((x) => x.done).length;
  return (
    <section className="learn-welcome" data-tour="welcome">
      <div className="learn-hero">
        <span className="eyebrow">FROM FIRST STEP TO THOUGHTFUL OUTREACH</span>
        <h2>
          Your research journey,
          <br />
          one clear step at a time.
        </h2>
        <p>
          Learn the workflow, practise with fictional professors, then prepare
          your own campaign with confidence.
        </p>
        <div className="actions">
          <button
            className="primary"
            onClick={() => navigate("Getting Started")}
          >
            <BookOpen size={17} /> Getting Started <ArrowRight size={16} />
          </button>
          <button
            className="secondary"
            onClick={() => navigate("Practice Campaign")}
          >
            <FlaskConical size={17} /> Try a practice campaign
          </button>
        </div>
      </div>
      <div className="learn-checklist">
        <div className="panel-heading">
          <h3>Your setup checklist</h3>
          <strong>
            {complete} / {tasks.length}
          </strong>
        </div>
        <progress
          aria-label="Account setup progress"
          max={tasks.length}
          value={complete}
        />
        {tasks.map((task) => (
          <button key={task.title} onClick={() => navigate(task.page)}>
            {task.done ? (
              <CheckCircle2 size={21} className="task-done" />
            ) : (
              <Circle size={21} />
            )}
            <span>
              <strong>{task.title}</strong>
              <small>{task.done ? "Completed" : task.detail}</small>
            </span>
            <ArrowRight size={15} />
          </button>
        ))}
      </div>
    </section>
  );
}
export function LearningCenter({
  userKey,
  navigate,
  startTour,
}: {
  userKey: string;
  navigate: (view: string) => void;
  startTour: (page?: string) => void;
}) {
  const key = "ms-learning-v1:" + userKey;
  const [done, setDone] = useState<string[]>([]),
    [current, setCurrent] = useState(0),
    [search, setSearch] = useState("");
  useEffect(() => {
    setDone(readProgress(key));
  }, [key]);
  const guide = guides[current];
  return (
    <div className="learning-center" data-tour="learning">
      <section className="panel learning-intro">
        <span className="eyebrow">YOUR PERMANENT FIELD GUIDE</span>
        <h2>Getting Started</h2>
        <p>
          Fourteen short lessons. No prior experience needed. Reading progress
          stays in this browser, separately from campaigns.
        </p>
        <progress aria-label="Lessons completed" max={14} value={done.length} />
        <span>{done.length} of 14 lessons completed</span>
        <div className="actions">
          <button className="primary" onClick={() => startTour()}>
            Start / replay welcome tour
          </button>
          <button
            className="secondary"
            onClick={() => navigate("Practice Campaign")}
          >
            Open isolated practice
          </button>
        </div>
      </section>
      <div className="guide-layout">
        <nav className="guide-menu" aria-label="Guide modules">
          <label>
            Find a lesson
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search topics"
            />
          </label>
          {guides.map(
            (item, i) =>
              (!search ||
                (item.title + item.steps.join(" "))
                  .toLowerCase()
                  .includes(search.toLowerCase())) && (
                <button
                  key={item.title}
                  aria-current={i === current ? "step" : undefined}
                  onClick={() => setCurrent(i)}
                >
                  <span>
                    {done.includes(String(i))
                      ? "✓"
                      : String(i + 1).padStart(2, "0")}
                  </span>
                  {item.title}
                </button>
              ),
          )}
        </nav>
        <article className="panel guide-article">
          <span className="eyebrow">LESSON {current + 1} OF 14</span>
          <h2>{guide.title}</h2>
          <ol>
            {guide.steps.map((step) => (
              <li key={step}>{step}</li>
            ))}
          </ol>
          <aside className="learn-tip">
            <CircleHelp size={20} />
            <p>{guide.tip}</p>
          </aside>
          {current === 6 && (
            <div className="template-downloads">
              <a className="secondary" href="/professors-template.csv" download>
                Professor CSV
              </a>
              <a
                className="secondary"
                href="/professors-email-template.csv"
                download
              >
                Campaign CSV
              </a>
              <a
                className="secondary"
                href="/professors-email-template.xlsx"
                download
              >
                Campaign Excel
              </a>
              <button className="secondary" onClick={downloadPractice}>
                Fresh practice example CSV
              </button>
            </div>
          )}
          <div className="actions">
            <button
              className="secondary"
              disabled={!current}
              onClick={() => setCurrent(current - 1)}
            >
              Back
            </button>
            <button
              className="primary"
              onClick={() => {
                const next = [...new Set([...done, String(current)])];
                setDone(next);
                save(key, next);
                if (current < 13) setCurrent(current + 1);
              }}
            >
              {done.includes(String(current))
                ? "Next lesson"
                : "Mark read & continue"}
            </button>
            <button className="secondary" onClick={() => navigate(guide.page)}>
              Open {guide.page}
            </button>
            <button className="secondary" onClick={() => startTour(guide.page)}>
              Page tutorial
            </button>
          </div>
        </article>
      </div>
      <Demonstrations />
    </div>
  );
}
const demoA = [
  [
    "Create your account",
    "Use your own email, a unique 15-character password, accept policies and complete Turnstile.",
    "Create account → Turnstile → Sign in",
  ],
  [
    "Verify ownership",
    "Log in and choose Verify with Google & Connect Gmail. Google must confirm a matching verified Gmail or Google Workspace identity. No transactional email provider is needed.",
    "Email link → Confirm → Verified",
  ],
  [
    "Explore your dashboard",
    "Follow the activation panel and checklist. An unverified student can still learn and practise.",
    "Welcome → Getting Started → Practice",
  ],
  [
    "Prepare your profile",
    "Save your university, degree and research interests. Configure a passkey and save recovery codes in account security.",
    "Academic profile → Save → Account security",
  ],
  [
    "Connect Gmail safely",
    "After verified access, open Settings and continue on Google’s consent page. Never enter a Gmail password here.",
    "Settings → Google consent → Return",
  ],
  [
    "Confirm your sender",
    "Check the connected address and status. Account access and system controls still apply; connection alone never authorises a campaign.",
    "Connected address → Review permissions → Ready to prepare",
  ],
];
const demoB = [
  [
    "Build an accurate profile",
    "Describe actual academic interests and projects. The app does not guarantee funding.",
    "Degree → University → Research interests",
  ],
  [
    "Upload a CV",
    "Documents accepts PDF, DOCX and TXT within current limits. Files are private and expire unless retained for a campaign.",
    "CV → Validate → Private storage",
  ],
  [
    "Import professors",
    "Use name and email headers. Campaign rows also need subject, body and a future UTC scheduled_at.",
    "Template → Validate file → Review professors",
  ],
  [
    "Review personalised content",
    "Inspect each name, email, subject and body. Verify research claims from official sources.",
    "Professor → Subject → Personalised body",
  ],
  [
    "Plan dates and follow-ups",
    "Check local and UTC time. Use up to 10 increasing follow-ups within 60 days; choose original or previous timing.",
    "Initial date → +7 days → +7 days previous",
  ],
  [
    "Select attachments",
    "Choose the CV for initial emails and separately for each follow-up. Confirm recipient-specific choices.",
    "Initial: Fictional CV.pdf → Follow-up: none",
  ],
  [
    "Approve once",
    "Review the complete campaign and sender before one approval. Import is not approval. Approved content and timing freeze.",
    "Recipients → Content → Attachments → Dates → Approval",
  ],
  [
    "Track and respect replies",
    "Messages remain in this app until sent through Gmail. Detected tracked replies stop eligible remaining follow-ups.",
    "Scheduled → Sent → Reply → Remaining steps cancelled",
  ],
];
export function Demonstrations() {
  const [which, setWhich] = useState(0),
    [step, setStep] = useState(0),
    [playing, setPlaying] = useState(false);
  const scenes = which ? demoB : demoA;
  useEffect(() => {
    if (!playing) return;
    const timer = setTimeout(() => {
      if (step < scenes.length - 1) setStep(step + 1);
      else setPlaying(false);
    }, 6500);
    return () => clearTimeout(timer);
  }, [playing, step, scenes.length]);
  return (
    <section
      className="panel demo-player"
      aria-label="Animated learning demonstrations"
    >
      <span className="eyebrow">WATCH THE WORKFLOW • SAFE ILLUSTRATIONS</span>
      <h2>Two guided demonstrations</h2>
      <p>
        Animated interface fixtures, generated in the app. No registration,
        upload, Gmail connection or sending occurs here.
      </p>
      <div className="tabs">
        {["A · Registration & Gmail", "B · Complete outreach"].map(
          (title, i) => (
            <button
              key={title}
              className={which === i ? "active" : ""}
              onClick={() => {
                setWhich(i);
                setStep(0);
                setPlaying(false);
              }}
            >
              {title}
            </button>
          ),
        )}
      </div>
      <div className="demo-scene" key={`${which}-${step}`}>
        <span className="badge">
          ILLUSTRATION · {step + 1} / {scenes.length}
        </span>
        <h3>{scenes[step][0]}</h3>
        <div className="demo-flow" aria-hidden="true">
          {scenes[step][2].split(" → ").map((text, i) => (
            <div key={i}>
              <span>{i + 1}</span>
              {text}
            </div>
          ))}
        </div>
        <p>{scenes[step][1]}</p>
      </div>
      <progress
        max={scenes.length}
        value={step + 1}
        aria-label="Demonstration progress"
      />
      <div className="actions">
        <button
          className="secondary"
          disabled={!step}
          onClick={() => {
            setPlaying(false);
            setStep(step - 1);
          }}
        >
          Back
        </button>
        <button
          className="primary"
          onClick={() => {
            if (step === scenes.length - 1) setStep(0);
            setPlaying(!playing);
          }}
        >
          <Play size={16} />
          {playing ? "Pause" : "Play / replay"}
        </button>
        <button
          className="secondary"
          disabled={step === scenes.length - 1}
          onClick={() => {
            setPlaying(false);
            setStep(step + 1);
          }}
        >
          Next step
        </button>
        <button
          className="secondary"
          onClick={() => {
            setStep(0);
            setPlaying(false);
          }}
        >
          Restart
        </button>
      </div>
    </section>
  );
}

export function PracticeCampaign() {
  const [rows, setRows] = useState<ReturnType<typeof validatePracticeRows>>([]),
    [stage, setStage] = useState(0),
    [error, setError] = useState("");
  const [at, setAt] = useState(""),
    [cv, setCV] = useState(true),
    [followCV, setFollowCV] = useState(false);
  const [steps, setSteps] = useState<FollowupStep[]>([
    {
      subject: "Following up on my research enquiry",
      body: "Dear Professor, I am following up politely. Thank you, Example Student.",
      delay_value: 7,
      delay_unit: "days",
      relative_to: "original",
    },
  ]);
  const [jobs, setJobs] = useState<PracticeJob[]>([]),
    [clock, setClock] = useState(0),
    [replies, setReplies] = useState<string[]>([]),
    [playing, setPlaying] = useState(false);
  useEffect(() => {
    setAt(new Date(Date.now() + 86400000).toISOString().slice(0, 16));
  }, []);
  useEffect(() => {
    if (!playing) return;
    const timer = setTimeout(() => {
      const next = jobs
        .filter((j) => j.status === "scheduled")
        .sort((a, b) => a.at - b.at)[0];
      if (next) {
        setClock(next.at);
        setJobs(advancePractice(jobs, next.at));
      }
      setPlaying(false);
    }, 1200);
    return () => clearTimeout(timer);
  }, [playing, jobs]);
  const attempt = (fn: () => void) => {
    setError("");
    try {
      fn();
    } catch (e) {
      setError((e as Error).message);
    }
  };
  const preview = () =>
    approvePractice(rows, Date.parse(at + "Z"), steps, cv, followCV);
  return (
    <div className="practice" data-tour="practice">
      <div className="practice-banner" role="note">
        <FlaskConical size={24} />
        <strong>PRACTICE MODE — NO REAL EMAILS WILL BE SENT</strong>
        <p>
          Browser-only fictional fixtures. No Gmail, live queue or private
          documents are used. Leaving this page resets the simulation.
        </p>
      </div>
      <ol className="practice-stages">
        {[
          "Import",
          "Review professors & emails",
          "Dates, follow-ups & CV",
          "Complete review",
          "Simulated tracking",
        ].map((label, i) => (
          <li key={label} aria-current={stage === i ? "step" : undefined}>
            {i + 1}. {label}
          </li>
        ))}
      </ol>
      {error && (
        <p className="feedback error" role="alert">
          {error}
        </p>
      )}
      {stage === 0 && (
        <SmartImport
          practice
          userKey="fictional-practice"
          limited={false}
          onDraft={(input) =>
            attempt(() => {
              const parsed = validatePracticeRows(input);
              setRows(parsed);
              setAt(parsed[0].scheduled_at.slice(0, 16));
              const f = parsed[0].followup_proposal;
              setSteps(
                f?.steps ||
                  (f
                    ? [
                        {
                          subject: f.subject,
                          body: f.body,
                          delay_value: f.days,
                          delay_unit: "days",
                          relative_to: "original",
                        },
                      ]
                    : []),
              );
              setStage(1);
            })
          }
        />
      )}
      {stage === 0 && (
        <section className="panel">
          <h2>Meet your fictional research shortlist</h2>
          <p>
            Amina Noor studies computer vision; Daniel Reed studies embedded
            systems at Example Research University. Their reserved example.com
            addresses cannot receive outreach through this simulator.
          </p>
          <div className="actions">
            <button className="secondary" onClick={downloadPractice}>
              Download sample CSV
            </button>
            <button
              className="primary"
              onClick={() =>
                attempt(() => {
                  setRows(validatePracticeRows(practiceRows()));
                  setStage(1);
                })
              }
            >
              Simulate sample import
            </button>
          </div>
          <label>
            Or import the sample CSV here
            <input
              type="file"
              accept=".csv,text/csv"
              onChange={async (e) => {
                const file = e.target.files?.[0];
                if (!file) return;
                if (file.size > 1024 * 1024) {
                  setError("Practice CSV limit is 1 MiB.");
                  return;
                }
                const text = await file.text();
                attempt(() => {
                  const parsed = Papa.parse<Record<string, string>>(text, {
                    header: true,
                    skipEmptyLines: true,
                  });
                  if (parsed.errors.length)
                    throw new Error(parsed.errors[0].message);
                  setRows(validatePracticeRows(parsed.data));
                  setStage(1);
                });
              }}
            />
          </label>
          <p>
            Use only fictional sample data. Import validation runs locally using
            the same shared campaign parser as the real workflow.
          </p>
        </section>
      )}
      {stage === 1 && (
        <section className="learn-grid">
          {rows.map((row) => (
            <article className="panel" key={row.email}>
              <span className="badge">FICTIONAL PROFESSOR</span>
              <h2>{row.name}</h2>
              <p>
                {row.email}
                <br />
                {row.university}
                <br />
                {row.interests}
              </p>
              <h3>{row.subject}</h3>
              <p>{row.body}</p>
            </article>
          ))}
        </section>
      )}
      {stage === 2 && (
        <section className="panel practice-config">
          <h2>Plan your fictional campaign</h2>
          <p>
            This simulator applies the displayed date and follow-up sequence to
            every fictional recipient. Smart Import starts these controls from
            the first row. Review and edit these shared practice settings before
            Simulate Approval; real campaign drafts retain each professor?s
            individual settings.
          </p>
          <label>
            Initial sending time in UTC
            <input
              type="datetime-local"
              value={at}
              onChange={(e) => setAt(e.target.value)}
            />
          </label>
          <p>
            {at && Number.isFinite(Date.parse(at + "Z"))
              ? `Karachi: ${new Date(at + "Z").toLocaleString("en-GB", { timeZone: "Asia/Karachi" })} · Seoul: ${new Date(at + "Z").toLocaleString("en-GB", { timeZone: "Asia/Seoul" })}`
              : "Choose a valid future UTC time."}
          </p>
          <Help text="UTC has no offset. Karachi is UTC+05:00 and Seoul is UTC+09:00. These practice dates never enter a real sending queue." />
          {steps.map((step, i) => (
            <fieldset key={i}>
              <legend>Follow-up {i + 1}</legend>
              <label>
                Subject
                <input
                  value={step.subject}
                  onChange={(e) =>
                    setSteps(
                      steps.map((s, n) =>
                        n === i ? { ...s, subject: e.target.value } : s,
                      ),
                    )
                  }
                />
              </label>
              <label>
                Body
                <textarea
                  value={step.body}
                  onChange={(e) =>
                    setSteps(
                      steps.map((s, n) =>
                        n === i ? { ...s, body: e.target.value } : s,
                      ),
                    )
                  }
                />
              </label>
              <div className="form-grid">
                <label>
                  Delay
                  <input
                    type="number"
                    min="1"
                    value={step.delay_value}
                    onChange={(e) =>
                      setSteps(
                        steps.map((s, n) =>
                          n === i
                            ? { ...s, delay_value: Number(e.target.value) }
                            : s,
                        ),
                      )
                    }
                  />
                </label>
                <label>
                  Unit
                  <select
                    value={step.delay_unit}
                    onChange={(e) =>
                      setSteps(
                        steps.map((s, n) =>
                          n === i
                            ? {
                                ...s,
                                delay_unit: e.target
                                  .value as FollowupStep["delay_unit"],
                              }
                            : s,
                        ),
                      )
                    }
                  >
                    {["minutes", "hours", "days"].map((x) => (
                      <option key={x}>{x}</option>
                    ))}
                  </select>
                </label>
                <label>
                  Count from
                  <select
                    value={step.relative_to}
                    onChange={(e) =>
                      setSteps(
                        steps.map((s, n) =>
                          n === i
                            ? {
                                ...s,
                                relative_to: e.target
                                  .value as FollowupStep["relative_to"],
                              }
                            : s,
                        ),
                      )
                    }
                  >
                    <option value="original">Original email</option>
                    <option value="previous">Previous step</option>
                  </select>
                </label>
              </div>
              <button
                className="secondary"
                onClick={() => setSteps(steps.filter((_, n) => n !== i))}
              >
                Remove step
              </button>
            </fieldset>
          ))}
          <button
            className="secondary"
            disabled={steps.length >= 10}
            onClick={() =>
              setSteps([
                ...steps,
                {
                  subject: "Following up",
                  body: "Thank you for considering my fictional enquiry.",
                  delay_value: 7,
                  delay_unit: "days",
                  relative_to: "previous",
                },
              ])
            }
          >
            Add follow-up ({steps.length}/10)
          </button>
          <Help text="The actual shared validator checks increasing offsets within 60 days. Minute delays are for simulation only; use respectful intervals for real professors." />
          <label className="practice-check">
            <input
              type="checkbox"
              checked={cv}
              onChange={(e) => setCV(e.target.checked)}
            />{" "}
            Attach Fictional CV.pdf to initial emails
          </label>
          <label className="practice-check">
            <input
              type="checkbox"
              checked={followCV}
              onChange={(e) => setFollowCV(e.target.checked)}
            />{" "}
            Attach Fictional CV.pdf to follow-ups
          </label>
          <p>
            Fictional attachment label only. No document bytes are read or
            uploaded. Real review supports individual follow-up and recipient
            choices.
          </p>
        </section>
      )}
      {(stage === 3 || stage === 4) && (
        <section className="panel">
          <h2>
            {stage === 3
              ? "Review the entire fictional campaign"
              : "Simulated campaign tracking"}
          </h2>
          <p>
            {stage === 3
              ? "Check every recipient, content, date and attachment. Simulate Approval freezes these practice choices."
              : "The clock advances only when you use the controls. All statuses below are simulated."}
          </p>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Recipient / message</th>
                  <th>UTC schedule</th>
                  <th>Attachment</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {(stage === 3
                  ? (() => {
                      try {
                        return preview();
                      } catch {
                        return [];
                      }
                    })()
                  : jobs
                ).map((job) => (
                  <tr key={job.id}>
                    <td>
                      <strong>{job.recipient}</strong>
                      <details>
                        <summary>
                          {job.kind}: {job.subject}
                        </summary>
                        <p>{job.body}</p>
                      </details>
                    </td>
                    <td>{new Date(job.at).toISOString()}</td>
                    <td>{job.attachment ? "Fictional CV.pdf" : "None"}</td>
                    <td>{job.status}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {stage === 3 && (
            <button
              className="primary"
              onClick={() =>
                attempt(() => {
                  setJobs(preview());
                  setStage(4);
                  setClock(Date.now());
                })
              }
            >
              Simulate Approval
            </button>
          )}
          {stage === 4 && (
            <>
              <div className="practice-statistics" role="status">
                Scheduled: {jobs.filter((j) => j.status === "scheduled").length}{" "}
                · Sent: {jobs.filter((j) => j.status === "sent").length} ·
                Cancelled: {jobs.filter((j) => j.status === "cancelled").length}{" "}
                · Replies: {replies.length}
              </div>
              <p>Simulation clock: {new Date(clock).toISOString()}</p>
              <div className="actions">
                <button
                  className="primary"
                  disabled={
                    playing || !jobs.some((j) => j.status === "scheduled")
                  }
                  onClick={() => setPlaying(true)}
                >
                  {playing ? "Simulating…" : "Animate next scheduled time"}
                </button>
                {rows.map((row) => (
                  <button
                    key={row.email}
                    className="secondary"
                    disabled={
                      replies.includes(row.email) ||
                      !jobs.some(
                        (j) =>
                          j.recipient === row.email &&
                          j.kind === "initial" &&
                          j.status === "sent",
                      )
                    }
                    onClick={() => {
                      setPlaying(false);
                      setJobs(replyPractice(jobs, row.email));
                      setReplies([...replies, row.email]);
                    }}
                  >
                    Simulate reply: {row.name}
                  </button>
                ))}
              </div>
              <p>
                A reply cancels that professor’s remaining scheduled follow-ups.
                Already simulated sent messages stay sent.
              </p>
            </>
          )}
        </section>
      )}
      <div className="actions">
        {stage > 0 && stage < 4 && (
          <button
            className="secondary"
            onClick={() => {
              setError("");
              setStage(stage - 1);
            }}
          >
            Back
          </button>
        )}
        {stage > 0 && stage < 3 && (
          <button
            className="primary"
            onClick={() =>
              attempt(() => {
                if (stage === 2) {
                  validateSequenceIfPresent(steps);
                  preview();
                }
                setStage(stage + 1);
              })
            }
          >
            Next: {stage === 1 ? "dates, follow-ups & CV" : "complete review"}
          </button>
        )}
        <button
          className="secondary"
          onClick={() => {
            setStage(0);
            setRows([]);
            setJobs([]);
            setReplies([]);
            setError("");
            setPlaying(false);
            setSteps([
              {
                subject: "Following up on my research enquiry",
                body: "Dear Professor, thank you for your time. Example Student.",
                delay_value: 7,
                delay_unit: "days",
                relative_to: "original",
              },
            ]);
            setCV(true);
            setFollowCV(false);
            setAt(new Date(Date.now() + 86400000).toISOString().slice(0, 16));
          }}
        >
          Restart practice
        </button>
      </div>
    </div>
  );
}
function validateSequenceIfPresent(steps: FollowupStep[]) {
  if (steps.length) validateSequence(steps);
}
