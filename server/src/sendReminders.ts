import { Expo, ExpoPushMessage } from 'expo-server-sdk';
import { supabaseAdmin } from './supabaseAdmin';

const expo = new Expo();

type HabitRow = {
  id: string;
  user_id: string;
  name: string;
};

type ClaimRow = {
  habit_id: string;
};

export type ReminderRunResult = {
  hourChecked: number;
  habitsDueThisHour: number;
  habitsAlreadyCheckedIn: number;
  habitsAlreadyReminded: number;
  usersNotified: number;
  pushTicketsSent: number;
  skippedNoToken: number;
  errors: string[];
};

export async function sendReminders(): Promise<ReminderRunResult> {
  const errors: string[] = [];
  const nowUtc = new Date();
  const hour = nowUtc.getUTCHours();
  const todayUtc = nowUtc.toISOString().slice(0, 10);

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
      hourChecked: hour,
      habitsDueThisHour: 0,
      habitsAlreadyCheckedIn: 0,
      habitsAlreadyReminded: 0,
      usersNotified: 0,
      pushTicketsSent: 0,
      skippedNoToken: 0,
      errors,
    };
  }

  const habitIds = habits.map(h => h.id);

  const { data: todaysCheckins, error: checkinsErr } = await supabaseAdmin
    .from('checkins')
    .select('habit_id')
    .in('habit_id', habitIds)
    .eq('checked_at', todayUtc);

  if (checkinsErr) {
    throw new Error(`Failed to load today's check-ins: ${checkinsErr.message}`);
  }

  const checkedInHabitIds = new Set(
    (todaysCheckins ?? []).map(c => c.habit_id)
  );

  const pendingHabits = habits.filter(
    h => !checkedInHabitIds.has(h.id)
  );

  if (pendingHabits.length === 0) {
    return {
      hourChecked: hour,
      habitsDueThisHour: habits.length,
      habitsAlreadyCheckedIn: habits.length,
      habitsAlreadyReminded: 0,
      usersNotified: 0,
      pushTicketsSent: 0,
      skippedNoToken: 0,
      errors,
    };
  }

  const userIds = [...new Set(
    pendingHabits.map(h => h.user_id)
  )];

  const { data: tokenRows, error: tokensErr } = await supabaseAdmin
    .from('push_tokens')
    .select('user_id, expo_push_token')
    .in('user_id', userIds);

  if (tokensErr) {
    throw new Error(`Failed to load push tokens: ${tokensErr.message}`);
  }

  const tokenByUser = new Map(
    (tokenRows ?? []).map(t => [
      t.user_id,
      t.expo_push_token,
    ])
  );

  const sendableHabits: HabitRow[] = [];
  let skippedNoToken = 0;

  for (const habit of pendingHabits) {
    const token = tokenByUser.get(habit.user_id);

    if (!token || !Expo.isExpoPushToken(token)) {
      skippedNoToken++;
      continue;
    }

    sendableHabits.push(habit);
  }

  if (sendableHabits.length === 0) {
    return {
      hourChecked: hour,
      habitsDueThisHour: habits.length,
      habitsAlreadyCheckedIn: checkedInHabitIds.size,
      habitsAlreadyReminded: 0,
      usersNotified: 0,
      pushTicketsSent: 0,
      skippedNoToken,
      errors,
    };
  }

  const { data: claimedRows, error: claimErr } = await supabaseAdmin.rpc(
    'claim_reminder_deliveries',
    {
      p_habit_ids: sendableHabits.map(h => h.id),
      p_reminder_date: todayUtc,
    }
  );

  if (claimErr) {
    throw new Error(
      `Failed to claim reminder deliveries: ${claimErr.message}`
    );
  }

  const claimed = (claimedRows ?? []) as ClaimRow[];
  const claimedIds = new Set(
    claimed.map(row => row.habit_id)
  );

  const alreadyReminded =
    sendableHabits.length - claimed.length;

  const claimedHabits = sendableHabits.filter(
    h => claimedIds.has(h.id)
  );

  if (claimedHabits.length === 0) {
    return {
      hourChecked: hour,
      habitsDueThisHour: habits.length,
      habitsAlreadyCheckedIn: checkedInHabitIds.size,
      habitsAlreadyReminded: alreadyReminded,
      usersNotified: 0,
      pushTicketsSent: 0,
      skippedNoToken,
      errors,
    };
  }

  const habitsByUser = new Map<string, HabitRow[]>();

  for (const habit of claimedHabits) {
    const list = habitsByUser.get(habit.user_id) ?? [];
    list.push(habit);
    habitsByUser.set(habit.user_id, list);
  }

  const messages: ExpoPushMessage[] = [];

  for (const [userId, userHabits] of habitsByUser) {
    const token = tokenByUser.get(userId);

    if (!token || !Expo.isExpoPushToken(token)) {
      continue;
    }

    const habitNames = userHabits.map(h => h.name);
    const habitIds = userHabits.map(h => h.id);

    const title =
      habitNames.length === 1
        ? habitNames[0]
        : `${habitNames.length} habits`;

    const body =
      habitNames.length === 1
        ? "You haven't checked in yet today — tap to mark it done."
        : `Still pending today: ${habitNames.join(', ')}`;

    messages.push({
      to: token,
      sound: 'default',
      title,
      body,
      data: {
        habitNames,
        habitIds,
      },
    });
  }

  let pushTicketsSent = 0;

  for (const chunk of expo.chunkPushNotifications(messages)) {
    try {
      const tickets = await expo.sendPushNotificationsAsync(chunk);

      pushTicketsSent += tickets.length;

      tickets.forEach((ticket, index) => {
        if (ticket.status === 'error') {
          errors.push(
            ticket.message || 'Expo push notification failed'
          );
        }
      });
    } catch (err) {
      errors.push(
        err instanceof Error ? err.message : String(err)
      );
    }
  }

  return {
    hourChecked: hour,
    habitsDueThisHour: habits.length,
    habitsAlreadyCheckedIn: checkedInHabitIds.size,
    habitsAlreadyReminded: alreadyReminded,
    usersNotified: messages.length,
    pushTicketsSent,
    skippedNoToken,
    errors,
  };
}