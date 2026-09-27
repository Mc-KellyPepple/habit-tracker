import { Platform } from 'react-native';
import * as Device from 'expo-device';
import * as Notifications from 'expo-notifications';
import { supabase } from './supabase';

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
  }),
});

/**
 * Requests notification permission, grabs this device's Expo push token,
 * and upserts it to `push_tokens` for the currently signed-in user. Call
 * this once right after a successful sign-in (see AuthScreen).
 *
 * Physical device required — the simulator/emulator can't receive real
 * push notifications, and Expo's push service will reject a token from one.
 */
export async function registerForPushNotificationsAsync(): Promise<string | null> {
  if (!Device.isDevice) {
    console.warn('Push notifications require a physical device — skipping on simulator/emulator.');
    return null;
  }

  const { status: existingStatus } = await Notifications.getPermissionsAsync();
  let finalStatus = existingStatus;
  if (existingStatus !== 'granted') {
    const { status } = await Notifications.requestPermissionsAsync();
    finalStatus = status;
  }
  if (finalStatus !== 'granted') {
    console.warn('Notification permission was not granted.');
    return null;
  }

  if (Platform.OS === 'android') {
    await Notifications.setNotificationChannelAsync('default', {
      name: 'default',
      importance: Notifications.AndroidImportance.DEFAULT,
    });
  }

  const { data: { token } } = await Notifications.getExpoPushTokenAsync();

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return token;

  const { error } = await supabase
    .from('push_tokens')
    .upsert({ user_id: user.id, expo_push_token: token, updated_at: new Date().toISOString() });

  if (error) {
    console.warn('Failed to save push token:', error.message);
  }

  return token;
}
