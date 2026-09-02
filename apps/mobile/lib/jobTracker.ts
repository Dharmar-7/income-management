import AsyncStorage from '@react-native-async-storage/async-storage';
import { useQuery, useQueryClient } from '@tanstack/react-query';

// A tiny on-device application tracker: the jobs you've applied to, moving
// through a pipeline (Applied → Interviewing → Offer/Rejected). Stores enough of
// the job to render + reopen it, so it survives the search results scrolling
// away. Same AsyncStorage + React Query pattern as bookmarks — zero-Neon.

export type JobStage = 'applied' | 'interviewing' | 'offer' | 'rejected';

export const STAGES: { key: JobStage; label: string }[] = [
  { key: 'applied', label: 'Applied' },
  { key: 'interviewing', label: 'Interviewing' },
  { key: 'offer', label: 'Offer' },
  { key: 'rejected', label: 'Rejected' },
];

export const stageLabel = (s: JobStage) => STAGES.find(x => x.key === s)?.label ?? s;

export interface TrackedJob {
  id: string;
  title: string;
  company: string;
  location: string;
  url: string;
  source: string;
  salary: string | null;
  stage: JobStage;
  updatedAt: number;
}

// The fields a caller supplies when first tracking a job (stage defaults to applied).
export type TrackInput = Omit<TrackedJob, 'stage' | 'updatedAt'>;

const STORAGE_KEY = 'velora-job-tracker';
const QUERY_KEY = ['jobTracker'];
const CAP = 200;

export function useJobTracker() {
  const qc = useQueryClient();

  const { data: items = [] } = useQuery<TrackedJob[]>({
    queryKey: QUERY_KEY,
    queryFn: async () => {
      try {
        const raw = await AsyncStorage.getItem(STORAGE_KEY);
        return raw ? (JSON.parse(raw) as TrackedJob[]) : [];
      } catch {
        return [];
      }
    },
    staleTime: Infinity,
    gcTime: Infinity,
  });

  const current = () => qc.getQueryData<TrackedJob[]>(QUERY_KEY) ?? [];

  async function persist(next: TrackedJob[]) {
    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    qc.setQueryData(QUERY_KEY, next);
  }

  // Start tracking a job (stage = applied). No-op if already tracked.
  async function track(job: TrackInput) {
    const list = current();
    if (list.some(x => x.id === job.id)) return;
    const entry: TrackedJob = { ...job, stage: 'applied', updatedAt: Date.now() };
    await persist([entry, ...list].slice(0, CAP));
  }

  async function setStage(id: string, stage: JobStage) {
    await persist(current().map(x => (x.id === id ? { ...x, stage, updatedAt: Date.now() } : x)));
  }

  async function remove(id: string) {
    await persist(current().filter(x => x.id !== id));
  }

  const byId = new Map(items.map(j => [j.id, j.stage] as const));
  return { items, stageOf: (id: string) => byId.get(id), track, setStage, remove };
}
