import AsyncStorage from '@react-native-async-storage/async-storage';
import { useQuery, useQueryClient } from '@tanstack/react-query';

// On-device per-job status for a real job hunt: mark a listing "Applied" (shows a
// badge and stays visible) or "Hidden" (removed from results until you unhide).
// A plain id → status map in AsyncStorage, surfaced through React Query so the
// Jobs screen re-renders instantly. Zero-Neon, offline-friendly.

export type JobStatus = 'applied' | 'hidden';

const STORAGE_KEY = 'velora-job-status';
const QUERY_KEY = ['jobStatus'];

type StatusMap = Record<string, JobStatus>;

export function useJobStatus() {
  const qc = useQueryClient();

  const { data: map = {} } = useQuery<StatusMap>({
    queryKey: QUERY_KEY,
    queryFn: async () => {
      try {
        const raw = await AsyncStorage.getItem(STORAGE_KEY);
        return raw ? (JSON.parse(raw) as StatusMap) : {};
      } catch {
        return {};
      }
    },
    staleTime: Infinity,
    gcTime: Infinity,
  });

  const current = () => qc.getQueryData<StatusMap>(QUERY_KEY) ?? {};

  async function persist(next: StatusMap) {
    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    qc.setQueryData(QUERY_KEY, next);
  }

  // Set a status, or clear it when the same status is toggled again.
  async function setStatus(id: string, status: JobStatus) {
    const next = { ...current() };
    if (next[id] === status) delete next[id];
    else next[id] = status;
    await persist(next);
  }

  async function clear(id: string) {
    const next = { ...current() };
    delete next[id];
    await persist(next);
  }

  const hiddenCount = Object.values(map).filter(s => s === 'hidden').length;

  return { map, statusOf: (id: string) => map[id], setStatus, clear, hiddenCount };
}
