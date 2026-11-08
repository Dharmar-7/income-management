// Pure, network-free helpers for the /jobs aggregator: normalising each source
// into ONE shape, de-duping, salary formatting, and experience-level inference.
// Kept separate from the service so they're unit-testable without hitting APIs.

export interface Job {
  id: string;
  title: string;
  company: string;
  location: string;
  remote: boolean;
  salary: string | null;      // human-readable range, or null when undisclosed
  salaryMin: number | null;   // for filtering; null when the source omits it
  type: string | null;        // full_time / part_time / contract …
  category: string | null;
  description: string | null; // capped plain-text snippet, for "Check my fit" + card preview
  source: 'Adzuna' | 'Remotive' | 'RemoteOK' | 'Arbeitnow' | 'Jooble' | 'Careerjet' | 'Muse';
  url: string;                // apply / details link
  postedAt: string | null;    // ISO 8601
}

// The full country catalogue (name + Careerjet locale) lives in ./countries.
import { COUNTRY_NAME } from './countries';

// Tolerant date→ISO: several providers return human dates ("Fri, 20 Sep 2024").
function toIso(d?: string | null): string | null {
  if (!d) return null;
  const t = Date.parse(d);
  return Number.isNaN(t) ? null : new Date(t).toISOString();
}

const REMOTE_RE = /\bremote\b|work from home|wfh|telework|flexible/i;

export type Level = 'senior' | 'mid' | 'junior';

// Adzuna is per-country, so show the right currency symbol on its salaries.
const CURRENCY: Record<string, string> = {
  in: '₹', us: '$', gb: '£', au: 'A$', ca: 'C$', nz: 'NZ$', sg: 'S$',
  de: '€', fr: '€', nl: '€', it: '€', es: '€', at: '€', be: '€', ch: 'CHF',
  pl: 'zł', za: 'R', br: 'R$', mx: 'MX$',
};
export function currencyFor(country: string): string {
  return CURRENCY[(country || '').toLowerCase()] ?? '$';
}

export function formatSalary(min?: number | null, max?: number | null, cur = '$'): string | null {
  const lo = min && min > 0 ? min : 0;
  const hi = max && max > 0 ? max : 0;
  const fmt = (n: number) => {
    if (n >= 1_000_000) return `${cur}${(n / 1_000_000).toFixed(1)}M`;
    if (n >= 1000) return `${cur}${Math.round(n / 1000)}k`;
    return `${cur}${Math.round(n)}`;
  };
  if (!lo && !hi) return null;
  if (lo && hi && Math.round(lo) !== Math.round(hi)) return `${fmt(lo)}–${fmt(hi)}`;
  return fmt(lo || hi);
}

const TAG_RE = /<[^>]+>/g;
const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };
export function cleanText(s?: string | null): string {
  if (!s) return '';
  return s
    .replace(TAG_RE, ' ')
    .replace(/&#(\d+);/g, (_, d) => { try { return String.fromCodePoint(+d); } catch { return ''; } })
    .replace(/&([a-zA-Z]+);/g, (m, n) => ENTITIES[n] ?? m)
    .replace(/\s+/g, ' ')
    .trim();
}

// Trim long text (job descriptions) so payloads stay small; null when empty.
export function clip(s: string, n: number): string | null {
  if (!s) return null;
  return s.length > n ? s.slice(0, n) : s;
}

const SENIOR_RE = /\b(senior|sr\.?|lead|principal|staff|head|director|architect|manager|vp|chief)\b/i;
const JUNIOR_RE = /\b(junior|jr\.?|entry[- ]?level|intern(ship)?|graduate|trainee|apprentice|fresher)\b/i;
// Best-effort: no free source reliably tags seniority, so we read it off the title.
export function inferLevel(title: string): Level {
  if (SENIOR_RE.test(title)) return 'senior';
  if (JUNIOR_RE.test(title)) return 'junior';
  return 'mid';
}

// Same role often shows up on more than one board — collapse by title+company.
export function dedupe(jobs: Job[]): Job[] {
  const seen = new Set<string>();
  return jobs.filter(j => {
    const k = `${j.title.toLowerCase().trim()}|${j.company.toLowerCase().trim()}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

export function sortByDateDesc(jobs: Job[]): Job[] {
  const ms = (iso: string | null) => {
    if (!iso) return 0;
    const t = Date.parse(iso);
    return Number.isNaN(t) ? 0 : t;
  };
  return [...jobs].sort((a, b) => ms(b.postedAt) - ms(a.postedAt));
}

// Adzuna is keyword-filtered upstream; the boards return everything, so we match
// their results against the query here. Lenient (any ≥2-char term) so we don't
// drop good hits like "React Engineer" for a "react developer" search.
export function matchesKeyword(job: Job, what?: string): boolean {
  const terms = (what ?? '').toLowerCase().split(/\s+/).filter(t => t.length >= 2);
  if (!terms.length) return true;
  const hay = `${job.title} ${job.category ?? ''} ${job.company}`.toLowerCase();
  return terms.some(t => hay.includes(t));
}

// Company filter: a case-insensitive substring match on the employer name, so
// "google" matches "Google LLC" / "Google India". Blank = no filter.
export function matchesCompany(job: Job, company?: string): boolean {
  const needle = (company ?? '').trim().toLowerCase();
  if (!needle) return true;
  return job.company.toLowerCase().includes(needle);
}

// Job-type filter. The source's own type wins; when a source doesn't disclose a
// type we let the job through (like the salary filter) rather than hide good
// remote listings. Internships are rarely typed, so we also read the title.
export function matchesType(job: Job, type?: string): boolean {
  if (!type) return true;
  const t = (job.type ?? '').toLowerCase().replace(/[\s-]+/g, '_');
  switch (type) {
    case 'full_time':  return t === '' || t.includes('full_time');
    case 'part_time':  return t === '' || t.includes('part_time');
    case 'contract':   return t === '' || /contract|freelance|temporary/.test(t);
    // Freelance & temporary are opt-in "flexible work" filters, so require a real
    // match (in the source type or the title) rather than letting untyped jobs pass.
    case 'freelance':  return /freelance/.test(t) || /\bfreelanc/i.test(job.title);
    case 'temporary':  return /temporary|\btemp\b|seasonal/.test(t) || /\b(temporary|seasonal)\b/i.test(job.title);
    case 'internship': return /intern/.test(t) || /\bintern(ship)?\b/i.test(job.title);
    default:           return true;
  }
}

// ── Per-source normalisers (raw API object → Job); return null to skip junk ──

export function normalizeAdzuna(r: any, country: string): Job | null {
  if (!r?.redirect_url || !r?.title) return null;
  const blob = `${r.title} ${r.location?.display_name ?? ''} ${r.description ?? ''}`;
  return {
    id: `adzuna:${r.id ?? r.redirect_url}`,
    title: cleanText(r.title),
    company: cleanText(r.company?.display_name) || 'Unknown',
    location: cleanText(r.location?.display_name) || country.toUpperCase(),
    remote: /\bremote\b|work from home|wfh/i.test(blob),
    salaryMin: typeof r.salary_min === 'number' ? r.salary_min : null,
    salary: formatSalary(r.salary_min, r.salary_max, currencyFor(country)),
    // contract_time is full_time/part_time; contract_type is contract/permanent.
    // Surface "contract" explicitly so the type filter can honour it.
    type: r.contract_type === 'contract' ? 'contract' : (r.contract_time ?? null),
    category: cleanText(r.category?.label) || null,
    description: clip(cleanText(r.description), 1500),
    source: 'Adzuna',
    url: r.redirect_url,
    postedAt: r.created ?? null,
  };
}

export function normalizeRemotive(r: any): Job | null {
  if (!r?.url || !r?.title) return null;
  return {
    id: `remotive:${r.id ?? r.url}`,
    title: cleanText(r.title),
    company: cleanText(r.company_name) || 'Unknown',
    location: cleanText(r.candidate_required_location) || 'Remote',
    remote: true,
    salaryMin: null,
    salary: cleanText(r.salary) || null,
    type: r.job_type ?? null,
    category: cleanText(r.category) || null,
    description: clip(cleanText(r.description), 1500),
    source: 'Remotive',
    url: r.url,
    postedAt: r.publication_date ?? null,
  };
}

export function normalizeRemoteOK(r: any): Job | null {
  // The feed's first element is a legal/disclaimer object with no `position`.
  if (!r?.position || !r?.url) return null;
  return {
    id: `remoteok:${r.id ?? r.url}`,
    title: cleanText(r.position),
    company: cleanText(r.company) || 'Unknown',
    location: cleanText(r.location) || 'Remote',
    remote: true,
    salaryMin: r.salary_min && r.salary_min > 0 ? r.salary_min : null,
    salary: formatSalary(r.salary_min, r.salary_max, '$'),
    type: null,
    category: Array.isArray(r.tags) ? cleanText(r.tags[0]) || null : null,
    description: clip(cleanText(r.description), 1500),
    source: 'RemoteOK',
    url: r.url,
    postedAt: r.date ?? null,
  };
}

export function normalizeArbeitnow(r: any): Job | null {
  if (!r?.url || !r?.title) return null;
  return {
    id: `arbeitnow:${r.slug ?? r.url}`,
    title: cleanText(r.title),
    company: cleanText(r.company_name) || 'Unknown',
    location: cleanText(r.location) || (r.remote ? 'Remote' : ''),
    remote: !!r.remote,
    salaryMin: null,
    salary: null,
    type: Array.isArray(r.job_types) ? (r.job_types[0] ?? null) : null,
    category: Array.isArray(r.tags) ? cleanText(r.tags[0]) || null : null,
    description: clip(cleanText(r.description), 1500),
    source: 'Arbeitnow',
    url: r.url,
    postedAt: r.created_at ? new Date(r.created_at * 1000).toISOString() : null,
  };
}

// Jooble (POST /api/<key>): worldwide, country-by-country via a `location` name.
// Keyword-filtered upstream, so no local keyword pass is needed.
export function normalizeJooble(r: any): Job | null {
  if (!r?.link || !r?.title) return null;
  const blob = `${r.title} ${r.location ?? ''} ${r.snippet ?? ''}`;
  return {
    id: `jooble:${r.id ?? r.link}`,
    title: cleanText(r.title),
    company: cleanText(r.company) || 'Unknown',
    location: cleanText(r.location) || '',
    remote: REMOTE_RE.test(blob),
    salaryMin: null,
    salary: cleanText(r.salary) || null,
    type: r.type ? cleanText(r.type).toLowerCase().replace(/[\s-]+/g, '_') : null,
    category: null,
    description: clip(cleanText(r.snippet), 1500),
    source: 'Jooble',
    url: r.link,
    postedAt: toIso(r.updated),
  };
}

// Careerjet (GET public API): ~90 countries on-site via a locale + location.
// Keyword-filtered upstream. Its `date` is a human string → toIso().
export function normalizeCareerjet(r: any, country: string): Job | null {
  if (!r?.url || !r?.title) return null;
  const blob = `${r.title} ${r.locations ?? ''} ${r.description ?? ''}`;
  return {
    id: `careerjet:${r.url}`,
    title: cleanText(r.title),
    company: cleanText(r.company) || 'Unknown',
    location: cleanText(r.locations) || (COUNTRY_NAME[country] ?? country.toUpperCase()),
    remote: REMOTE_RE.test(blob),
    // v4 gives a numeric floor + period; only a yearly figure is comparable to our filter.
    salaryMin: r.salary_type === 'Y' && typeof r.salary_min === 'number' && r.salary_min > 0 ? r.salary_min : null,
    salary: cleanText(r.salary) || null,
    type: null,
    category: null,
    description: clip(cleanText(r.description), 1500),
    source: 'Careerjet',
    url: r.url,
    postedAt: toIso(r.date),
  };
}

// The Muse (GET public API): has NO keyword param, so these are keyword-filtered
// locally (like the remote boards). Location filtering is by place name.
export function normalizeMuse(r: any): Job | null {
  const url = r?.refs?.landing_page;
  if (!url || !r?.name) return null;
  const loc = Array.isArray(r.locations) ? r.locations.map((l: any) => cleanText(l?.name)).filter(Boolean).join(', ') : '';
  return {
    id: `muse:${r.id ?? url}`,
    title: cleanText(r.name),
    company: cleanText(r.company?.name) || 'Unknown',
    location: loc,
    remote: REMOTE_RE.test(loc),
    salaryMin: null,
    salary: null,
    type: r.type ? cleanText(r.type).toLowerCase().replace(/[\s-]+/g, '_') : null,
    category: Array.isArray(r.categories) && r.categories.length ? cleanText(r.categories[0]?.name) || null : null,
    description: clip(cleanText(r.contents), 1500),
    source: 'Muse',
    url,
    postedAt: toIso(r.publication_date),
  };
}
