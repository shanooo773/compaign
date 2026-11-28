"use client";
import { useEffect, useState } from "react";
import { ArrowUpRight, Sparkles, ShieldCheck } from "lucide-react";
export function DeveloperIntroduction() {
  const [skipped, setSkipped] = useState(false);
  useEffect(() => {
    try {
      setSkipped(sessionStorage.getItem("developer-intro-seen") === "1");
      sessionStorage.setItem("developer-intro-seen", "1");
    } catch {}
  }, []);
  return (
    <section
      className={"developer-intro " + (skipped ? "intro-skipped" : "")}
      aria-label="Developer introduction"
    >
      <div className="intro-topline">
        <span>
          <Sparkles size={14} /> RESEARCH, WITH PURPOSE
        </span>
        <button
          type="button"
          className="intro-skip"
          onClick={() => {
            setSkipped(true);
            document.getElementById("account-access")?.focus();
          }}
        >
          Skip introduction <ArrowUpRight size={14} />
        </button>
      </div>
      <div className="portrait-orbit">
        <img
          src="/developer-photo.jpeg"
          width="240"
          height="240"
          alt="Muhammad Farhat Mehdi"
          fetchPriority="high"
        />
      </div>
      <span className="intro-kicker">YOUR NEXT RESEARCH CHAPTER</span>
      <h1>MS Professor Agent</h1>
      <p className="intro-lead">
        Meaningful academic connections.
        <br />
        Thoughtfully planned. Always in your control.
      </p>
      <div className="developer-identity">
        <strong>Developed by Muhammad Farhat Mehdi</strong>
        <p>Department of Computer Engineering</p>
        <p>Session 2023</p>
        <p>University of Engineering and Technology (UET), Taxila, Pakistan</p>
      </div>
      <dl className="intro-metrics">
        <div>
          <dt>60 days</dt>
          <dd>Campaign horizon</dd>
        </div>
        <div>
          <dt>10 steps</dt>
          <dd>Exact follow-ups</dd>
        </div>
        <div>
          <dt>One approval</dt>
          <dd>You stay in control</dd>
        </div>
      </dl>
      <span className="story-note">
        <ShieldCheck size={17} /> Private documents. Connected Gmail. Human
        approval.
      </span>
    </section>
  );
}
