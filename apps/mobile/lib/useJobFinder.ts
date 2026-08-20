import AsyncStorage from '@react-native-async-storage/async-storage';
import { useQuery, useQueryClient } from '@tanstack/react-query';

// Local, on-device feature flag for the opt-in Job Finder. Backed by AsyncStorage
// and surfaced through React Query so a toggle in Settings instantly re-renders
// the tab bar (which conditionally shows the "Jobs" menu entry). Off by default —
// keeps the app uncluttered for anyone who doesn't want it.
const STORAGE_KEY = 'velora-job-finder-enabled';
const QUERY_KEY = ['pref', 'jobFinderEnabled'];

// Non-hook reader for headless contexts (e.g. the background alerts task).
export async function isJobFinderEnabled(): Promise<boolean> {
  return (await AsyncStorage.getItem(STORAGE_KEY)) === '1';
}

export function useJobFinder() {
  const qc = useQueryClient();

  const { data: enabled = false } = useQuery({
    queryKey: QUERY_KEY,
    queryFn: async () => (await AsyncStorage.getItem(STORAGE_KEY)) === '1',
    staleTime: Infinity,
    gcTime: Infinity,
  });

  async function setEnabled(next: boolean) {
    await AsyncStorage.setItem(STORAGE_KEY, next ? '1' : '0');
    qc.setQueryData(QUERY_KEY, next);
  }

  return { enabled, setEnabled };
}
