import { createClient } from '@supabase/supabase-js';
import { Expo, ExpoPushMessage } from 'expo-server-sdk';

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

const expo = new Expo();

const MAX_ATTEMPTS = 3;
const RETRY_DELAY_MS = 5 * 60 * 1000;
const MAX_WINDOW_MS = 15 * 60 * 1000;

type Habit = {
  id: string;
  user_id: string;
  name: string;
  reminder_hour_utc: number;
};

type PushTarget = {
  userId: string;
  habitIds: string[];
  token: string;
};

type HabitIdRow = {
  habit_id: string;
};

type PushTokenRow = {
  user_id: string;
  expo_push_token: string;
};

const sleep = (ms: number) =>
  new Promise(resolve => setTimeout(resolve, ms));

export async function sendReminders() {
  const startedAt = Date.now();
  const reminderDate = new Date().toISOString().slice(0, 10);
  const currentHour = new Date().getUTCHours();

  const { data: habits, error: habitsError } = await supabase
    .from('habits')
    .select('id,user_id,name,reminder_hour_utc')
    .eq('archived', false)
    .eq('reminder_hour_utc', currentHour);

  if (habitsError) throw habitsError;

  if (!habits?.length) {
    return {
      reminderDate,
      currentHour,
      started: 0,
      delivered: 0,
      checkedIn: 0,
      expired: 0,
      attempts: 0,
      usersNotified: 0,
    };
  }

  const habitList = habits as Habit[];
  const habitIds = habitList.map(habit => habit.id);

  const {
    data: checkins,
    error: checkinsError,
  } = await supabase
    .from('checkins')
    .select('habit_id')
    .in('habit_id', habitIds)
    .eq('checked_at', reminderDate);

  if (checkinsError) throw checkinsError;

  const checkedInIds = new Set<string>();

  for (const row of (checkins ?? []) as HabitIdRow[]) {
    checkedInIds.add(row.habit_id);
  }

  const uncheckedHabits = habitList.filter(
    habit => !checkedInIds.has(habit.id)
  );

  if (!uncheckedHabits.length) {
    return {
      reminderDate,
      currentHour,
      started: 0,
      delivered: 0,
      checkedIn: habitList.length,
      expired: 0,
      attempts: 0,
      usersNotified: 0,
    };
  }

  const { data: tokens, error: tokensError } = await supabase
    .from('push_tokens')
    .select('user_id,expo_push_token')
    .in(
      'user_id',
      [...new Set(uncheckedHabits.map(habit => habit.user_id))]
    );

  if (tokensError) throw tokensError;

  const validTokens = new Map<string, string>();

  for (const row of (tokens ?? []) as PushTokenRow[]) {
    if (Expo.isExpoPushToken(row.expo_push_token)) {
      validTokens.set(row.user_id, row.expo_push_token);
    }
  }

  const sendableHabits = uncheckedHabits.filter(
    habit => validTokens.has(habit.user_id)
  );

  if (!sendableHabits.length) {
    return {
      reminderDate,
      currentHour,
      started: 0,
      delivered: 0,
      checkedIn: checkedInIds.size,
      expired: 0,
      attempts: 0,
      usersNotified: 0,
      skippedNoToken: uncheckedHabits.length,
    };
  }

  const sendableIds = sendableHabits.map(habit => habit.id);

  const {
    data: startedRows,
    error: startError,
  } = await supabase.rpc(
    'start_reminder_deliveries',
    {
      p_habit_ids: sendableIds,
      p_reminder_date: reminderDate,
    }
  );

  if (startError) throw startError;

  const startedIds = new Set<string>();

  for (const row of (startedRows ?? []) as HabitIdRow[]) {
    startedIds.add(row.habit_id);
  }

  const activeHabits = sendableHabits.filter(habit =>
    startedIds.has(habit.id)
  );

  if (!activeHabits.length) {
    return {
      reminderDate,
      currentHour,
      started: 0,
      delivered: 0,
      checkedIn: checkedInIds.size,
      expired: 0,
      attempts: 0,
      usersNotified: 0,
      alreadyProcessed: sendableIds.length,
    };
  }

  const activeById = new Map<string, Habit>();

  for (const habit of activeHabits) {
    activeById.set(habit.id, habit);
  }

  let activeIds = new Set<string>(
    activeHabits.map(habit => habit.id)
  );

  let deliveredCount = 0;
  let checkedInCount = checkedInIds.size;
  let attemptsMade = 0;

  const successfulUsers = new Set<string>();

  for (
    let attempt = 1;
    attempt <= MAX_ATTEMPTS;
    attempt++
  ) {
    const elapsed = Date.now() - startedAt;

    if (
      elapsed >= MAX_WINDOW_MS ||
      activeIds.size === 0
    ) {
      break;
    }

    const currentActiveIds = [...activeIds];

    const {
      data: latestCheckins,
      error: latestCheckinsError,
    } = await supabase
      .from('checkins')
      .select('habit_id')
      .in('habit_id', currentActiveIds)
      .eq('checked_at', reminderDate);

    if (latestCheckinsError) {
      throw latestCheckinsError;
    }

    const newlyCheckedIds = new Set<string>();

    for (
      const row of (latestCheckins ?? []) as HabitIdRow[]
    ) {
      newlyCheckedIds.add(row.habit_id);
    }

    if (newlyCheckedIds.size) {
      const idsToFinish = currentActiveIds.filter(id =>
        newlyCheckedIds.has(id)
      );

      const { error: finishError } = await supabase.rpc(
        'finish_checked_in_reminders',
        {
          p_habit_ids: idsToFinish,
          p_reminder_date: reminderDate,
        }
      );

      if (finishError) throw finishError;

      for (const id of idsToFinish) {
        activeIds.delete(id);
      }

      checkedInCount += idsToFinish.length;
    }

    if (activeIds.size === 0) {
      break;
    }

    const attemptIds = [...activeIds];

    const { error: attemptError } = await supabase.rpc(
      'record_reminder_attempt',
      {
        p_habit_ids: attemptIds,
        p_reminder_date: reminderDate,
      }
    );

    if (attemptError) throw attemptError;

    const byUser = new Map<string, string[]>();

    for (const habitId of attemptIds) {
      const habit = activeById.get(habitId);

      if (!habit) continue;

      const existing = byUser.get(habit.user_id) ?? [];

      existing.push(habitId);

      byUser.set(habit.user_id, existing);
    }

    const messages: ExpoPushMessage[] = [];
    const targets: PushTarget[] = [];

    for (const [userId, userHabitIds] of byUser) {
      const token = validTokens.get(userId);

      if (!token) continue;

      const names: string[] = [];

      for (const habitId of userHabitIds) {
        const name = activeById.get(habitId)?.name;

        if (name) {
          names.push(name);
        }
      }

      messages.push({
        to: token,
        sound: 'default',
        title:
          userHabitIds.length === 1
            ? 'Habit Reminder'
            : 'Habit Reminders',
        body:
          userHabitIds.length === 1
            ? `Time to complete "${names[0]}".`
            : `You have ${userHabitIds.length} habits to complete.`,
        data: {
          reminderDate,
          habitIds: userHabitIds,
        },
      });

      targets.push({
        userId,
        habitIds: userHabitIds,
        token,
      });
    }

    if (!messages.length) {
      break;
    }

    const messageChunks =
      expo.chunkPushNotifications(messages);

    let messageOffset = 0;

    for (const chunk of messageChunks) {
      if (
        Date.now() - startedAt >= MAX_WINDOW_MS ||
        activeIds.size === 0
      ) {
        break;
      }

      const chunkTargets = targets.slice(
        messageOffset,
        messageOffset + chunk.length
      );

      const tickets =
        await expo.sendPushNotificationsAsync(chunk);

      attemptsMade += tickets.length;

      for (let i = 0; i < tickets.length; i++) {
        const ticket = tickets[i];
        const target = chunkTargets[i];

        if (!target) continue;

        if (ticket.status === 'ok') {
          const deliveredIds = target.habitIds.filter(
            id => activeIds.has(id)
          );

          if (deliveredIds.length) {
            const {
              error: deliveredError,
            } = await supabase.rpc(
              'finish_delivered_reminders',
              {
                p_habit_ids: deliveredIds,
                p_reminder_date: reminderDate,
              }
            );

            if (deliveredError) {
              throw deliveredError;
            }

            for (const id of deliveredIds) {
              activeIds.delete(id);
            }

            deliveredCount += deliveredIds.length;
            successfulUsers.add(target.userId);
          }
        }
      }

      messageOffset += chunk.length;
    }

    if (activeIds.size === 0) {
      break;
    }

    if (attempt === MAX_ATTEMPTS) {
      break;
    }

    const remainingWindow =
      MAX_WINDOW_MS - (Date.now() - startedAt);

    if (remainingWindow <= 0) {
      break;
    }

    await sleep(
      Math.min(
        RETRY_DELAY_MS,
        remainingWindow
      )
    );
  }

  if (activeIds.size) {
    const finalIds = [...activeIds];

    const {
      data: finalCheckins,
      error: finalCheckinsError,
    } = await supabase
      .from('checkins')
      .select('habit_id')
      .in('habit_id', finalIds)
      .eq('checked_at', reminderDate);

    if (finalCheckinsError) {
      throw finalCheckinsError;
    }

    const finalCheckedIds = new Set<string>();

    for (
      const row of (finalCheckins ?? []) as HabitIdRow[]
    ) {
      finalCheckedIds.add(row.habit_id);
    }

    if (finalCheckedIds.size) {
      const idsToFinish = finalIds.filter(id =>
        finalCheckedIds.has(id)
      );

      const { error: finishError } = await supabase.rpc(
        'finish_checked_in_reminders',
        {
          p_habit_ids: idsToFinish,
          p_reminder_date: reminderDate,
        }
      );

      if (finishError) throw finishError;

      for (const id of idsToFinish) {
        activeIds.delete(id);
      }

      checkedInCount += idsToFinish.length;
    }
  }

  let expiredCount = 0;

  if (activeIds.size) {
    const idsToExpire = [...activeIds];

    const { error: expireError } = await supabase.rpc(
      'expire_reminder_deliveries',
      {
        p_habit_ids: idsToExpire,
        p_reminder_date: reminderDate,
      }
    );

    if (expireError) throw expireError;

    expiredCount = idsToExpire.length;
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
    durationSeconds: Math.round(
      (Date.now() - startedAt) / 1000
    ),
  };
}