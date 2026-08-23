import * as Notifications from 'expo-notifications';
import Constants from 'expo-constants';
import { Platform } from 'react-native';
import { apiFetch } from './api';

// Foreground display: show pushes as a banner even while the app is open.
// Set at module load so it survives regardless of which screens are mounted.
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
  }),
});

export async function ensureNotificationPermission(): Promise<boolean> {
  try {
    const { status } = await Notifications.getPermissionsAsync();
    if (status === 'granted') return true;
    const req = await Notifications.requestPermissionsAsync();
    return req.status === 'granted';
  } catch {
    return false;
  }
}

// Android 8+ requires a channel for notifications to display (and to show as a
// heads-up banner). Without this, pushes can be silently dropped.
export async function ensureAndroidChannel(): Promise<void> {
  if (Platform.OS !== 'android') return;
  try {
    await Notifications.setNotificationChannelAsync('default', {
      name: 'Alerts',
      importance: Notifications.AndroidImportance.HIGH,
      vibrationPattern: [0, 250, 250, 250],
      lightColor: '#6366f1',
    });
  } catch {
    /* no-op */
  }
}

function resolveProjectId(): string | undefined {
  return (
    (Constants.expoConfig?.extra as { eas?: { projectId?: string } } | undefined)?.eas?.projectId ??
    (Constants as unknown as { easConfig?: { projectId?: string } }).easConfig?.projectId
  );
}

// Register this device's Expo push token with the backend so the server can
// push job matches + the news digest even when the app is fully closed.
// Safe to call repeatedly; no-ops gracefully in Expo Go / simulators / without
// FCM credentials (getExpoPushTokenAsync throws there — we swallow it).
export async function registerPushToken(getToken: () => Promise<string | null>): Promise<boolean> {
  if (Platform.OS === 'web') return false;
  try {
    if (!(await ensureNotificationPermission())) return false;
    await ensureAndroidChannel();

    const projectId = resolveProjectId();
    const resp = await Notifications.getExpoPushTokenAsync(projectId ? { projectId } : undefined);
    const expoToken = resp.data;
    if (!expoToken) return false;

    const auth = await getToken();
    if (!auth) return false;

    await apiFetch('/notifications/register', auth, {
      method: 'POST',
      body: JSON.stringify({ token: expoToken, platform: Platform.OS }),
    });
    return true;
  } catch {
    return false;
  }
}
