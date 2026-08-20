import AsyncStorage from '@react-native-async-storage/async-storage';
import { useQuery, useQueryClient } from '@tanstack/react-query';

// Saved job searches live entirely on the device (AsyncStorage), surfaced through
// React Query so the Jobs screen re-renders when the list changes. Each saved
// search also remembers the job IDs seen on its last run, which powers the
// "new since last visit" markers — and, later, the Phase-2 background alerts.
export interface SavedSearch {
  id: string;          // deterministic signature of the params (also the dedupe key)
  label: string;       // human-friendly, built by the screen
  what: string;
  where: string;       // WhereKey
  level: string;       // LevelKey
  salaryMin?: number;
  seenJobIds: string[];
  createdAt: number;
  lastRunAt?: number;
}

const STORAGE_KEY = 'velora-job-searches';
const QUERY_KEY = ['jobSearches'];
const MAX = 12;

// Same params → same id, so re-saving updates rather than duplicating.
export function signatureOf(p: { what: string; where: string; level: string; salaryMin?: number }): string {
  return [p.what.trim().toLowerCase(), p.where, p.level, p.salaryMin ?? ''].join('|');
}

export async function readSavedSearches(): Promise<SavedSearch[]> {
  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as SavedSearch[]) : [];
  } catch {
    return [];
  }
}

// Plain writer used by both the hook and the headless background alerts task.
export async function writeSavedSearches(list: SavedSearch[]): Promise<void> {
  await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(list));
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
