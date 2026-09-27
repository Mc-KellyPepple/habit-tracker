import React, { useEffect, useState } from 'react';
import { View, ActivityIndicator } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { Session } from '@supabase/supabase-js';
import { supabase } from './src/lib/supabase';
import { registerForPushNotificationsAsync } from './src/lib/notifications';
import AuthScreen from './src/screens/AuthScreen';
import HabitsScreen from './src/screens/HabitsScreen';
import AddHabitScreen from './src/screens/AddHabitScreen';

export default function App() {
  const [session, setSession] = useState<Session | null>(null);
  const [loadingSession, setLoadingSession] = useState(true);
  const [showAddHabit, setShowAddHabit] = useState(false);
  const [habitsRefreshKey, setHabitsRefreshKey] = useState(0);

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session);
      setLoadingSession(false);
    });

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, newSession) => {
      setSession(newSession);
      if (newSession) {
        // Fire-and-forget: don't block the UI on notification permission.
        registerForPushNotificationsAsync().catch(err => console.warn('Push registration failed:', err));
      }
    });

    return () => subscription.unsubscribe();
  }, []);

  if (loadingSession) {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: '#FFF' }}>
        <ActivityIndicator color="#1E56A0" />
      </View>
    );
  }

  if (!session) {
    return (
      <>
        <StatusBar style="dark" />
        <AuthScreen />
      </>
    );
  }

  return (
    <>
      <StatusBar style="dark" />
      {showAddHabit ? (
        <AddHabitScreen
          onDone={() => { setShowAddHabit(false); setHabitsRefreshKey(k => k + 1); }}
          onCancel={() => setShowAddHabit(false)}
        />
      ) : (
        <HabitsScreen key={habitsRefreshKey} onAddHabit={() => setShowAddHabit(true)} />
      )}
    </>
  );
}
