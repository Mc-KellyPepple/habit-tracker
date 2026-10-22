import { supabase } from "./supabase";

/** Public VAPID key (safe to expose). Without it, web reminders stay hidden. */
const VAPID_PUBLIC_KEY = import.meta.env.VITE_VAPID_PUBLIC_KEY as string | undefined;

export type PushState =
  | "unconfigured"
  | "unsupported"
  | "ios-needs-install"
  | "denied"
  | "off"
  | "on";

const isIos = () =>
  /iphone|ipad|ipod/i.test(navigator.userAgent) ||
  (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);

const isStandalone = () =>
  window.matchMedia("(display-mode: standalone)").matches ||
  (navigator as Navigator & { standalone?: boolean }).standalone === true;

function keyToBytes(base64Url: string): Uint8Array<ArrayBuffer> {
  const padded = base64Url.padEnd(base64Url.length + ((4 - (base64Url.length % 4)) % 4), "=");
  const raw = atob(padded.replace(/-/g, "+").replace(/_/g, "/"));
  const bytes = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
  return bytes;
}

async function currentSubscription() {
  const registration = await navigator.serviceWorker.getRegistration("/");
  return registration ? registration.pushManager.getSubscription() : null;
}

async function saveSubscription(subscription: PushSubscription) {
  const json = subscription.toJSON();
  const p256dh = json.keys?.p256dh;
  const auth = json.keys?.auth;
  if (!json.endpoint || !p256dh || !auth) throw new Error("This browser returned an incomplete push subscription.");

  const { error } = await supabase.rpc("register_web_push_subscription", {
    p_endpoint: json.endpoint,
    p_p256dh: p256dh,
    p_auth: auth,
    p_user_agent: navigator.userAgent,
  });
  if (error) throw new Error(error.message);
}

export async function getPushState(): Promise<PushState> {
  if (!VAPID_PUBLIC_KEY) return "unconfigured";
  if (isIos() && !isStandalone()) return "ios-needs-install";
  if (!("serviceWorker" in navigator) || !("PushManager" in window) || !("Notification" in window)) return "unsupported";
  if (Notification.permission === "denied") return "denied";

  const subscription = await currentSubscription();
  return subscription && Notification.permission === "granted" ? "on" : "off";
}

export async function enablePush(): Promise<void> {
  if (!VAPID_PUBLIC_KEY) throw new Error("Web reminders are not configured.");

  const permission = await Notification.requestPermission();
  if (permission !== "granted") throw new Error("Notifications were not allowed.");

  const registration = await navigator.serviceWorker.register("/sw.js");
  await navigator.serviceWorker.ready;

  let subscription = await registration.pushManager.getSubscription();
  if (!subscription) {
    subscription = await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: keyToBytes(VAPID_PUBLIC_KEY),
    });
  }
  await saveSubscription(subscription);
}

export async function disablePush(): Promise<void> {
  const subscription = await currentSubscription();
  if (!subscription) return;

  const { error } = await supabase
    .from("web_push_subscriptions")
    .delete()
    .eq("endpoint", subscription.endpoint);
  if (error) throw new Error(error.message);

  await subscription.unsubscribe();
}

/** Re-binds this browser's subscription to whoever is signed in (e.g. after switching accounts). */
export async function syncPushSubscription(): Promise<void> {
  if ((await getPushState()) !== "on") return;
  const subscription = await currentSubscription();
  if (subscription) await saveSubscription(subscription);
}

/** Local test only: proves this device can show notifications. It does not go through the server. */
export async function showTestNotification(): Promise<void> {
  const registration = await navigator.serviceWorker.ready;
  await registration.showNotification("Habit Reminder", {
    body: "Test notification. Reminders will look like this.",
    icon: "/icon-192.png",
    tag: "habit-reminder-test",
  });
}
