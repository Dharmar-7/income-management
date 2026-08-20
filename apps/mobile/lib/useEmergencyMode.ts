import AsyncStorage from '@react-native-async-storage/async-storage';
import { useQuery, useQueryClient } from '@tanstack/react-query';

// On-device flag for "Emergency Mode" — a survival view for when income stops.
// When on, the Home dashboard leads with a survival panel (runway + must-cover +
// first-week plan + job leads). Off by default; same AsyncStorage + React Query
// pattern as useJobFinder so a Settings toggle re-renders Home instantly.
const STORAGE_KEY = 'velora-emergency-mode-enabled';
const QUERY_KEY = ['pref', 'emergencyModeEnabled'];

// Non-hook reader for any headless/background context.
export async function isEmergencyModeEnabled(): Promise<boolean> {
  return (await AsyncStorage.getItem(STORAGE_KEY)) === '1';
}

export function useEmergencyMode() {
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
