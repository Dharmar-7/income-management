import AsyncStorage from '@react-native-async-storage/async-storage';
import { apiFetch, ApiError } from '@/lib/api';
import { readSnapshot, writeSnapshot, type HabitsData, type HabitItem, type HabitStatus } from './snapshot';

// ─────────────────────────────────────────────────────────────────────────────
// Ticking habits straight from the home-screen widget.
//
// A widget runs without the app, so it has no sign-in token and can't call the
// API. Instead a tap updates the widget at once and records the change in a
// small queue on the phone. The next time Velora opens, the queue is sent to
// the server (each entry says the exact day, so a late sync still lands on the
// right date) and the habits board refreshes.
// ─────────────────────────────────────────────────────────────────────────────

export const TOGGLE_HABIT = 'TOGGLE_HABIT';
const QUEUE_KEY = 'velora-widgets-habit-taps';

type Queue = Record<string, 'DONE' | 'NONE'>; // key: `${habitId}|${day}`

export function localIso(d = new Date()): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

function addDays(iso: string, n: number): string {
  const d = new Date(iso + 'T00:00:00');
  d.setDate(d.getDate() + n);
  return localIso(d);
}

// Streak as the widget should show it. The server's streak already counts its
// own tick for the day, so swap that for what the widget shows now.
export function shownStreak(h: HabitItem): number {
  return Math.max(0, h.streak - (h.serverStatus ? 1 : 0) + (h.status ? 1 : 0));
}

// Carry the data over to a new day (the widget can sit untouched overnight):
// ticks reset, and a streak survives only if yesterday was ticked.
export function rollHabits(d: HabitsData, today = localIso()): HabitsData {
  if (d.day === today) return d;
  const fromYesterday = d.day === addDays(today, -1);
  return {
    day: today,
    items: d.items.map(h => ({
      ...h,
      serverStatus: null,
      status: null,
      streak: fromYesterday && h.status ? shownStreak(h) : 0,
    })),
  };
}

// Habits scheduled on the day the data is for, in the user's board order.
export function dueToday(d: HabitsData): HabitItem[] {
  const dow = new Date(d.day + 'T00:00:00').getDay();
  return d.items.filter(h => h.scheduleDays.includes(dow));
}

async function readQueue(): Promise<Queue> {
  try {
    const raw = await AsyncStorage.getItem(QUEUE_KEY);
    if (raw) return JSON.parse(raw) as Queue;
  } catch { /* corrupt → empty */ }
  return {};
}

async function writeQueue(q: Queue): Promise<void> {
  if (Object.keys(q).length === 0) await AsyncStorage.removeItem(QUEUE_KEY);
  else await AsyncStorage.setItem(QUEUE_KEY, JSON.stringify(q));
}

export async function pendingTapCount(): Promise<number> {
  return Object.keys(await readQueue()).length;
}

// Overlay taps that haven't reached the server yet onto freshly loaded data,
// so a refresh never "un-ticks" something the user just ticked on the widget.
export async function applyPendingTaps(d: HabitsData): Promise<HabitsData> {
  const q = await readQueue();
  if (Object.keys(q).length === 0) return d;
  return {
    ...d,
    items: d.items.map(h => {
      const v = q[`${h.id}|${d.day}`];
      return v ? { ...h, status: v === 'DONE' ? 'DONE' : null } : h;
    }),
  };
}

// Widget tap: not done (or half done) → done; done → not done.
export async function toggleHabitTap(id: string): Promise<void> {
  const snap = await readSnapshot();
  if (!snap.habits?.data?.day) return;
  const data = rollHabits(snap.habits.data);
  const item = data.items.find(h => h.id === id);
  if (!item) return;

  const next: HabitStatus = item.status === 'DONE' ? null : 'DONE';
  item.status = next;
  await writeSnapshot({ ...snap, habits: { at: snap.habits.at, data } });

  const q = await readQueue();
  const key = `${id}|${data.day}`;
  if (next === item.serverStatus) delete q[key]; // back to what the server has
  else q[key] = next === 'DONE' ? 'DONE' : 'NONE';
  await writeQueue(q);
}

// Send queued widget taps to the server. Returns how many were saved.
export async function flushHabitTaps(token: string): Promise<number> {
  const q = await readQueue();
  const entries = Object.entries(q);
  if (entries.length === 0) return 0;

  const settled: Queue = {};
  let saved = 0;
  for (const [key, status] of entries) {
    const [id, day] = key.split('|');
    try {
      await apiFetch(`/habits/${id}/checkin`, token, { method: 'POST', body: JSON.stringify({ day, status }) });
      settled[key] = status;
      saved++;
    } catch (e) {
      // 4xx (habit deleted, bad day) will never succeed: drop it. Network or
      // server errors: keep it for the next app open.
      if (e instanceof ApiError && e.status >= 400 && e.status < 500) settled[key] = status;
    }
  }

  // The widget may have been tapped again while we were sending: only drop
  // entries that are unchanged.
  const now = await readQueue();
  for (const [key, status] of Object.entries(settled)) if (now[key] === status) delete now[key];
  await writeQueue(now);
  return saved;
}
