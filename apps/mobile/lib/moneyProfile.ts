import AsyncStorage from '@react-native-async-storage/async-storage';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { DEFAULT_PROFILE, type MoneyProfile } from './investCoach';

// The user's money profile (age, risk comfort, tax regime, insurance) for the
// Investment Coach. On-device only — same AsyncStorage + React Query pattern as
// the Safety Net prefs, so it never touches the server or Neon.

const PROFILE_KEY = 'velora-money-profile';
const QUERY_KEY = ['pref', 'moneyProfile'];

export function useMoneyProfile() {
  const qc = useQueryClient();

  const { data: profile = DEFAULT_PROFILE, isLoading } = useQuery<MoneyProfile>({
    queryKey: QUERY_KEY,
    queryFn: async () => {
      try {
        const raw = await AsyncStorage.getItem(PROFILE_KEY);
        // Merge over defaults so fields added later get a sensible value.
        return raw ? { ...DEFAULT_PROFILE, ...(JSON.parse(raw) as Partial<MoneyProfile>) } : DEFAULT_PROFILE;
      } catch {
        return DEFAULT_PROFILE;
      }
    },
    staleTime: Infinity,
    gcTime: Infinity,
  });

  async function update(patch: Partial<MoneyProfile>) {
    const current = qc.getQueryData<MoneyProfile>(QUERY_KEY) ?? DEFAULT_PROFILE;
    const next = { ...current, ...patch };
    await AsyncStorage.setItem(PROFILE_KEY, JSON.stringify(next));
    qc.setQueryData(QUERY_KEY, next);
  }

  return { profile, update, loading: isLoading, isSetUp: profile.age != null };
}
