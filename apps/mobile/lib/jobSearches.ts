import AsyncStorage from '@react-native-async-storage/async-storage';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { apiFetch } from './api';

// Saved job searches live on the device (AsyncStorage), surfaced through React
// Query so the Jobs screen re-renders when the list changes. Each remembers the
// job IDs seen on its last run (for the "new since last visit" markers). They're
// also mirrored to the server (syncSearchesToServer) so the hourly alert cron
// can push new matches even when the app is closed.
export interface SavedSearch {
  id: string;          // deterministic signature of the params (also the dedupe key)
  label: string;       // human-friendly, built by the screen
  what: string;
  company?: string;    // employer filter
  where: string;       // WhereKey
  level: string;       // LevelKey
  type?: string;       // TypeKey (full_time | part_time | contract | internship)
  salaryMin?: number;
  seenJobIds: string[];
  createdAt: number;
  lastRunAt?: number;
}

const STORAGE_KEY = 'velora-job-searches';
const QUERY_KEY = ['jobSearches'];
const MAX = 12;

// Same params → same id, so re-saving updates rather than duplicating.
export function signatureOf(p: { what: string; company?: string; where: string; level: string; type?: string; salaryMin?: number }): string {
  return [p.what.trim().toLowerCase(), (p.company ?? '').trim().toLowerCase(), p.where, p.level, p.type ?? '', p.salaryMin ?? ''].join('|');
}

export async function readSavedSearches(): Promise<SavedSearch[]> {
  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as SavedSearch[]) : [];
  } catch {
    return [];
  }
}

export async function writeSavedSearches(list: SavedSearch[]): Promise<void> {
  await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(list));
}

// Mirror the saved searches to the server so the hourly alert cron can re-run
// them. Only the params are sent — the server keeps its own "seen" set. The
// server upserts by clientId and drops any it no longer receives. Best-effort.
export async function syncSearchesToServer(list: SavedSearch[], token: string): Promise<void> {
  try {
    await apiFetch('/jobs/searches/sync', token, {
      method: 'POST',
      body: JSON.stringify({
        searches: list.map(s => ({
          clientId: s.id, label: s.label, what: s.what, company: s.company,
          where: s.where, level: s.level, type: s.type, salaryMin: s.salaryMin,
        })),
      }),
    });
  } catch {
    /* next change re-syncs */
  }
}

export function useJobSearches() {
  const qc = useQueryClient();

  const { data: searches = [] } = useQuery({
    queryKey: QUERY_KEY,
    queryFn: readSavedSearches,
    staleTime: Infinity,
    gcTime: Infinity,
  });

  const current = () => qc.getQueryData<SavedSearch[]>(QUERY_KEY) ?? [];

  async function persist(next: SavedSearch[]) {
    await writeSavedSearches(next);
    qc.setQueryData(QUERY_KEY, next);
  }

  async function add(s: SavedSearch) {
    const list = current();
    const existing = list.find(x => x.id === s.id);
    // Preserve the existing "seen" history unless the caller seeds a fresh one.
    const merged: SavedSearch = existing
      ? { ...existing, ...s, seenJobIds: s.seenJobIds.length ? s.seenJobIds : existing.seenJobIds }
      : s;
    await persist([merged, ...list.filter(x => x.id !== s.id)].slice(0, MAX));
  }

  async function remove(id: string) {
    await persist(current().filter(x => x.id !== id));
  }

  async function markSeen(id: string, jobIds: string[]) {
    const list = current();
    if (!list.some(x => x.id === id)) return;
    await persist(list.map(x => (x.id === id ? { ...x, seenJobIds: jobIds, lastRunAt: Date.now() } : x)));
  }

  return { searches, add, remove, markSeen };
}
