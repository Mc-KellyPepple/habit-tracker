import { Expo, ExpoPushMessage } from 'expo-server-sdk';
import { supabaseAdmin as supabase } from './supabaseAdmin';
import { isWebPushEnabled, sendWebPush, WebSub } from './webPush';

const expo = new Expo();
const MAX_ATTEMPTS = 3;
const RETRY_DELAY_MS = 5 * 60 * 1000;

type Habit = {
  id: string;
  user_id: string;
  name: string;
  reminder_hour_utc: number;
};
type ActivityRow = { habit_id: string; retired_at: string | null };
type PushTarget = { userId: string; habitIds: string[] };
type HabitIdRow = { habit_id: string };
type PushTokenRow = { user_id: string; expo_push_token: string };
type WebSubRow = { user_id: string; endpoint: string; p256dh: string; auth: string };
type DeliveryRow = { habit_id: string; attempts: number; status: string; expires_at: string };

// Same wording the app has always received.
function reminderText(count: number, names: string[]) {
  return {
    title: count === 1 ? 'Habit Reminder' : 'Habit Reminders',
    body: count === 1 ? `Time to complete "${names[0] ?? 'your habit'}".` : `You have ${count} habits to complete.`,
  };
}

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

export async function sendReminders() {
  const startedAt = Date.now();
  const now = new Date();
  const reminderDate = now.toISOString().slice(0, 10);
  const currentHour = now.getUTCHours();

  const { data: habits, error: habitsError } = await supabase
    .from('habits')
    .select('id,user_id,name,reminder_hour_utc')
    .eq('archived', false)
    .is('retired_at', null)
    .eq('reminder_hour_utc', currentHour);
  if (habitsError) throw habitsError;

  if (!habits?.length) {
    return { reminderDate, currentHour, started: 0, delivered: 0, checkedIn: 0, expired: 0, attempts: 0, usersNotified: 0 };
  }

  const habitList = habits as Habit[];
  const habitIds = habitList.map(h => h.id);

  const { data: checkins, error: checkinsError } = await supabase
    .from('checkins').select('habit_id').in('habit_id', habitIds).eq('checked_at', reminderDate);
  if (checkinsError) throw checkinsError;
  const checkedInIds = new Set(((checkins ?? []) as HabitIdRow[]).map(r => r.habit_id));

  const { data: activityRows, error: activityError } = await supabase.rpc('update_habit_reminder_activity', {
    p_habit_ids: habitIds,
    p_checked_in_ids: [...checkedInIds],
  });
  if (activityError) throw activityError;

  const eligibleIds = new Set(((activityRows ?? []) as ActivityRow[]).filter(r => r.retired_at === null).map(r => r.habit_id));
  const eligibleHabits = habitList.filter(h => eligibleIds.has(h.id));
  const eligibleCheckedIds = new Set([...checkedInIds].filter(id => eligibleIds.has(id)));
  const uncheckedHabits = eligibleHabits.filter(h => !eligibleCheckedIds.has(h.id));

  if (!uncheckedHabits.length) {
    return { reminderDate, currentHour, started: 0, delivered: 0, checkedIn: eligibleHabits.length, expired: 0, attempts: 0, usersNotified: 0 };
  }

  const userIds = [...new Set(uncheckedHabits.map(h => h.user_id))];
  const { data: tokens, error: tokensError } = await supabase
    .from('push_tokens').select('user_id,expo_push_token').in('user_id', userIds);
  if (tokensError) throw tokensError;

  const validTokens = new Map<string, string>();
  for (const row of (tokens ?? []) as PushTokenRow[]) {
    if (Expo.isExpoPushToken(row.expo_push_token)) validTokens.set(row.user_id, row.expo_push_token);
  }

  // Browser (Web Push) subscriptions are optional. Any problem here must never
  // stop app reminders, so failures are logged and ignored.
  const webSubsByUser = new Map<string, WebSub[]>();
  if (isWebPushEnabled()) {
    const { data: subs, error: subsError } = await supabase
      .from('web_push_subscriptions').select('user_id,endpoint,p256dh,auth').in('user_id', userIds);
    if (subsError) {
      console.error('[reminders] Could not load web push subscriptions; continuing with app push only:', subsError.message);
    } else {
      for (const row of (subs ?? []) as WebSubRow[]) {
        const list = webSubsByUser.get(row.user_id) ?? [];
        list.push({ endpoint: row.endpoint, p256dh: row.p256dh, auth: row.auth });
        webSubsByUser.set(row.user_id, list);
      }
    }
  }

  const sendableHabits = uncheckedHabits.filter(h => validTokens.has(h.user_id) || webSubsByUser.has(h.user_id));
  if (!sendableHabits.length) {
    return { reminderDate, currentHour, started: 0, delivered: 0, checkedIn: eligibleCheckedIds.size, expired: 0, attempts: 0, usersNotified: 0, skippedNoToken: uncheckedHabits.length };
  }

  const sendableIds = sendableHabits.map(h => h.id);
  const { data: startedRows, error: startError } = await supabase.rpc('start_reminder_deliveries', {
    p_habit_ids: sendableIds,
    p_reminder_date: reminderDate,
  });
  if (startError) throw startError;

  const startedIds = new Set(((startedRows ?? []) as HabitIdRow[]).map(r => r.habit_id));
  const activeHabits = sendableHabits.filter(h => startedIds.has(h.id));

  if (!activeHabits.length) {
    return { reminderDate, currentHour, started: 0, delivered: 0, checkedIn: eligibleCheckedIds.size, expired: 0, attempts: 0, usersNotified: 0, alreadyProcessed: sendableIds.length };
  }

  const activeById = new Map(activeHabits.map(h => [h.id, h]));
  const activeIds = new Set(activeHabits.map(h => h.id));

  // Load existing attempt counts so a resumed delivery cannot exceed 3 attempts per UTC day.
  const { data: deliveryRows, error: deliveryError } = await supabase
    .from('reminder_deliveries')
    .select('habit_id,attempts,status,expires_at')
    .in('habit_id', [...activeIds])
    .eq('reminder_date', reminderDate);
  if (deliveryError) throw deliveryError;

  const attemptsUsed = new Map<string, number>();
  const currentTime = Date.now();

  for (const row of (deliveryRows ?? []) as DeliveryRow[]) {
    attemptsUsed.set(row.habit_id, row.attempts);
    if (row.status !== 'pending' || new Date(row.expires_at).getTime() <= currentTime || row.attempts >= MAX_ATTEMPTS) {
      activeIds.delete(row.habit_id);
    }
  }

  let deliveredCount = 0;
  let checkedInCount = eligibleCheckedIds.size;
  let attemptsMade = 0;
  let webPushAccepted = 0;
  let webSubscriptionsRemoved = 0;
  const successfulUsers = new Set<string>();

  while (activeIds.size) {
    const idsBeforeCheck = [...activeIds];
    const { data: latestCheckins, error: latestCheckinsError } = await supabase
      .from('checkins').select('habit_id').in('habit_id', idsBeforeCheck).eq('checked_at', reminderDate);
    if (latestCheckinsError) throw latestCheckinsError;

    const newlyCheckedIds = new Set(((latestCheckins ?? []) as HabitIdRow[]).map(r => r.habit_id));
    if (newlyCheckedIds.size) {
      const idsToFinish = idsBeforeCheck.filter(id => newlyCheckedIds.has(id));
      const { error } = await supabase.rpc('finish_checked_in_reminders', { p_habit_ids: idsToFinish, p_reminder_date: reminderDate });
      if (error) throw error;
      idsToFinish.forEach(id => activeIds.delete(id));
      checkedInCount += idsToFinish.length;
    }

    if (!activeIds.size) break;

    const requestedIds = [...activeIds].filter(id => (attemptsUsed.get(id) ?? 0) < MAX_ATTEMPTS);
    const { data: claimedRows, error: claimError } = await supabase.rpc('claim_reminder_attempts', {
      p_habit_ids: requestedIds,
      p_reminder_date: reminderDate,
    });
    if (claimError) throw claimError;

    const attemptIds = ((claimedRows ?? []) as HabitIdRow[]).map(r => r.habit_id);
    const attemptSet = new Set(attemptIds);

    for (const id of attemptIds) attemptsUsed.set(id, (attemptsUsed.get(id) ?? 0) + 1);

    const exhaustedIds = [...activeIds].filter(id => !attemptSet.has(id) && (attemptsUsed.get(id) ?? 0) >= MAX_ATTEMPTS);
    if (exhaustedIds.length) {
      const { error } = await supabase.rpc('expire_reminder_deliveries', { p_habit_ids: exhaustedIds, p_reminder_date: reminderDate });
      if (error) throw error;
      exhaustedIds.forEach(id => activeIds.delete(id));
    }

    if (!attemptIds.length) {
      if (activeIds.size) {
        const { error } = await supabase.rpc('expire_reminder_deliveries', { p_habit_ids: [...activeIds], p_reminder_date: reminderDate });
        if (error) throw error;
        activeIds.clear();
      }
      break;
    }

    const byUser = new Map<string, string[]>();
    for (const id of attemptIds) {
      const habit = activeById.get(id);
      if (!habit) continue;
      const list = byUser.get(habit.user_id) ?? [];
      list.push(id);
      byUser.set(habit.user_id, list);
    }

    const messages: ExpoPushMessage[] = [];
    const targets: PushTarget[] = [];
    const webTargets: PushTarget[] = [];

    for (const [userId, userHabitIds] of byUser) {
      const names = userHabitIds.map(id => activeById.get(id)?.name).filter((name): name is string => Boolean(name));
      const { title, body } = reminderText(userHabitIds.length, names);

      const token = validTokens.get(userId);
      if (token) {
        messages.push({ to: token, sound: 'default', title, body, data: { reminderDate, habitIds: userHabitIds } });
        targets.push({ userId, habitIds: userHabitIds });
      }

      if (webSubsByUser.has(userId)) webTargets.push({ userId, habitIds: userHabitIds });
    }

    if (!messages.length && !webTargets.length) {
      console.error('[reminders] No push messages could be built for active habits.');
      break;
    }

    let offset = 0;
    for (const chunk of expo.chunkPushNotifications(messages)) {
      const chunkTargets = targets.slice(offset, offset + chunk.length);
      let tickets;
      try {
        tickets = await expo.sendPushNotificationsAsync(chunk);
      } catch (error) {
        console.error('[reminders] Expo send failed; eligible habits may retry:', error instanceof Error ? error.message : String(error));
        offset += chunk.length;
        continue;
      }

      attemptsMade += tickets.length;

      for (let i = 0; i < tickets.length; i++) {
        const ticket = tickets[i];
        const target = chunkTargets[i];
        if (!target) continue;

        if (ticket.status === 'ok') {
          const deliveredIds = target.habitIds.filter(id => activeIds.has(id));
          if (!deliveredIds.length) continue;

          const { error } = await supabase.rpc('finish_delivered_reminders', {
            p_habit_ids: deliveredIds,
            p_reminder_date: reminderDate,
          });
          if (error) throw error;

          deliveredIds.forEach(id => activeIds.delete(id));
          deliveredCount += deliveredIds.length;
          successfulUsers.add(target.userId);
        } else {
          console.error('[reminders] Expo ticket error:', ticket.message, ticket.details ?? {});
        }
      }
      offset += chunk.length;
    }

    // Web Push (browsers). Runs after the app push so the app path is untouched.
    // A habit counts as delivered if either channel was accepted.
    for (const target of webTargets) {
      const subs = webSubsByUser.get(target.userId) ?? [];
      const names = target.habitIds.map(id => activeById.get(id)?.name).filter((name): name is string => Boolean(name));
      const { title, body } = reminderText(target.habitIds.length, names);
      const payload = { title, body, tag: 'habit-reminder', url: '/', reminderDate, habitIds: target.habitIds };

      const results = await Promise.all(subs.map(sub => sendWebPush(sub, payload)));
      attemptsMade += results.length;

      const goneEndpoints = subs.filter((_, i) => results[i] === 'gone').map(sub => sub.endpoint);
      if (goneEndpoints.length) {
        const { error } = await supabase.from('web_push_subscriptions').delete().in('endpoint', goneEndpoints);
        if (error) console.error('[reminders] Could not remove expired web subscriptions:', error.message);
        else webSubscriptionsRemoved += goneEndpoints.length;
        const remaining = subs.filter(sub => !goneEndpoints.includes(sub.endpoint));
        if (remaining.length) webSubsByUser.set(target.userId, remaining);
        else webSubsByUser.delete(target.userId);
      }

      const accepted = results.filter(r => r === 'accepted').length;
      if (!accepted) continue;
      webPushAccepted += accepted;

      const deliveredIds = target.habitIds.filter(id => activeIds.has(id));
      if (!deliveredIds.length) continue;

      const { error } = await supabase.rpc('finish_delivered_reminders', {
        p_habit_ids: deliveredIds,
        p_reminder_date: reminderDate,
      });
      if (error) throw error;

      deliveredIds.forEach(id => activeIds.delete(id));
      deliveredCount += deliveredIds.length;
      successfulUsers.add(target.userId);
    }

    if (!activeIds.size) break;

    // Retry remaining habits after 5 minutes only if they still have attempts available.
    const canRetry = [...activeIds].some(id => (attemptsUsed.get(id) ?? 0) < MAX_ATTEMPTS);
    if (canRetry) await sleep(RETRY_DELAY_MS);
    else break;
  }

  if (activeIds.size) {
    const finalIds = [...activeIds];
    const { data: finalCheckins, error: finalCheckinsError } = await supabase
      .from('checkins').select('habit_id').in('habit_id', finalIds).eq('checked_at', reminderDate);
    if (finalCheckinsError) throw finalCheckinsError;

    const finalCheckedIds = new Set(((finalCheckins ?? []) as HabitIdRow[]).map(r => r.habit_id));
    if (finalCheckedIds.size) {
      const idsToFinish = finalIds.filter(id => finalCheckedIds.has(id));
      const { error } = await supabase.rpc('finish_checked_in_reminders', { p_habit_ids: idsToFinish, p_reminder_date: reminderDate });
      if (error) throw error;
      idsToFinish.forEach(id => activeIds.delete(id));
      checkedInCount += idsToFinish.length;
    }
  }

  let expiredCount = 0;
  if (activeIds.size) {
    const idsToExpire = [...activeIds];
    const { error } = await supabase.rpc('expire_reminder_deliveries', { p_habit_ids: idsToExpire, p_reminder_date: reminderDate });
    if (error) throw error;
    expiredCount = idsToExpire.length;
    activeIds.clear();
  }

  return {
    reminderDate,
    currentHour,
    started: activeHabits.length,
    delivered: deliveredCount,
    checkedIn: checkedInCount,
    expired: expiredCount,
    attempts: attemptsMade,
    usersNotified: successfulUsers.size,
    webPushAccepted,
    webSubscriptionsRemoved,
    durationSeconds: Math.round((Date.now() - startedAt) / 1000),
  };
}