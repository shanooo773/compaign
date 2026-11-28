"use client";
import {
  Turnstile,
  PasskeyLogin,
  RecoveryForm,
  SecuritySettings,
} from "./security-ui";
import { useState, type FormEvent } from "react";
import {
  GraduationCap,
  ShieldCheck,
  Eye,
  EyeOff,
  ArrowUpRight,
  Mail,
} from "lucide-react";
import { GoogleActivationAction } from "./google-activation-ui";
import { DeveloperIntroduction } from "./developer-introduction";
import { passwordStrength } from "../../../shared/password-policy";
export type Api = (
  path: string,
  method?: string,
  data?: unknown,
) => Promise<any>;
export type Identity = {
  email: string;
  first_name: string;
  last_name: string;
  display_name: string;
  email_verified_at: number | null;
  legacy_access: number;
};
export function PasswordField({
  name = "password",
  label = "Password",
  confirm = false,
  onValue,
}: {
  name?: string;
  label?: string;
  confirm?: boolean;
  onValue?: (value: string) => void;
}) {
  const [visible, setVisible] = useState(false);
  return (
    <label>
      {label}
      <span className="password-control">
        <input
          name={name}
          type={visible ? "text" : "password"}
          required
          maxLength={128}
          minLength={confirm ? 1 : 15}
          autoComplete={
            name === "current_password" ? "current-password" : "new-password"
          }
          onChange={(e) => onValue?.(e.target.value)}
        />
        <button
          type="button"
          aria-label={`${visible ? "Hide" : "Show"} ${label.toLowerCase()}`}
          aria-pressed={visible}
          onClick={() => setVisible(!visible)}
        >
          {visible ? <EyeOff size={18} /> : <Eye size={18} />}
        </button>
      </span>
    </label>
  );
}
function Notice({ text, error = false }: { text: string; error?: boolean }) {
  return text ? (
    <div
      className={`feedback ${error ? "error" : "success"}`}
      role={error ? "alert" : "status"}
    >
      {text}
    </div>
  ) : null;
}
export function AuthPanel({
  api,
  onComplete,
  intent,
  onCancel,
}: {
  api: Api;
  onComplete: () => Promise<void>;
  intent?: { kind: "verify" | "reset"; token: string } | null;
  onCancel?: () => void;
}) {
  const [completed, setCompleted] = useState(false);
  const [securityReady, setSecurityReady] = useState(false);
  const [securityReset, setSecurityReset] = useState(0);
  const [mode, setMode] = useState<"login" | "signup" | "forgot">("login"),
    [password, setPassword] = useState(""),
    [email, setEmail] = useState(""),
    [busy, setBusy] = useState(false),
    [message, setMessage] = useState(""),
    [error, setError] = useState("");
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const data = Object.fromEntries(new FormData(e.currentTarget));
    setBusy(true);
    setError("");
    setMessage("");
    try {
      if (intent) {
        await api(
          intent.kind === "verify"
            ? "/auth/verify-email"
            : "/auth/reset-password",
          "POST",
          { ...data, token: intent.token },
        );
        setMessage(
          intent.kind === "verify"
            ? "Email verified. You can now sign in."
            : "Password reset. Sign in with your new password.",
        );
        setCompleted(true);
      } else if (mode === "forgot") {
        const result = await api("/auth/forgot-password", "POST", data);
        setMessage(result.message);
      } else if (mode === "signup") {
        const result = await api("/auth/signup", "POST", {
          ...data,
          accept_terms: data.accept_terms === "on",
          turnstile_token: data["cf-turnstile-response"],
        });
        setMessage(result.message);
        setMode("login");
      } else {
        await api("/auth/login", "POST", data);
        await onComplete();
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unable to complete request.");
      if (!intent && mode === "signup") setSecurityReset((v) => v + 1);
    } finally {
      setBusy(false);
    }
  }
  const title = intent
    ? intent.kind === "verify"
      ? "Confirm your email"
      : "Choose a new password"
    : mode === "signup"
      ? "Your next chapter starts here."
      : mode === "forgot"
        ? "Let’s get you back in."
        : "Welcome to your research workspace.";
  return (
    <main className="auth auth-premium">
      <a href="/" className="auth-brand">
        <GraduationCap size={35} />
        <span>
          MS Professor
          <br />
          <b>OUTREACH AGENT</b>
        </span>
      </a>
      <div className="auth-layout">
        <section className="auth-introduction"><a className="brand" href="/">Professor Agent</a><h1>Thoughtful outreach.<br/>Meaningful opportunities.</h1><p>Organize your research contacts, review your emails, and follow up with care.</p><ul><li>Campaigns built around your research goals</li><li>Clear schedules and careful approvals</li><li>Your documents and conversations, together</li></ul><small>Private by design. You choose when to send.</small></section>
        <section className="auth-card" id="account-access" tabIndex={-1}>
          <span className="eyebrow">YOUR ACADEMIC JOURNEY</span>
          <h2>{title}</h2>
          {!intent && (
            <div className="tabs">
              <button
                type="button"
                className={mode === "login" ? "active" : ""}
                onClick={() => {
                  setMode("login");
                  setError("");
                }}
              >
                Sign in
              </button>
              <button
                type="button"
                className={mode === "signup" ? "active" : ""}
                onClick={() => {
                  setMode("signup");
                  setError("");
                }}
              >
                Create account
              </button>
            </div>
          )}
          <Notice text={error} error />
          {error && mode === "login" && (
            <p className="helper">
              Try again, sign in with a registered passkey, or recover with a
              saved recovery code below.
            </p>
          )}
          <Notice text={message} />
          {completed ? (
            <button
              className="primary full"
              onClick={async () => {
                onCancel?.();
                await onComplete();
              }}
            >
              Continue to sign in
            </button>
          ) : (
            <form onSubmit={submit} hidden={!intent && mode === "forgot"}>
              {!intent && mode === "signup" && (
                <>
                  <div className="form-grid">
                    <label>
                      First name
                      <input
                        name="first_name"
                        required
                        maxLength={80}
                        autoComplete="given-name"
                      />
                    </label>
                    <label>
                      Last name
                      <input
                        name="last_name"
                        required
                        maxLength={80}
                        autoComplete="family-name"
                      />
                    </label>
                  </div>
                  <label>
                    Display name <small>(optional)</small>
                    <input
                      name="display_name"
                      maxLength={160}
                      autoComplete="nickname"
                    />
                  </label>
                </>
              )}
              {!intent && (
                <label>
                  Email address
                  {mode === "signup" && (
                    <small>
                      Use your Gmail or Google Workspace email. After login,
                      verify with the matching Google account and connect Gmail.
                    </small>
                  )}
                  <input
                    name="email"
                    type="email"
                    required
                    maxLength={254}
                    autoComplete="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                  />
                </label>
              )}
              {!intent && mode === "login" && (
                <>
                  <label>
                    Password
                    <LoginPassword />
                  </label>
                  <button
                    className="text-link forgot-link"
                    type="button"
                    onClick={() => setMode("forgot")}
                  >
                    Forgot password?
                  </button>
                </>
              )}
              {((!intent && mode === "signup") || intent?.kind === "reset") && (
                <>
                  <PasswordField onValue={setPassword} />
                  <div
                    className={`strength ${passwordStrength(password, email).toLowerCase()}`}
                    aria-live="polite"
                  >
                    <span />
                    Password strength: {passwordStrength(password, email)}
                  </div>
                  <p className="helper">
                    Use 15–128 characters. A long, unique passphrase works well.
                    Avoid common or reused passwords; letters, numbers and
                    symbols can help. Local screening cannot detect every
                    breached password.
                  </p>
                  <PasswordField
                    name="confirm_password"
                    label="Confirm password"
                    confirm
                  />
                </>
              )}
              {!intent && mode === "signup" && (
                <label className="checkbox-label">
                  <input name="accept_terms" type="checkbox" required />I accept
                  the{" "}
                  <a href="/#terms" target="_blank" rel="noreferrer">
                    usage terms
                  </a>{" "}
                  and{" "}
                  <a href="/#privacy" target="_blank" rel="noreferrer">
                    privacy notice
                  </a>
                  .
                </label>
              )}
              {intent?.kind === "verify" && (
                <p>
                  Confirm that you requested this verification link. Opening the
                  link alone does not change your account.
                </p>
              )}
              {!intent && mode === "signup" && (
                <Turnstile onReady={setSecurityReady} reset={securityReset} />
              )}
              <button
                className="primary full"
                disabled={
                  busy || (!intent && mode === "signup" && !securityReady)
                }
              >
                {busy
                  ? "Please wait…"
                  : intent
                    ? intent.kind === "verify"
                      ? "Verify my email"
                      : "Reset password"
                    : mode === "login"
                      ? "Sign in with password"
                      : mode === "signup"
                        ? "Create account"
                        : "Request reset link"}
                <ArrowUpRight size={17} />
              </button>
              {!intent && mode === "forgot" && (
                <button
                  type="button"
                  className="secondary full"
                  onClick={() => setMode("login")}
                >
                  Back to sign in
                </button>
              )}
            </form>
          )}
          {!intent && (mode === "login" || mode === "forgot") && (
            <PasskeyLogin api={api} onComplete={onComplete} />
          )}
          {!intent && (mode === "forgot" || mode === "login") && (
            <RecoveryForm api={api} />
          )}
          <p className="security-note">
            <ShieldCheck size={16} />
            Private by design. Sending stays under your control.
          </p>
        </section>
      </div>
    </main>
  );
}
function LoginPassword() {
  const [show, setShow] = useState(false);
  return (
    <span className="password-control">
      <input
        name="password"
        type={show ? "text" : "password"}
        required
        maxLength={128}
        autoComplete="current-password"
      />
      <button
        type="button"
        aria-label={show ? "Hide password" : "Show password"}
        aria-pressed={show}
        onClick={() => setShow(!show)}
      >
        {show ? <EyeOff size={18} /> : <Eye size={18} />}
      </button>
    </span>
  );
}
export function AccountSettings({
  ready = false,
  account,
  api,
  refresh,
}: {
  ready?: boolean;
  account: Identity;
  api: Api;
  refresh: () => Promise<void>;
}) {
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [message, setMessage] = useState("");
  async function run(fn: () => Promise<void>, text: string) {
    setBusy(true);
    setError("");
    try {
      await fn();
      setMessage(text);
      await refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="panel settings-card account-settings">
      <div className="panel-heading">
        <div>
          <span className="eyebrow">YOUR IDENTITY & SECURITY</span>
          <h2>Account settings</h2>
        </div>
        <ShieldCheck size={24} />
      </div>
      <Notice text={error} error />
      <Notice text={message} />
      <p>
        <strong>{account.email}</strong>
        <br />
        <span className="badge">
          {account.email_verified_at
            ? "Email verified"
            : account.legacy_access
              ? "Existing account · email not yet verified"
              : "Email Not Verified"}
        </span>
      </p>
      {!account.email_verified_at && (
        <p className="helper">
          Use Verify with Google & Connect Gmail below to prove ownership of
          your registered email. Google must provide matching verified Gmail or
          Google Workspace evidence. No accounts are merged automatically.
        </p>
      )}
      {!account.email_verified_at && (
        <GoogleActivationAction api={api} ready={ready} refresh={refresh} />
      )}
      <p className="helper">
        Account recovery: keep a registered passkey or saved recovery codes.
        Google activation does not reset your local password or replace
        recovery. Email-based password reset is currently unavailable when
        transactional delivery is disabled.
      </p>
      <form
        key={account.display_name}
        onSubmit={(e) => {
          e.preventDefault();
          const data = Object.fromEntries(new FormData(e.currentTarget));
          run(async () => {
            await api("/account/profile", "PUT", data);
          }, "Your name has been updated.");
        }}
      >
        <div className="form-grid">
          <label>
            First name
            <input
              name="first_name"
              defaultValue={account.first_name}
              required
              maxLength={80}
            />
          </label>
          <label>
            Last name
            <input
              name="last_name"
              defaultValue={account.last_name}
              required
              maxLength={80}
            />
          </label>
        </div>
        <label>
          Display name
          <input
            name="display_name"
            defaultValue={account.display_name}
            required
            maxLength={160}
          />
        </label>
        <button className="primary" disabled={busy}>
          Save account details
        </button>
      </form>
      <hr />
      <SecuritySettings api={api} />
      <h3>Password & sessions</h3>
      <p>
        Changing your password signs out every device and invalidates pending
        recovery and OAuth attempts.
      </p>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          const data = Object.fromEntries(new FormData(e.currentTarget));
          run(async () => {
            await api("/auth/change-password", "POST", data);
          }, "Password changed. Sign in again.");
        }}
      >
        <PasswordField
          name="current_password"
          label="Current password"
          confirm
        />
        <PasswordField label="New password" />
        <PasswordField
          name="confirm_password"
          label="Confirm new password"
          confirm
        />
        <button className="secondary" disabled={busy}>
          Change password
        </button>
      </form>
      <button
        className="secondary"
        disabled={busy}
        onClick={() =>
          run(async () => {
            await api("/auth/logout-all", "POST");
          }, "All devices signed out.")
        }
      >
        Sign out all devices
      </button>
      <hr />
      <details className="danger-zone">
        <summary>Delete account permanently</summary>
        <p>
          This removes your profile, professors, messages, schedules,
          notifications and document access. Sessions and locally held OAuth
          tokens are removed immediately. Private storage deletion is retried in
          the background; opaque object keys and byte reservations remain until
          cleanup/expiry. Shared abuse counters and provider-side mail/consent
          records may remain. Remove Google app consent in your Google account
          if needed. An email already accepted by a provider cannot be recalled.
        </p>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            const data = Object.fromEntries(new FormData(e.currentTarget));
            if (
              !window.confirm(
                "Permanently delete your account and all private workspace data? This cannot be undone.",
              )
            )
              return;
            run(async () => {
              await api("/account/delete", "POST", data);
            }, "Account deleted.");
          }}
        >
          <PasswordField
            name="current_password"
            label="Confirm your password"
            confirm
          />
          <label>
            Type DELETE MY ACCOUNT
            <input
              name="confirmation"
              required
              pattern="DELETE MY ACCOUNT"
              autoComplete="off"
            />
          </label>
          <button className="danger" disabled={busy}>
            Delete my account permanently
          </button>
        </form>
      </details>
    </section>
  );
}
export function PolicyNotice({
  kind,
  onClose,
}: {
  kind: string;
  onClose: () => void;
}) {
  return (
    <main className="auth">
      <article className="auth-card">
        <h1>{kind === "terms" ? "Usage terms" : "Privacy notice"}</h1>
        <p>
          This personal development workspace helps you organize research
          outreach. You are responsible for consent, accurate content, lawful
          use and your recipient choices. Do not use it for spam. Sending
          requires explicit approval and may be unavailable.
        </p>
        <p>
          The application stores your account, academic profile, professor
          records, drafts, private documents and connected-provider tokens.
          Documents are access controlled and normally expire after 30 days.
          Files selected for approved campaigns are privately retained while
          their approved messages remain active, including retry time. Tokens
          are encrypted. Hosting uses Vercel and Cloudflare. Configured
          transactional delivery processes your address and account link; AI
          receives selected context only when enabled and used. Provider consent
          screens describe mailbox permissions.
        </p>
        <p>
          You can edit your profile, disconnect mailboxes and delete your
          account in Settings. Background cleanup may retain opaque object
          identifiers until expiry; abuse-prevention counters are retained
          separately. External provider mail and consent records are governed by
          their policies. This development service has no uptime guarantee.
          Contact the project operator through the channel where you obtained
          access for privacy requests.
        </p>
        <button className="primary" onClick={onClose}>
          Back to application
        </button>
      </article>
    </main>
  );
}
