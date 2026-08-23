import AsyncStorage from '@react-native-async-storage/async-storage';
import { useQuery, useQueryClient } from '@tanstack/react-query';

// On-device bookmarks — saved jobs and saved news articles. Same AsyncStorage +
// React Query pattern used across the app (zero-Neon, works offline, re-renders
// every screen that reads the store the moment it changes). Newest-saved first;
// capped so the list can't grow unbounded.

const CAP = 200;

export interface SavedJob {
  id: string;
  title: string;
  company: string;
  location: string;
  remote: boolean;
  salary: string | null;
  type: string | null;
  source: string;
  url: string;
  description: string | null;
  postedAt: string | null;
  savedAt: number;
}

export interface SavedArticle {
  id: string;
  title: string;
  summary: string;
  link: string;
  source: string;
  published: number | null;
  savedAt: number;
}

function useBookmarkStore<T extends { id: string; savedAt: number }>(storageKey: string, queryKey: string[]) {
  const qc = useQueryClient();

  const { data: items = [] } = useQuery<T[]>({
    queryKey,
    queryFn: async () => {
      try {
        const raw = await AsyncStorage.getItem(storageKey);
        return raw ? (JSON.parse(raw) as T[]) : [];
      } catch {
        return [];
      }
    },
    staleTime: Infinity,
    gcTime: Infinity,
  });

  const current = () => qc.getQueryData<T[]>(queryKey) ?? [];

  async function persist(next: T[]) {
    await AsyncStorage.setItem(storageKey, JSON.stringify(next));
    qc.setQueryData(queryKey, next);
  }

  // Add if absent, remove if present. `item` omits savedAt — we stamp it here.
  async function toggle(item: Omit<T, 'savedAt'>) {
    const list = current();
    if (list.some(x => x.id === item.id)) {
      await persist(list.filter(x => x.id !== item.id));
    } else {
      await persist([{ ...item, savedAt: Date.now() } as T, ...list].slice(0, CAP));
    }
  }

  async function remove(id: string) {
    await persist(current().filter(x => x.id !== id));
  }

  const ids = new Set(items.map(i => i.id));
  return { items, isSaved: (id: string) => ids.has(id), toggle, remove };
}

export function useSavedJobs() {
  return useBookmarkStore<SavedJob>('velora-saved-jobs', ['savedJobs']);
}

export function useSavedArticles() {
  return useBookmarkStore<SavedArticle>('velora-saved-articles', ['savedArticles']);
}
