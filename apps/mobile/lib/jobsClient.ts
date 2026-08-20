// Client-side fetch of the KEYLESS remote job boards (Remotive, RemoteOK,
// Arbeitnow). Used by the background alerts task, which runs headless (no React,
// no Clerk session) and therefore can't call our auth-guarded /jobs endpoint or
// reach Adzuna (whose key is server-side). Foreground search still uses the full
// backend aggregator incl. Adzuna — this is only for background diffing.
//
// IMPORTANT: the id scheme here MUST match backend/api/src/jobs/jobs.util.ts, so a
// job "seen" via the in-app (backend) search and the same job seen here are the
// same id — otherwise "new since last visit" would double-count.

export interface BoardJob {
  id: string;
  title: string;
  company: string;
}

export interface BoardQuery {
  what?: string;
  level?: 'senior' | 'mid' | 'junior' | 'any' | string;
}

const UA = 'Mozilla/5.0 (compatible; VeloraJobs/1.0)';
const TIMEOUT_MS = 9_000;

async function getJson(url: string): Promise<any | null> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, { headers: { 'User-Agent': UA, Accept: 'application/json' }, signal: ctrl.signal });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

const SENIOR_RE = /\b(senior|sr\.?|lead|principal|staff|head|director|architect|manager|vp|chief)\b/i;
const JUNIOR_RE = /\b(junior|jr\.?|entry[- ]?level|intern(ship)?|graduate|trainee|apprentice|fresher)\b/i;
function inferLevel(title: string): 'senior' | 'mid' | 'junior' {
  if (SENIOR_RE.test(title)) return 'senior';
  if (JUNIOR_RE.test(title)) return 'junior';
  return 'mid';
}

function matchesKeyword(hay: string, what?: string): boolean {
  const terms = (what ?? '').toLowerCase().split(/\s+/).filter(t => t.length >= 2);
  if (!terms.length) return true;
  const h = hay.toLowerCase();
  return terms.some(t => h.includes(t));
}

async function fetchRemotive(what?: string): Promise<BoardJob[]> {
  const p = new URLSearchParams({ limit: '40' });
  if (what) p.set('search', what);
  const data = await getJson(`https://remotive.com/api/remote-jobs?${p.toString()}`);
  const rows = Array.isArray(data?.jobs) ? data.jobs : [];
  return rows
    .filter((r: any) => r?.url && r?.title)
    .map((r: any) => ({ id: `remotive:${r.id ?? r.url}`, title: String(r.title), company: String(r.company_name ?? 'Unknown') }));
}

async function fetchRemoteOK(): Promise<BoardJob[]> {
  const data = await getJson('https://remoteok.com/api');
  const rows = Array.isArray(data) ? data : [];
  return rows
    .filter((r: any) => r?.position && r?.url)
    .map((r: any) => ({ id: `remoteok:${r.id ?? r.url}`, title: String(r.position), company: String(r.company ?? 'Unknown') }));
}

async function fetchArbeitnow(): Promise<BoardJob[]> {
  const data = await getJson('https://www.arbeitnow.com/api/job-board-api');
  const rows = Array.isArray(data?.data) ? data.data : [];
  return rows
    .filter((r: any) => r?.url && r?.title)
    .map((r: any) => ({ id: `arbeitnow:${r.slug ?? r.url}`, title: String(r.title), company: String(r.company_name ?? 'Unknown') }));
}

// Fetch + filter the remote boards for one saved search. Never throws — a dead
// board just contributes nothing. (Salary isn't filtered here: the boards rarely
// publish pay, so we'd drop almost everything.)
export async function fetchBoardJobs(q: BoardQuery): Promise<BoardJob[]> {
  const batches = await Promise.all([fetchRemotive(q.what), fetchRemoteOK(), fetchArbeitnow()]);

  const seen = new Set<string>();
  const level = q.level && q.level !== 'any' ? q.level : null;

  return batches.flat().filter(j => {
    if (seen.has(j.id)) return false;
    seen.add(j.id);
    if (!matchesKeyword(`${j.title} ${j.company}`, q.what)) return false;
    if (level && inferLevel(j.title) !== level) return false;
    return true;
  });
}
