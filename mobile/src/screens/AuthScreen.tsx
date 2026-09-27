import React, { useState } from 'react';
import { View, Text, TextInput, Pressable, StyleSheet, ActivityIndicator, Alert } from 'react-native';
import { supabase } from '../lib/supabase';

export default function AuthScreen() {
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState(false);
  const [loading, setLoading] = useState(false);

  const sendMagicLink = async () => {
    const trimmed = email.trim().toLowerCase();
    if (!trimmed) return;
    setLoading(true);
    const { error } = await supabase.auth.signInWithOtp({ email: trimmed });
    setLoading(false);
    if (error) {
      Alert.alert('Could not send link', error.message);
      return;
    }
    setSent(true);
  };

  if (sent) {
    return (
      <View style={styles.container}>
        <Text style={styles.title}>Check your email</Text>
        <Text style={styles.subtitle}>
          We sent a sign-in link to {email.trim()}. Open it on this device to finish signing in.
        </Text>
        <Pressable onPress={() => setSent(false)} style={styles.linkButton}>
          <Text style={styles.linkButtonText}>Use a different email</Text>
        </Pressable>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Habit Tracker</Text>
      <Text style={styles.subtitle}>Sign in with your email — no password needed.</Text>
      <TextInput
        value={email}
        onChangeText={setEmail}
        placeholder="you@example.com"
        placeholderTextColor="#8A97A6"
        autoCapitalize="none"
        keyboardType="email-address"
        style={styles.input}
      />
      <Pressable onPress={sendMagicLink} disabled={loading || !email.trim()} style={[styles.button, (!email.trim() || loading) && styles.buttonDisabled]}>
        {loading ? <ActivityIndicator color="#FFF" /> : <Text style={styles.buttonText}>Send sign-in link</Text>}
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#FFF', padding: 24, justifyContent: 'center' },
  title: { fontSize: 26, fontWeight: '700', color: '#0B1220', marginBottom: 8 },
  subtitle: { fontSize: 14, color: '#5C6B7A', marginBottom: 24, lineHeight: 20 },
  input: { height: 48, borderWidth: 1, borderColor: '#E5E9EF', borderRadius: 12, paddingHorizontal: 16, fontSize: 15, marginBottom: 16, color: '#0B1220' },
  button: { height: 48, borderRadius: 12, backgroundColor: '#1E56A0', alignItems: 'center', justifyContent: 'center' },
  buttonDisabled: { backgroundColor: '#94A3BB' },
  buttonText: { color: '#FFF', fontSize: 15, fontWeight: '600' },
  linkButton: { marginTop: 20, alignItems: 'center' },
  linkButtonText: { color: '#1E56A0', fontSize: 14, fontWeight: '600' },
});
