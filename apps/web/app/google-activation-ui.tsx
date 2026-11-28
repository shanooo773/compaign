"use client";
import { useState } from "react";
import type { Api } from "./account-ui";
export function GoogleActivationAction({
  api,
  ready,
  refresh,
}: {
  api: Api;
  ready: boolean;
  refresh: () => Promise<void>;
}) {
  const [busy, setBusy] = useState(false),
    [message, setMessage] = useState("");
  return (
    <div className="google-activation-action">
      <p>
        Choose the same Google email you used to register. Google must confirm
        verified Gmail or Google Workspace ownership and grant sending and
        reply-reading permissions. No email is sent by activation.
      </p>
      <div className="actions">
        <button
          data-tour="verify-google"
          className="primary"
          disabled={busy || !ready}
          onClick={async () => {
            setBusy(true);
            setMessage(
              "Google verification in progress. Continue on Google’s secure authorization page.",
            );
            try {
              const result = await api("/auth/google/start", "POST", {
                confirmed: true,
              });
              const url = new URL(result.url);
              if (
                url.protocol !== "https:" ||
                url.hostname !== "accounts.google.com"
              )
                throw Error(
                  "Invalid authorization destination. Please try again.",
                );
              window.location.assign(url.href);
            } catch (e) {
              setBusy(false);
              setMessage((e as Error).message);
            }
          }}
        >
          {busy
            ? "Google verification in progress…"
            : "Verify with Google & Connect Gmail"}
        </button>
        <button
          className="secondary"
          disabled={busy}
          onClick={async () => {
            try {
              await refresh();
              setMessage("Account status refreshed.");
            } catch {
              setMessage("Could not refresh account status. Try again.");
            }
          }}
        >
          Refresh activation status
        </button>
      </div>
      {!ready && (
        <p>
          Google activation is temporarily unavailable because the application’s
          Google OAuth configuration is incomplete. Your account remains
          restricted. You can still use your private workspace and Practice
          Campaign.
        </p>
      )}
      <p role="status">{message}</p>
      <small>
        Never enter a Google password here. A mismatched Google address cannot
        verify or merge accounts. Registration with a third-party email without
        authoritative Google Workspace evidence cannot be activated by this
        flow.
      </small>
    </div>
  );
}
