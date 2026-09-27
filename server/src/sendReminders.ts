import { Expo, ExpoPushMessage } from 'expo-server-sdk';
import { supabaseAdmin } from './supabaseAdmin';

const expo = new Expo();

type HabitRow = {
  id: string;
  user_id: string;
  name: string;
};

export type ReminderRunResult = {
  hourChecked: number;
  habitsDueThisHour: number;
  habitsAlreadyCheckedIn: number;
  usersNotified: number;
  pushTicketsSent: number;
  skippedNoToken: number;
  errors: string[];
};

/**
 * One run = one hour's worth of reminders. Designed to be safe to call
 * repeatedly (an extra call in the same hour just re-checks who's still
 * not checked in — it won't double-remind someone who already has).
 */
export async function sendReminders(): Promise<ReminderRunResult> {
  const errors: string[] = [];
  const nowUtc = new Date();
  const hour = nowUtc.getUTCHours();
  const todayUtc = nowUtc.toISOString().slice(0, 10); // YYYY-MM-DD

  // 1. Habits due this hour.
  const { data: dueHabits, error: habitsErr } = await supabaseAdmin
    .from('habits')
    .select('id, user_id, name')
    .eq('reminder_hour_utc', hour)
    .eq('archived', false);

  if (habitsErr) {
    throw new Error(`Failed to load habits due this hour: ${habitsErr.message}`);
  }
  const habits = (dueHabits ?? []) as HabitRow[];

  if (habits.length === 0) {
    return {
      hourChecked: hour, habitsDueThisHour: 0, habitsAlreadyCheckedIn: 0,
      usersNotified: 0, pushTicketsSent: 0, skippedNoToken: 0, errors,
    };
  }

  // 2. Which of those habits already have today's check-in?
  const habitIds = habits.map(h => h.id);
  const { data: todaysCheckins, error: checkinsErr } = await supabaseAdmin
    .from('checkins')
    .select('habit_id')
    .in('habit_id', habitIds)
    .eq('checked_at', todayUtc);

  if (checkinsErr) {
    throw new Error(`Failed to load today's check-ins: ${checkinsErr.message}`);
  }
  const checkedInHabitIds = new Set((todaysCheckins ?? []).map(c => c.habit_id));

  const pendingHabits = habits.filter(h => !checkedInHabitIds.has(h.id));
  if (pendingHabits.length === 0) {
    return {
      hourChecked: hour, habitsDueThisHour: habits.length,
      habitsAlreadyCheckedIn: habits.length,
      usersNotified: 0, pushTicketsSent: 0, skippedNoToken: 0, errors,
    };
  }

  // 3. Group pending habits by user so each person gets ONE notification,
  // not one per habit.
  const habitsByUser = new Map<string, string[]>();
  for (const h of pendingHabits) {
    const list = habitsByUser.get(h.user_id) ?? [];
    list.push(h.name);
    habitsByUser.set(h.user_id, list);
  }

  // 4. Look up push tokens for exactly those users.
  const userIds = [...habitsByUser.keys()];
  const { data: tokenRows, error: tokensErr } = await supabaseAdmin
    .from('push_tokens')
    .select('user_id, expo_push_token')
    .in('user_id', userIds);

  if (tokensErr) {
    throw new Error(`Failed to load push tokens: ${tokensErr.message}`);
  }
  const tokenByUser = new Map((tokenRows ?? []).map(t => [t.user_id, t.expo_push_token]));

  // 5. Build one Expo push message per user with a valid, registered token.
  const messages: ExpoPushMessage[] = [];
  let skippedNoToken = 0;
  for (const [userId, habitNames] of habitsByUser) {
    const token = tokenByUser.get(userId);
    if (!token || !Expo.isExpoPushToken(token)) {
      skippedNoToken++;
      continue;
    }
    const title = habitNames.length === 1 ? habitNames[0] : `${habitNames.length} habits`;
    const body = habitNames.length === 1
      ? "You haven't checked in yet today — tap to mark it done."
      : `Still pending today: ${habitNames.join(', ')}`;
    messages.push({ to: token, sound: 'default', title, body, data: { habitNames } });
  }

  // 6. Send in chunks (Expo's SDK batches for you; this just makes the
  // batching explicit and lets us count tickets/errors per chunk).
  let pushTicketsSent = 0;
  for (const chunk of expo.chunkPushNotifications(messages)) {
    try {
      const tickets = await expo.sendPushNotificationsAsync(chunk);
      pushTicketsSent += tickets.length;
    } catch (err) {
      errors.push(err instanceof Error ? err.message : String(err));
    }
  }

  return {
    hourChecked: hour,
    habitsDueThisHour: habits.length,
    habitsAlreadyCheckedIn: checkedInHabitIds.size,
    usersNotified: messages.length,
    pushTicketsSent,
    skippedNoToken,
    errors,
  };
}
