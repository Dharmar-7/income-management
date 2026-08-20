import { Injectable, Logger } from '@nestjs/common';
import { SearchJobsDto } from './dto/search-jobs.dto';
import {
  Job,
  normalizeAdzuna, normalizeRemotive, normalizeRemoteOK, normalizeArbeitnow,
  dedupe, sortByDateDesc, inferLevel, matchesKeyword,
} from './jobs.util';

const UA = 'Mozilla/5.0 (compatible; VeloraJobs/1.0)';
const TIMEOUT_MS = 9_000;

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

@Injectable()
export class JobsService {
  private readonly logger = new Logger(JobsService.name);

  // Stateless: this endpoint never touches Prisma/Neon — it's a pure fan-out to
  // the job APIs, merged and returned. So it can't wake the database or need a cron.
  async search(dto: SearchJobsDto): Promise<{ jobs: Job[]; count: number; sources: string[] }> {
    const country = (dto.country || 'in').toLowerCase();
    const remoteOnly = dto.remote === true;

    // Remote-only leans on the three purpose-built remote boards; on-site/worldwide
    // brings in Adzuna for the chosen country.
    const [adzuna, remotive, remoteok, arbeitnow] = await Promise.all([
      remoteOnly ? Promise.resolve<Job[]>([]) : this.fetchAdzuna(dto, country),
      this.fetchRemotive(dto),
      this.fetchRemoteOK(),
      this.fetchArbeitnow(),
    ]);

    // Boards aren't keyword/salary filtered upstream (except Remotive's search),
    // so filter them here. Unknown salaries pass a salaryMin filter rather than
    // being dropped, since most remote boards don't publish pay.
    let boards = [...remotive, ...remoteok, ...arbeitnow].filter(j => matchesKeyword(j, dto.what));
    if (dto.salaryMin) boards = boards.filter(j => j.salaryMin == null || j.salaryMin >= dto.salaryMin!);

    let all = [...adzuna, ...boards];
    if (remoteOnly) all = all.filter(j => j.remote);
    if (dto.level) all = all.filter(j => inferLevel(j.title) === dto.level);

    all = sortByDateDesc(dedupe(all));

    const sources = [...new Set(all.map(j => j.source))];
    const jobs = all.slice(0, 60);
    return { jobs, count: jobs.length, sources };
  }

  private async fetchAdzuna(dto: SearchJobsDto, country: string): Promise<Job[]> {
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

    const data = await getJson(`https://api.adzuna.com/v1/api/jobs/${country}/search/1?${p.toString()}`);
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
}
