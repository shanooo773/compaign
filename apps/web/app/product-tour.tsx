"use client";
import { useEffect, useRef, useState } from "react";
type Step = { page: string; target: string; title: string; text: string };
const pageSteps: Record<string, Step[]> = {
  Overview: [
    {
      page: "Overview",
      target: "activation",
      title: "Start with account activation",
      text: "Use Verify with Google & Connect Gmail to prove ownership of the exact email you registered. Google verifies identity and grants mailbox permissions; no transactional provider is needed.",
    },
    {
      page: "Overview",
      target: "welcome",
      title: "Follow your next step",
      text: "Use the checklist, read Getting Started, or try a fictional campaign. Existing campaigns stay accessible from Outreach.",
    },
  ],
  "Getting Started": [
    {
      page: "Getting Started",
      target: "learning",
      title: "Your permanent guide",
      text: "Read 14 modules, save reading progress in this browser, and replay the two animated demonstrations.",
    },
  ],
  "Practice Campaign": [
    {
      page: "Practice Campaign",
      target: "practice",
      title: "Practise without sending",
      text: "Download or simulate importing fictional professors, review a plan, simulate approval and observe reply cancellation. No live API is used.",
    },
  ],
  "Smart Import": [
    {
      page: "Smart Import",
      target: "nav-Smart Import",
      title: "Name your campaign, then add professors",
      text: "Enter a campaign name and continue. Then choose text, table or file. Existing templates, browser-only parsing, validation and timezone review remain available before creating an unapproved draft.",
    },
    {
      page: "Smart Import",
      target: "nav-Smart Import",
      title: "Review remains a separate step",
      text: "Add to Campaign creates drafts only. In the existing review, select your CV, inspect every message, follow-up and schedule, then approve the complete plan once. Tours never approve campaigns.",
    },
  ],
  Professors: [
    {
      page: "Professors",
      target: "add-professor",
      title: "Add a professor",
      text: "This is the real Add professor button. Check the official institutional address before saving a record. Tour Next never clicks it.",
    },
    {
      page: "Professors",
      target: "nav-Professors",
      title: "Build your shortlist",
      text: "Use Add professor for a manual record, or download the template before importing. Required headers are name and email. Confirm institutional addresses on official university pages.",
    },
  ],
  "Academic profile": [
    {
      page: "Academic profile",
      target: "profile-university",
      title: "Enter your university",
      text: "Use your real university in this field, then complete degree and research interests and save the form.",
    },
    {
      page: "Academic profile",
      target: "nav-Academic profile",
      title: "Your academic story",
      text: "Complete and save the real university, degree and research interests in the form. These help prepare factual outreach.",
    },
  ],
  Documents: [
    {
      page: "Documents",
      target: "file-upload",
      title: "Upload a reviewed CV",
      text: "This real upload control accepts supported private documents. The tour never selects or uploads a file for you.",
    },
    {
      page: "Documents",
      target: "nav-Documents",
      title: "Private academic documents",
      text: "Use the upload control for a CV or transcript. PDF, DOCX and TXT are supported, up to 2 MiB each. Check expiration and select attachments explicitly during review.",
    },
  ],
  Settings: [
    {
      page: "Settings",
      target: "nav-Settings",
      title: "Account and Gmail access",
      text: "Review account verification and security first. Only eligible accounts can connect Gmail. Continue on Google’s consent page, then check the connected address. Never enter a Gmail password here.",
    },
  ],
  Outreach: [
    {
      page: "Outreach",
      target: "compose",
      title: "Prepare a draft",
      text: "Compose opens the real draft form. Learn the process in Practice Campaign before using real recipients. This tutorial does not open or submit the form.",
    },
    {
      page: "Outreach",
      target: "nav-Outreach",
      title: "Review before approval",
      text: "Inspect initial messages, follow-ups, sender, dates and attachments. A real approval authorises the displayed plan. Tour controls never approve or send.",
    },
  ],
  "Follow-ups": [
    {
      page: "Follow-ups",
      target: "nav-Follow-ups",
      title: "Track the conversation",
      text: "Inspect each follow-up and cancellation reason. Safety checks and reply polling can postpone delivery. A detected tracked reply cancels remaining eligible steps.",
    },
  ],
  "Audit history": [
    {
      page: "Audit history",
      target: "nav-Audit history",
      title: "Inspect recorded activity",
      text: "This section shows account activity. Check actual campaign and transport status before retrying an uncertain delivery.",
    },
  ],
};
export function ProductTour({
  userKey,
  limited,
  view,
  navigate,
  hasCampaigns,
}: {
  userKey: string;
  limited: boolean;
  view: string;
  navigate: (page: string) => void;
  hasCampaigns: boolean;
}) {
  const [steps, setSteps] = useState<Step[]>([]),
    [index, setIndex] = useState(0),
    [active, setActive] = useState(false),
    [offer, setOffer] = useState(false),
    [saved, setSaved] = useState(false);
  const panel = useRef<HTMLElement>(null),
    previous = useRef<HTMLElement | null>(null);
  const key = "ms-tour-v1:" + userKey;
  useEffect(() => {
    try {
      const stored = JSON.parse(localStorage.getItem(key) || "null");
      setSaved(!!stored?.steps);
      setOffer(!stored && !hasCampaigns);
    } catch {
      setOffer(!hasCampaigns);
    }
  }, [key, hasCampaigns]);
  function start(page?: string, resume = false) {
    previous.current = document.activeElement as HTMLElement;
    let selected = page
      ? pageSteps[page] || pageSteps.Overview
      : [
          ...pageSteps.Overview,
          ...pageSteps["Getting Started"],
          ...pageSteps["Academic profile"],
          ...pageSteps.Documents,
          ...pageSteps.Settings,
          ...pageSteps["Practice Campaign"],
        ];
    let position = 0;
    if (resume) {
      try {
        const value = JSON.parse(localStorage.getItem(key) || "null");
        if (
          Array.isArray(value?.steps) &&
          Number.isInteger(value.index) &&
          value.index >= 0 &&
          value.index < value.steps.length
        ) {
          selected = value.steps;
          position = value.index;
        }
      } catch {}
    }
    selected = selected.filter(
      (step) =>
        !limited ||
        !["Outreach", "Follow-ups", "Audit history"].includes(step.page),
    );
    setSteps(selected);
    setIndex(Math.min(position, selected.length - 1));
    setActive(true);
    setOffer(false);
  }
  useEffect(() => {
    const listener = (event: Event) =>
      start((event as CustomEvent<string>).detail);
    window.addEventListener("ms-start-tour", listener);
    return () => window.removeEventListener("ms-start-tour", listener);
  });
  function persist(completed = false) {
    try {
      localStorage.setItem(
        key,
        JSON.stringify(completed ? { completed: true } : { steps, index }),
      );
    } catch {}
  }
  function close(completed = false) {
    persist(completed);
    setActive(false);
    setSaved(!completed);
    previous.current?.focus();
  }
  const step = steps[index];
  useEffect(() => {
    if (!active || !step) return;
    navigate(step.page);
    persist();
    const timer = setTimeout(() => {
      const target = document.querySelector<HTMLElement>(
        `[data-tour="${CSS.escape(step.target)}"]`,
      );
      target?.classList.add("tour-highlight");
      target?.scrollIntoView({ block: "center", behavior: "instant" });
      panel.current?.focus();
    }, 120);
    return () => {
      clearTimeout(timer);
      document
        .querySelectorAll(".tour-highlight")
        .forEach((el) => el.classList.remove("tour-highlight"));
    };
  }, [active, index, step]);
  return (
    <>
      <div className="tour-launch">
        <button className="text-link" onClick={() => start(view)}>
          Page tutorial
        </button>
        <button className="text-link" onClick={() => start()}>
          Replay welcome tour
        </button>
        {saved && (
          <button className="text-link" onClick={() => start(undefined, true)}>
            Resume tutorial
          </button>
        )}
      </div>
      {offer && (
        <section
          className="tour-offer"
          role="region"
          aria-label="Welcome tour invitation"
        >
          <div>
            <strong>New here? Take a quick guided tour.</strong>
            <p>
              Learn the real controls at your pace. You can skip and replay
              anytime.
            </p>
          </div>
          <button className="primary" onClick={() => start()}>
            Start welcome tour
          </button>
          <button
            className="secondary"
            onClick={() => {
              setOffer(false);
              try {
                localStorage.setItem(key, JSON.stringify({ dismissed: true }));
              } catch {}
            }}
          >
            Not now
          </button>
        </section>
      )}
      {active && step && (
        <aside
          className="tour-panel"
          role="region"
          aria-label="Product tutorial"
          tabIndex={-1}
          ref={panel}
          onKeyDown={(e) => {
            if (e.key === "Escape") close();
            if (e.key === "ArrowRight" && index < steps.length - 1)
              setIndex(index + 1);
            if (e.key === "ArrowLeft" && index > 0) setIndex(index - 1);
          }}
        >
          <span className="eyebrow">
            TUTORIAL {index + 1} / {steps.length}
          </span>
          <h2>{step.title}</h2>
          <p>
            {limited && step.page === "Settings"
              ? "Use Verify with Google & Connect Gmail on Overview or Settings. Select the Google account matching your registration. Unsupported identities remain restricted; the private workspace and Practice Campaign stay available."
              : step.text}
          </p>
          <div className="actions">
            <button
              className="secondary"
              disabled={!index}
              onClick={() => setIndex(index - 1)}
            >
              Back
            </button>
            <button
              className="primary"
              onClick={() =>
                index === steps.length - 1 ? close(true) : setIndex(index + 1)
              }
            >
              {index === steps.length - 1 ? "Finish" : "Next"}
            </button>
            <button className="secondary" onClick={() => close()}>
              Skip / resume later
            </button>
          </div>
          <small>
            Escape to skip. Arrow keys move between steps. The workspace remains
            usable.
          </small>
        </aside>
      )}
    </>
  );
}
export function startProductTour(page?: string) {
  window.dispatchEvent(new CustomEvent("ms-start-tour", { detail: page }));
}
