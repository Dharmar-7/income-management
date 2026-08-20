import * as TaskManager from 'expo-task-manager';
import * as BackgroundTask from 'expo-background-task';
import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';
import { readSavedSearches, writeSavedSearches } from './jobSearches';
import { fetchBoardJobs } from './jobsClient';
import { isJobFinderEnabled } from './useJobFinder';

// "Best-effort ASAP" job alerts. A background task periodically re-runs the saved
// searches against the keyless remote boards, diffs against each search's
// remembered "seen" ids, and fires a local notification for anything new. It runs
// headless, so it can't reach the authed backend / Adzuna — remote boards only.
// The OS throttles how often it actually runs (Android WorkManager ~15 min floor,
// throttled further by battery/usage), so this is "a few times a day", not instant.
const TASK_NAME = 'velora-job-alerts';
const SEEN_CAP = 300; // keep each search's "seen" list from growing unbounded

// Show alerts even while the app is foregrounded. Matches the events handler
// (identical config; the last registered handler wins), so this is safe.
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
  }),
});

interface Hit { label: string; count: number; sample: string }

// Re-run every saved search, diff vs its "seen" ids, persist the MERGED seen set
// (merge — not replace — so Adzuna ids recorded by the in-app search survive), and
// return what's new. Exported so the logic is reusable/testable on its own.
export async function checkForNewJobs(): Promise<Hit[]> {
  const searches = await readSavedSearches();
  if (!searches.length) return [];

  const hits: Hit[] = [];
  let changed = false;

  for (const s of searches) {
    const results = await fetchBoardJobs({ what: s.what, level: s.level });
    if (!results.length) continue;

    const seen = new Set(s.seenJobIds);
    const fresh = results.filter(j => !seen.has(j.id));
    if (!fresh.length) continue;

    s.seenJobIds = Array.from(new Set([...results.map(j => j.id), ...s.seenJobIds])).slice(0, SEEN_CAP);
    s.lastRunAt = Date.now();
    changed = true;
    hits.push({ label: s.label, count: fresh.length, sample: fresh[0].title });
  }

  if (changed) await writeSavedSearches(searches);
  return hits;
}

async function notify(hits: Hit[]): Promise<void> {
  const total = hits.reduce((n, h) => n + h.count, 0);
  if (total <= 0) return;

  const title = `🆕 ${total} new job${total > 1 ? 's' : ''}`;
  const body =
    hits.length === 1
      ? `${hits[0].label}: ${hits[0].sample}`
      : hits.map(h => `${h.label} (${h.count})`).join(' · ');

  await Notifications.scheduleNotificationAsync({
    identifier: `job-alerts-${Date.now()}`,
    content: { title, body },
    trigger: null, // deliver now
  }).catch(() => {});
}

// Defined at module load so the OS can invoke it even on a cold background launch.
// Guarded off web (expo-task-manager has no real web implementation).
if (Platform.OS !== 'web') {
  TaskManager.defineTask(TASK_NAME, async () => {
    try {
      if (!(await isJobFinderEnabled())) return BackgroundTask.BackgroundTaskResult.Success;
      const hits = await checkForNewJobs();
      if (hits.length) await notify(hits);
      return BackgroundTask.BackgroundTaskResult.Success;
    } catch {
      return BackgroundTask.BackgroundTaskResult.Failed;
    }
  });
}

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

export async function registerJobAlerts(): Promise<void> {
  if (Platform.OS === 'web') return;
  try {
    const status = await BackgroundTask.getStatusAsync();
    if (status === BackgroundTask.BackgroundTaskStatus.Restricted) return; // OS/battery disallows it
    if (await TaskManager.isTaskRegisteredAsync(TASK_NAME)) return;
    // minutes; the OS enforces its own floor (~15 min on Android) and throttles more.
    await BackgroundTask.registerTaskAsync(TASK_NAME, { minimumInterval: 15 });
  } catch {
    // Expo Go / unsupported build — no-op; the feature just won't run in the background.
  }
}

export async function unregisterJobAlerts(): Promise<void> {
  if (Platform.OS === 'web') return;
  try {
    if (await TaskManager.isTaskRegisteredAsync(TASK_NAME)) {
      await BackgroundTask.unregisterTaskAsync(TASK_NAME);
    }
  } catch {
    /* no-op */
  }
}
