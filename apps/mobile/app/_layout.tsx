import * as Sentry from '@sentry/react-native';
import { ClerkProvider, useAuth } from '@clerk/clerk-expo';
import { resourceCache } from '@clerk/clerk-expo/resource-cache';
import { tokenCache } from '@/lib/tokenCache';
import { QueryClient, keepPreviousData } from '@tanstack/react-query';
import { PersistQueryClientProvider } from '@tanstack/react-query-persist-client';
import { createAsyncStoragePersister } from '@tanstack/query-async-storage-persister';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Slot, useRouter, useSegments } from 'expo-router';
import { useCallback, useEffect, useRef } from 'react';
import { Platform } from 'react-native';
import * as Notifications from 'expo-notifications';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider, initialWindowMetrics } from 'react-native-safe-area-context';
import { ThemeProvider, useTheme } from '@/context/ThemeContext';
import { apiFetch } from '@/lib/api';
import { registerPushToken } from '@/lib/pushNotifications';

// Crash + error reporting — inert unless EXPO_PUBLIC_SENTRY_DSN is set at
// build time (eas.json env or an EAS secret).
if (process.env.EXPO_PUBLIC_SENTRY_DSN) {
  Sentry.init({
    dsn: process.env.EXPO_PUBLIC_SENTRY_DSN,
    tracesSampleRate: 0.1,
  });
}

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 5 * 60_000,
      // 24h so data survives app restarts via the persisted cache below —
      // the app opens straight to last-known data even with no network.
      gcTime: 24 * 60 * 60_000,
      refetchOnWindowFocus: false,
      retry: 1,
      // Show the previously loaded data instantly while refetching in the
      // background instead of flashing a skeleton on every navigation.
      placeholderData: keepPreviousData,
    },
  },
});

// Persist the query cache to device storage: on launch the last-known data
// hydrates instantly (offline tolerance), then fresh data replaces it when the
// network responds. Individual documents are excluded — their base64 payloads
// (up to ~7 MB each) would blow AsyncStorage's size limits; viewed documents
// get their own file-based cache in the documents screen instead.
const persister = createAsyncStoragePersister({ storage: AsyncStorage, throttleTime: 2_000 });
const persistOptions = {
  persister,
  maxAge: 24 * 60 * 60_000,
  dehydrateOptions: {
    shouldDehydrateQuery: (q: { state: { status: string }; queryKey: readonly unknown[] }) =>
      q.state.status === 'success' && q.queryKey[0] !== 'document',
  },
};

const publishableKey = process.env.EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY!;

function AuthGuard() {
  const { isSignedIn, isLoaded, getToken } = useAuth();
  const segments = useSegments();
  const router = useRouter();
  const synced = useRef(false);

  // Create/sync our DB user as soon as we're signed in. Mobile must do this
  // itself — previously ONLY the web app called POST /users/me, so signing in
  // on mobile against a fresh database left no user row ("User not found" on
  // every request). POST /users/me is an idempotent upsert, so it's safe here.
  useEffect(() => {
    if (!isLoaded || !isSignedIn || synced.current) return;
    synced.current = true;
    getToken().then((token) => {
      if (token) apiFetch('/users/me', token, { method: 'POST' }).catch(() => {});
    });
  }, [isLoaded, isSignedIn, getToken]);

  useEffect(() => {
    if (!isLoaded) return;

    const inAuthGroup = segments[0] === 'sign-in';

    if (!isSignedIn && !inAuthGroup) {
      router.replace('/sign-in');
    } else if (isSignedIn && inAuthGroup) {
      router.replace('/(tabs)');
    }
  }, [isSignedIn, isLoaded, segments]);

  return null;
}

// Registers this device's Expo push token with the backend once signed in, so
// the server can deliver job + news notifications even when the app is closed.
function PushSync() {
  const { isSignedIn, isLoaded, getToken } = useAuth();
  const done = useRef(false);
  useEffect(() => {
    if (!isLoaded || !isSignedIn || done.current) return;
    done.current = true;
    registerPushToken(getToken);
  }, [isLoaded, isSignedIn, getToken]);
  return null;
}

// Routes a tapped notification to the right screen. Without this, tapping any
// push just cold-opens the app at Home. Each push carries a `data` payload
// ({ type, clientId?, term? }) set by the server; we map it to a destination.
function NotificationRouter() {
  const router = useRouter();
  const { isSignedIn, isLoaded } = useAuth();
  // One hook covers both a cold start (the notification that launched the app)
  // and taps while it's running/backgrounded; it updates on each new response.
  const lastResponse = Notifications.useLastNotificationResponse();
  const routedIdRef = useRef<string | null>(null);

  const route = useCallback((data: unknown) => {
    if (!data || typeof data !== 'object') return;
    const d = data as { type?: string; clientId?: string; term?: string };
    const clientId = typeof d.clientId === 'string' ? d.clientId : undefined;
    const term = typeof d.term === 'string' ? d.term : undefined;
    switch (d.type) {
      case 'jobs': // a saved-search alert → open that search
        router.push({ pathname: '/(tabs)/jobs', params: clientId ? { focus: clientId } : {} });
        break;
      case 'watch-jobs': // a watched company/topic → search it
        router.push({ pathname: '/(tabs)/jobs', params: term ? { term } : {} });
        break;
      case 'news':
        router.push('/(tabs)/news');
        break;
      case 'watch-news':
        router.push({ pathname: '/(tabs)/news', params: term ? { q: term } : {} });
        break;
      case 'bills':
        router.push('/(tabs)/recurring');
        break;
      case 'budgets':
        router.push('/(tabs)/budgets');
        break;
      default:
        break;
    }
  }, [router]);

  // Wait until signed in so the destination tab exists; route each response once.
  useEffect(() => {
    if (!isLoaded || !isSignedIn || !lastResponse) return;
    const id = lastResponse.notification.request.identifier;
    if (routedIdRef.current === id) return;
    routedIdRef.current = id;
    route(lastResponse.notification.request.content.data);
  }, [lastResponse, isLoaded, isSignedIn, route]);

  return null;
}

// Drives the OS status-bar text colour from the active theme.
function ThemedStatusBar() {
  const { scheme } = useTheme();
  return <StatusBar style={scheme === 'dark' ? 'light' : 'dark'} />;
}

function RootLayout() {
  return (
    // SafeAreaProvider is REQUIRED: on Expo SDK 54 Android is edge-to-edge, so the
    // app draws under the gesture nav bar. Without this provider every
    // useSafeAreaInsets() returns zeros and bottom content (sheet buttons, tab bar)
    // gets clipped by the nav bar.
    <SafeAreaProvider initialMetrics={initialWindowMetrics}>
      <ThemeProvider>
        <ClerkProvider
          publishableKey={publishableKey}
          tokenCache={Platform.OS === 'web' ? undefined : tokenCache}
          // Persists Clerk's session/user resources so a cold start with no
          // network keeps the user signed in — without this, Clerk's boot-time
          // validation call fails offline and the app falls to the sign-in
          // screen until connectivity returns.
          __experimental_resourceCache={Platform.OS === 'web' ? undefined : resourceCache}
        >
          <PersistQueryClientProvider client={queryClient} persistOptions={persistOptions}>
            <ThemedStatusBar />
            <AuthGuard />
            <PushSync />
            <NotificationRouter />
            <Slot />
          </PersistQueryClientProvider>
        </ClerkProvider>
      </ThemeProvider>
    </SafeAreaProvider>
  );
}

// Sentry.wrap adds touch-event breadcrumbs and catches render errors at the
// root. Harmless no-op when Sentry.init was skipped (no DSN).
export default Sentry.wrap(RootLayout);
