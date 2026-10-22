import webpush from 'web-push';

export type WebSub = { endpoint: string; p256dh: string; auth: string };

export type WebPushPayload = {
  title: string;
  body: string;
  tag: string;
  url: string;
  reminderDate: string;
  habitIds: string[];
};

/** accepted = push service took it (2xx). gone = subscription expired (404/410). failed = anything else. */
export type WebPushResult = 'accepted' | 'gone' | 'failed';

let configured: boolean | null = null;

/**
 * Web push is optional. It is enabled only when all three VAPID variables are
 * set and valid. If not, the worker behaves exactly as it did before.
 */
export function isWebPushEnabled(): boolean {
  if (configured !== null) return configured;

  const publicKey = process.env.VAPID_PUBLIC_KEY?.trim();
  const privateKey = process.env.VAPID_PRIVATE_KEY?.trim();
  const subject = process.env.VAPID_SUBJECT?.trim();

  if (!publicKey || !privateKey || !subject) {
    configured = false;
    return configured;
  }

  try {
    webpush.setVapidDetails(subject, publicKey, privateKey);
    configured = true;
  } catch (error) {
    console.error('[web-push] VAPID configuration is invalid; web push disabled:', error instanceof Error ? error.message : String(error));
    configured = false;
  }
  return configured;
}

export async function sendWebPush(sub: WebSub, payload: WebPushPayload): Promise<WebPushResult> {
  try {
    const response = await webpush.sendNotification(
      { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
      JSON.stringify(payload),
      {
        TTL: 300, // a reminder older than the 5-minute retry window is stale
        urgency: 'high',
        topic: 'habit-reminder', // a newer attempt replaces an undelivered older one
        timeout: 15_000,
      },
    );
    return response.statusCode >= 200 && response.statusCode < 300 ? 'accepted' : 'failed';
  } catch (error) {
    const statusCode = (error as { statusCode?: number }).statusCode;
    if (statusCode === 404 || statusCode === 410) return 'gone';
    console.error('[web-push] send failed:', statusCode ?? '', error instanceof Error ? error.message : String(error));
    return 'failed';
  }
}
