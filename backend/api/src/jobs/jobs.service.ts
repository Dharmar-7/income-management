import { Injectable, Logger } from '@nestjs/common';
import { SearchJobsDto } from './dto/search-jobs.dto';
import {
  Job,
  normalizeAdzuna, normalizeRemotive, normalizeRemoteOK, normalizeArbeitnow,
  normalizeJooble, normalizeCareerjet, normalizeMuse,
  dedupe, sortByDateDesc, inferLevel, matchesKeyword, matchesCompany, matchesType,
} from './jobs.util';
import { COUNTRY_NAME, CAREERJET_LOCALE } from './countries';

const UA = 'Mozilla/5.0 (compatible; VeloraJobs/1.0)';
const TIMEOUT_MS = 9_000;

// The "All locations" option sweeps these major markets (plus the worldwide
// remote boards). Kept to a curated handful — a bigger fan-out would multiply
// external calls and risk the free-tier quotas.
const ALL_COUNTRIES = ['in', 'us', 'gb', 'ca', 'au'];

// Hard cap on how many countries one search fans out over. Each country costs up
// to four provider calls, so this bounds both interactive searches and the hourly
// alert cron against the free-tier quotas. The UI caps selection to match.
const MAX_COUNTRIES = 5;

// Never throws: a failed/slow source just contributes nothing, so the search
// still returns whatever the healthy sources gave.
async function getJson(url: string, headers: Record<string, string> = {}): Promise<any | null> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': UA, Accept: 'application/json', ...headers },
      signal: ctrl.signal,
    });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

// POST variant for providers that take a JSON body (Jooble). Same never-throws
// contract: a failed source just yields null and contributes nothing.
async function postJson(url: string, body: unknown): Promise<any | null> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'User-Agent': UA, 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify(body),
      signal: ctrl.signal,
    });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

@Injectable()
export class JobsService {
  private readonly logger = new Logger(JobsService.name);

  // Stateless: this endpoint never touches Prisma/Neon — it's a pure fan-out to
  // the job APIs, merged and returned. So it can't wake the database or need a cron.
  async search(dto: SearchJobsDto): Promise<{ jobs: Job[]; count: number; sources: string[] }> {
    const remoteOnly = dto.remote === true;
    const page = dto.page && dto.page > 1 ? dto.page : 1;

    // The remote boards aren't paginated, so only fetch them on the first page;
    // "load more" (page>1) pulls the next page of the country providers instead.
    const withBoards = page === 1;

    // When filtering by company, fold the name into the keyword so providers
    // surface that employer's postings upstream (none has a free company param);
    // we still hard-filter by company after merging. Role matching for the remote
    // boards stays on `what` alone so the role filter isn't loosened.
    const adzunaWhat = [dto.what, dto.company].map(s => s?.trim()).filter(Boolean).join(' ') || undefined;
    const countryDto = { ...dto, what: adzunaWhat };

    // Resolve which countries to search. Remote-only → none (boards cover it).
    // 'all' → the curated major markets. Otherwise a comma-separated list from the
    // picker, deduped and capped so the fan-out can't blow the free-tier quotas.
    const raw = (dto.country || 'in').toLowerCase();
    let countries: string[];
    if (remoteOnly) countries = [];
    else if (raw === 'all') countries = ALL_COUNTRIES;
    else countries = [...new Set(raw.split(',').map(s => s.trim()).filter(Boolean))].slice(0, MAX_COUNTRIES);

    // The worldwide remote boards run once per search (page 1), independent of country.
    const [remotive, remoteok, arbeitnow] = await Promise.all([
      withBoards ? this.fetchRemotive(dto) : Promise.resolve<Job[]>([]),
      withBoards ? this.fetchRemoteOK() : Promise.resolve<Job[]>([]),
      withBoards ? this.fetchArbeitnow() : Promise.resolve<Job[]>([]),
    ]);

    // Per selected country: Adzuna (all pages) + Jooble/Careerjet/The Muse (page 1
    // only). Each provider no-ops when its key/affiliate id is unset, so this is
    // safe to always call. Jooble & Careerjet are keyword-filtered upstream (like
    // Adzuna); The Muse has no keyword param, so it joins the locally-filtered bucket.
    const perCountry = await Promise.all(countries.map(async cc => {
      const [adz, joo, car, mus] = await Promise.all([
        this.fetchAdzuna(countryDto, cc, page),
        withBoards ? this.fetchJooble(countryDto, cc) : Promise.resolve<Job[]>([]),
        withBoards ? this.fetchCareerjet(countryDto, cc, page) : Promise.resolve<Job[]>([]),
        withBoards ? this.fetchMuse(cc) : Promise.resolve<Job[]>([]),
      ]);
      return { prefiltered: [...adz, ...joo, ...car], muse: mus };
    }));
    const countryPrefiltered = perCountry.flatMap(p => p.prefiltered);
    const museJobs = perCountry.flatMap(p => p.muse);

    // Boards + The Muse aren't keyword/salary filtered upstream, so filter here.
    // Unknown salaries pass a salaryMin filter rather than being dropped, since
    // most of these don't publish pay.
    let boards = [...remotive, ...remoteok, ...arbeitnow, ...museJobs].filter(j => matchesKeyword(j, dto.what));
    if (dto.salaryMin) boards = boards.filter(j => j.salaryMin == null || j.salaryMin >= dto.salaryMin!);

    let all = [...countryPrefiltered, ...boards];
    if (remoteOnly) all = all.filter(j => j.remote);
    if (dto.level) all = all.filter(j => inferLevel(j.title) === dto.level);
    if (dto.company) all = all.filter(j => matchesCompany(j, dto.company));
    if (dto.type) all = all.filter(j => matchesType(j, dto.type));

    all = sortByDateDesc(dedupe(all));

    const sources = [...new Set(all.map(j => j.source))];
    const jobs = all.slice(0, 60);
    return { jobs, count: jobs.length, sources };
  }

  private async fetchAdzuna(dto: SearchJobsDto, country: string, page = 1): Promise<Job[]> {
    const id = process.env.ADZUNA_APP_ID;
    const key = process.env.ADZUNA_APP_KEY;
    if (!id || !key) {
      // Not fatal: without a key we simply skip Adzuna and serve the remote boards.
      this.logger.warn('ADZUNA_APP_ID/ADZUNA_APP_KEY not set — skipping Adzuna source.');
      return [];
    }
    const p = new URLSearchParams({
      app_id: id, app_key: key, results_per_page: '30', 'content-type': 'application/json',
    });
    if (dto.what) p.set('what', dto.what);
    if (dto.where) p.set('where', dto.where);
    if (dto.salaryMin) p.set('salary_min', String(dto.salaryMin));
    if (dto.sortByDate) p.set('sort_by', 'date');
    // Adzuna exposes these as boolean flags; internship has no flag (post-filtered).
    if (dto.type === 'full_time') p.set('full_time', '1');
    else if (dto.type === 'part_time') p.set('part_time', '1');
    else if (dto.type === 'contract') p.set('contract', '1');

    const data = await getJson(`https://api.adzuna.com/v1/api/jobs/${country}/search/${page}?${p.toString()}`);
    const results = Array.isArray(data?.results) ? data.results : [];
    return results.map((r: any) => normalizeAdzuna(r, country)).filter(Boolean) as Job[];
  }

  private async fetchRemotive(dto: SearchJobsDto): Promise<Job[]> {
    const p = new URLSearchParams({ limit: '40' });
    if (dto.what) p.set('search', dto.what);
    const data = await getJson(`https://remotive.com/api/remote-jobs?${p.toString()}`);
    const results = Array.isArray(data?.jobs) ? data.jobs : [];
    return results.map(normalizeRemotive).filter(Boolean) as Job[];
  }

  private async fetchRemoteOK(): Promise<Job[]> {
    const data = await getJson('https://remoteok.com/api');
    const results = Array.isArray(data) ? data : [];
    return results.map(normalizeRemoteOK).filter(Boolean) as Job[];
  }

  private async fetchArbeitnow(): Promise<Job[]> {
    const data = await getJson('https://www.arbeitnow.com/api/job-board-api');
    const results = Array.isArray(data?.data) ? data.data : [];
    return results.map(normalizeArbeitnow).filter(Boolean) as Job[];
  }

  // Jooble — POST to /api/<key> with keywords + a country name. Skips cleanly
  // when JOOBLE_API_KEY is unset.
  private async fetchJooble(dto: SearchJobsDto, country: string): Promise<Job[]> {
    const key = process.env.JOOBLE_API_KEY;
    if (!key) return [];
    const data = await postJson(`https://jooble.org/api/${key}`, {
      keywords: dto.what ?? '',
      location: COUNTRY_NAME[country] ?? '',
    });
    const results = Array.isArray(data?.jobs) ? data.jobs : [];
    return results.map(normalizeJooble).filter(Boolean) as Job[];
  }

  // Careerjet — v4 API: HTTP Basic auth with the publisher API key as the username
  // and an empty password. The locale picks the country, so we omit `location`
  // (a country-wide search) — passing a place name can instead return location
  // suggestions (type 'LOCATIONS'), which we ignore. user_ip/user_agent are
  // required. Skips when the key is unset.
  private async fetchCareerjet(dto: SearchJobsDto, country: string, page = 1): Promise<Job[]> {
    const key = process.env.CAREERJET_API_KEY;
    if (!key) return [];
    const p = new URLSearchParams({
      keywords: dto.what ?? '',
      locale_code: CAREERJET_LOCALE[country] ?? 'en_GB',
      page_size: '30',
      page: String(Math.min(page, 10)), // v4 accepts pages 1–10
      sort: dto.sortByDate ? 'date' : 'relevance',
      user_ip: '203.0.113.1',
      user_agent: UA,
    });
    const auth = Buffer.from(`${key}:`).toString('base64');
    const data = await getJson(`https://search.api.careerjet.net/v4/query?${p.toString()}`, {
      Authorization: `Basic ${auth}`,
    });
    if (data?.type !== 'JOBS' || !Array.isArray(data?.jobs)) return [];
    return data.jobs.map((r: any) => normalizeCareerjet(r, country)).filter(Boolean) as Job[];
  }

  // The Muse — GET public API, filtered by a location name. Has no keyword param
  // (we match keywords locally). MUSE_API_KEY is optional (raises rate limits).
  private async fetchMuse(country: string): Promise<Job[]> {
    const p = new URLSearchParams({ page: '1' });
    if (process.env.MUSE_API_KEY) p.set('api_key', process.env.MUSE_API_KEY);
    const loc = COUNTRY_NAME[country];
    if (loc) p.set('location', loc);
    const data = await getJson(`https://www.themuse.com/api/public/jobs?${p.toString()}`);
    const results = Array.isArray(data?.results) ? data.results : [];
    return results.map(normalizeMuse).filter(Boolean) as Job[];
  }
}
