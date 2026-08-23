import AsyncStorage from '@react-native-async-storage/async-storage';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { apiFetch } from './api';

// A "watchlist" of company/topic terms. Each term is followed across BOTH the
// news and the jobs channels: the server checks it against fresh news (twice a
// day) and new job postings (hourly) and pushes matches. Terms live on-device
// (AsyncStorage + React Query) and are mirrored to the server so the crons can
// run even when the app is closed — same pattern as saved job searches.
export interface WatchItem {
  id: string;
  term: string;
  createdAt: number;
}

const STORAGE_KEY = 'velora-watchlist';
const QUERY_KEY = ['watchlist'];
const MAX = 20;

export async function readWatchlist(): Promise<WatchItem[]> {
  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as WatchItem[]) : [];
  } catch {
    return [];
  }
}

// Mirror the terms to the server. Only the params are sent — the server keeps its
// own seen-sets. Upserts by clientId; drops any it no longer receives. Best-effort.
export async function syncWatchlistToServer(list: WatchItem[], token: string): Promise<void> {
  try {
    await apiFetch('/watchlist/sync', token, {
      method: 'POST',
      body: JSON.stringify({ watches: list.map(w => ({ clientId: w.id, term: w.term })) }),
    });
  } catch {
    /* next change re-syncs */
  }
}

export function useWatchlist() {
  const qc = useQueryClient();

  const { data: items = [] } = useQuery({
    queryKey: QUERY_KEY,
    queryFn: readWatchlist,
    staleTime: Infinity,
    gcTime: Infinity,
  });

  const current = () => qc.getQueryData<WatchItem[]>(QUERY_KEY) ?? [];

  async function persist(next: WatchItem[]) {
    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    qc.setQueryData(QUERY_KEY, next);
  }

  // Returns false if the term is blank or already watched (case-insensitive).
  async function add(term: string): Promise<boolean> {
    const t = term.trim();
    if (!t) return false;
    const list = current();
    if (list.some(w => w.term.toLowerCase() === t.toLowerCase())) return false;
    const item: WatchItem = { id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`, term: t, createdAt: Date.now() };
    await persist([item, ...list].slice(0, MAX));
    return true;
  }

  async function remove(id: string) {
    await persist(current().filter(w => w.id !== id));
  }

  const has = (term: string) => items.some(w => w.term.toLowerCase() === term.trim().toLowerCase());

  return { items, add, remove, has };
}
