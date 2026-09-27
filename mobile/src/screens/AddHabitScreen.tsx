import React, { useState } from 'react';
import { View, Text, TextInput, Pressable, StyleSheet, ScrollView, Alert, ActivityIndicator } from 'react-native';
import { supabase } from '../lib/supabase';
import { localHourToUtcHour, formatHour } from '../lib/time';

const HOUR_OPTIONS = [6, 7, 8, 9, 12, 17, 18, 19, 20, 21];

export default function AddHabitScreen({ onDone, onCancel }: { onDone: () => void; onCancel: () => void }) {
  const [name, setName] = useState('');
  const [localHour, setLocalHour] = useState(9);
  const [saving, setSaving] = useState(false);

  const save = async () => {
    const trimmed = name.trim();
    if (!trimmed) return;
    setSaving(true);
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) { setSaving(false); return; }

    const { error } = await supabase.from('habits').insert({
      user_id: user.id,
      name: trimmed,
      reminder_hour_utc: localHourToUtcHour(localHour),
    });
    setSaving(false);
    if (error) {
      Alert.alert('Could not save habit', error.message);
      return;
    }
    onDone();
  };

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Pressable onPress={onCancel} hitSlop={8}><Text style={styles.cancel}>Cancel</Text></Pressable>
        <Text style={styles.headerTitle}>New Habit</Text>
        <View style={{ width: 50 }} />
      </View>
      <ScrollView contentContainerStyle={styles.content}>
        <Text style={styles.label}>What habit?</Text>
        <TextInput
          value={name}
          onChangeText={setName}
          placeholder="e.g. Drink water, Read 10 pages"
          placeholderTextColor="#8A97A6"
          style={styles.input}
        />

        <Text style={styles.label}>Remind me at</Text>
        <View style={styles.hourGrid}>
          {HOUR_OPTIONS.map(h => (
            <Pressable
              key={h}
              onPress={() => setLocalHour(h)}
              style={[styles.hourChip, localHour === h && styles.hourChipActive]}
            >
              <Text style={[styles.hourChipText, localHour === h && styles.hourChipTextActive]}>{formatHour(h)}</Text>
            </Pressable>
          ))}
        </View>

        <Pressable onPress={save} disabled={saving || !name.trim()} style={[styles.saveButton, (!name.trim() || saving) && styles.saveButtonDisabled]}>
          {saving ? <ActivityIndicator color="#FFF" /> : <Text style={styles.saveButtonText}>Save Habit</Text>}
        </Pressable>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#F7F8FA' },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingTop: 56, paddingBottom: 16, backgroundColor: '#FFF', borderBottomWidth: 1, borderBottomColor: '#EEF1F4' },
  cancel: { color: '#1E56A0', fontSize: 15, width: 50 },
  headerTitle: { fontSize: 16, fontWeight: '700', color: '#0B1220' },
  content: { padding: 16 },
  label: { fontSize: 13, fontWeight: '600', color: '#5C6B7A', marginBottom: 8, marginTop: 16 },
  input: { height: 48, borderWidth: 1, borderColor: '#E5E9EF', borderRadius: 12, paddingHorizontal: 16, fontSize: 15, backgroundColor: '#FFF', color: '#0B1220' },
  hourGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  hourChip: { paddingHorizontal: 14, paddingVertical: 10, borderRadius: 20, backgroundColor: '#FFF', borderWidth: 1, borderColor: '#E5E9EF' },
  hourChipActive: { backgroundColor: '#1E56A0', borderColor: '#1E56A0' },
  hourChipText: { fontSize: 13, color: '#0B1220', fontWeight: '600' },
  hourChipTextActive: { color: '#FFF' },
  saveButton: { height: 48, borderRadius: 12, backgroundColor: '#1E56A0', alignItems: 'center', justifyContent: 'center', marginTop: 28 },
  saveButtonDisabled: { backgroundColor: '#94A3BB' },
  saveButtonText: { color: '#FFF', fontSize: 15, fontWeight: '600' },
});
