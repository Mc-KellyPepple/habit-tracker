import React, { useCallback, useEffect, useState } from 'react';
import { View, Text, Pressable, StyleSheet, FlatList, RefreshControl, ActivityIndicator } from 'react-native';
import { supabase } from '../lib/supabase';
import { utcHourToLocalHour, formatHour } from '../lib/time';

type Habit = { id: string; name: string; reminder_hour_utc: number };

function todayUtcDate(): string {
  return new Date().toISOString().slice(0, 10);
}

export default function HabitsScreen({ onAddHabit }: { onAddHabit: () => void }) {
  const [habits, setHabits] = useState<Habit[]>([]);
  const [checkedInIds, setCheckedInIds] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;

    const [{ data: habitRows }, { data: checkinRows }] = await Promise.all([
      supabase.from('habits').select('id, name, reminder_hour_utc').eq('archived', false).order('created_at', { ascending: true }),
      supabase.from('checkins').select('habit_id').eq('checked_at', todayUtcDate()),
    ]);

    setHabits(habitRows ?? []);
    setCheckedInIds(new Set((checkinRows ?? []).map(c => c.habit_id)));
  }, []);

  useEffect(() => {
    load().finally(() => setLoading(false));
  }, [load]);

  const onRefresh = async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  };

  const checkIn = async (habitId: string) => {
    // Optimistic update — the unique(habit_id, checked_at) constraint means
    // a double-tap just no-ops server-side instead of creating a duplicate.
    setCheckedInIds(prev => new Set(prev).add(habitId));
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;
    const { error } = await supabase.from('checkins').insert({
      habit_id: habitId, user_id: user.id, checked_at: todayUtcDate(),
    });
    if (error && error.code !== '23505') { // 23505 = unique_violation, already checked in — fine
      setCheckedInIds(prev => { const next = new Set(prev); next.delete(habitId); return next; });
    }
  };

  if (loading) {
    return <View style={styles.centered}><ActivityIndicator color="#1E56A0" /></View>;
  }

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.headerTitle}>Today</Text>
        <Pressable onPress={() => supabase.auth.signOut()} hitSlop={8}>
          <Text style={styles.signOut}>Sign out</Text>
        </Pressable>
      </View>

      <FlatList
        data={habits}
        keyExtractor={h => h.id}
        contentContainerStyle={styles.listContent}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
        ListEmptyComponent={
          <View style={styles.emptyState}>
            <Text style={styles.emptyTitle}>No habits yet</Text>
            <Text style={styles.emptySubtitle}>Add one and pick a time you want to be reminded.</Text>
          </View>
        }
        renderItem={({ item }) => {
          const done = checkedInIds.has(item.id);
          return (
            <View style={styles.habitRow}>
              <View style={{ flex: 1 }}>
                <Text style={styles.habitName}>{item.name}</Text>
                <Text style={styles.habitTime}>Reminder at {formatHour(utcHourToLocalHour(item.reminder_hour_utc))}</Text>
              </View>
              <Pressable
                onPress={() => !done && checkIn(item.id)}
                style={[styles.checkButton, done && styles.checkButtonDone]}
              >
                <Text style={[styles.checkButtonText, done && styles.checkButtonTextDone]}>{done ? 'Done ✓' : 'Check in'}</Text>
              </Pressable>
            </View>
          );
        }}
      />

      <Pressable onPress={onAddHabit} style={styles.fab}>
        <Text style={styles.fabText}>+</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#F7F8FA' },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: '#F7F8FA' },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 20, paddingTop: 56, paddingBottom: 16 },
  headerTitle: { fontSize: 26, fontWeight: '700', color: '#0B1220' },
  signOut: { fontSize: 13, color: '#8A97A6' },
  listContent: { paddingHorizontal: 16, paddingBottom: 100 },
  habitRow: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#FFF', borderRadius: 14, padding: 16, marginBottom: 10 },
  habitName: { fontSize: 15, fontWeight: '600', color: '#0B1220' },
  habitTime: { fontSize: 12, color: '#8A97A6', marginTop: 2 },
  checkButton: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: 20, backgroundColor: '#1E56A0' },
  checkButtonDone: { backgroundColor: '#E6F4ED' },
  checkButtonText: { color: '#FFF', fontSize: 12, fontWeight: '700' },
  checkButtonTextDone: { color: '#1E9E6D' },
  emptyState: { alignItems: 'center', paddingTop: 80, paddingHorizontal: 32 },
  emptyTitle: { fontSize: 16, fontWeight: '700', color: '#0B1220', marginBottom: 6 },
  emptySubtitle: { fontSize: 13, color: '#8A97A6', textAlign: 'center' },
  fab: { position: 'absolute', right: 20, bottom: 32, width: 56, height: 56, borderRadius: 28, backgroundColor: '#1E56A0', alignItems: 'center', justifyContent: 'center', elevation: 4, shadowColor: '#000', shadowOpacity: 0.2, shadowRadius: 6, shadowOffset: { width: 0, height: 3 } },
  fabText: { color: '#FFF', fontSize: 28, lineHeight: 30, fontWeight: '400' },
});
