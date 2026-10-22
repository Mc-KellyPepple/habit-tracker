import { useCallback, useEffect, useState } from "react";
import {
  disablePush,
  enablePush,
  getPushState,
  showTestNotification,
  syncPushSubscription,
} from "./lib/push";
import type { PushState } from "./lib/push";

export default function ReminderPanel({ userId }: { userId: string }) {
  const [state, setState] = useState<PushState | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  const refresh = useCallback(async () => {
    try {
      setState(await getPushState());
    } catch {
      setState("unsupported");
    }
  }, []);

  // On sign-in, make sure this browser's subscription belongs to the signed-in user.
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        await syncPushSubscription();
      } catch {
        /* non-fatal: the panel still reflects the real state below */
      }
      if (alive) await refresh();
    })();
    return () => {
      alive = false;
    };
  }, [userId, refresh]);

  const run = async (action: () => Promise<void>, fallback: string) => {
    setBusy(true);
    setMessage("");
    try {
      await action();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : fallback);
    }
    await refresh();
    setBusy(false);
  };

  if (state === null || state === "unconfigured") return null;

  return (
    <div className="push-panel">
      <h3>Phone reminders</h3>

      {state === "off" && (
        <>
          <p>Allow notifications to get your habit reminders on this device, even when this tab is closed.</p>
          <button className="primary-button" disabled={busy} onClick={() => void run(enablePush, "Could not turn on reminders.")}>
            {busy ? "Please wait…" : "Enable reminders"}
          </button>
        </>
      )}

      {state === "on" && (
        <>
          <p className="push-on">✓ Reminders are on for this device.</p>
          <p>You'll be reminded at the time set for each habit, unless you've already checked it in.</p>
          <div className="push-actions">
            <button className="action-link" disabled={busy} onClick={() => void run(showTestNotification, "Could not show a test notification.")}>
              Send test
            </button>
            <button className="action-link action-danger" disabled={busy} onClick={() => void run(disablePush, "Could not turn off reminders.")}>
              Turn off
            </button>
          </div>
        </>
      )}

      {state === "denied" && (
        <p>Notifications are blocked for this site. Allow them in your browser's site settings, then reload this page.</p>
      )}

      {state === "ios-needs-install" && (
        <p>On iPhone, tap Share, then Add to Home Screen. Open the app from your Home Screen and enable reminders there.</p>
      )}

      {state === "unsupported" && (
        <p>This browser can't show push reminders. Try Chrome on Android, or install the Android app.</p>
      )}

      {message && <p className="push-error">{message}</p>}
    </div>
  );
}
