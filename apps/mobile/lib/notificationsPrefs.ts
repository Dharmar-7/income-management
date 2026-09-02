import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@clerk/clerk-expo';
import { apiFetch } from './api';

export interface NotifPrefs {
  notifyJobs: boolean;
  notifyNews: boolean;
  newsCategories: string[]; // subset of ['markets','tech','science']; [] = all
  notifyBills: boolean;
  notifyBudgets: boolean;
  quietOvernight: boolean;
}

const QUERY_KEY = ['notifPrefs'];

export function useNotificationPrefs() {
  const { getToken } = useAuth();
  const qc = useQueryClient();

  const query = useQuery<NotifPrefs>({
    queryKey: QUERY_KEY,
    queryFn: async () => apiFetch<NotifPrefs>('/notifications/prefs', (await getToken())!),
    staleTime: 5 * 60_000,
  });

  // Optimistic: flip the UI immediately, roll back if the save fails.
  async function update(patch: Partial<NotifPrefs>) {
    const prev = qc.getQueryData<NotifPrefs>(QUERY_KEY);
    if (prev) qc.setQueryData(QUERY_KEY, { ...prev, ...patch });
    try {
      const token = await getToken();
      const saved = await apiFetch<NotifPrefs>('/notifications/prefs', token!, {
        method: 'PATCH',
        body: JSON.stringify(patch),
      });
      qc.setQueryData(QUERY_KEY, saved);
    } catch {
      if (prev) qc.setQueryData(QUERY_KEY, prev);
    }
  }

  return { prefs: query.data, loading: query.isLoading, update };
}
