import {
  formatSalary, inferLevel, dedupe, sortByDateDesc, matchesKeyword, matchesCompany, matchesType,
  normalizeAdzuna, normalizeRemoteOK, normalizeArbeitnow,
  normalizeJooble, normalizeCareerjet, normalizeMuse, cleanText, Job,
} from './jobs.util';

const mk = (over: Partial<Job>): Job => ({
  id: 'x', title: 'X', company: 'c', location: '', remote: false,
  salary: null, salaryMin: null, type: null, category: null, description: null, source: 'Adzuna', url: 'u', postedAt: null,
  ...over,
});

describe('jobs.util', () => {
  describe('formatSalary', () => {
    it('formats a k-range with the currency', () => {
      expect(formatSalary(80000, 120000, '$')).toBe('$80k–$120k');
    });
    it('uses M for millions (₹20L-style pay)', () => {
      expect(formatSalary(2_000_000, 3_000_000, '₹')).toBe('₹2.0M–₹3.0M');
    });
    it('collapses equal min/max to one value', () => {
      expect(formatSalary(123717, 123717, 'A$')).toBe('A$124k');
    });
    it('treats 0 / undefined as undisclosed → null', () => {
      expect(formatSalary(0, 0)).toBeNull();
      expect(formatSalary(null, null)).toBeNull();
    });
  });

  describe('inferLevel', () => {
    it('detects senior signals', () => {
      expect(inferLevel('Senior React Developer')).toBe('senior');
      expect(inferLevel('Lead Data Engineer')).toBe('senior');
    });
    it('detects junior signals', () => {
      expect(inferLevel('Graduate Software Engineer')).toBe('junior');
      expect(inferLevel('Data Analyst Intern')).toBe('junior');
    });
    it('defaults to mid', () => {
      expect(inferLevel('Software Engineer')).toBe('mid');
    });
  });

  describe('dedupe', () => {
    it('collapses same title+company across sources', () => {
      const out = dedupe([
        mk({ id: '1', title: 'React Dev', company: 'Acme', source: 'Adzuna' }),
        mk({ id: '2', title: 'react dev', company: 'ACME', source: 'RemoteOK' }),
        mk({ id: '3', title: 'React Dev', company: 'Other', source: 'Remotive' }),
      ]);
      expect(out).toHaveLength(2);
    });
  });

  describe('matchesKeyword', () => {
    const job = mk({ title: 'React Engineer', category: 'Software Dev', company: 'Acme' });
    it('matches when any term hits (lenient)', () => {
      expect(matchesKeyword(job, 'react developer')).toBe(true);
    });
    it('passes everything when the query is empty', () => {
      expect(matchesKeyword(job, '')).toBe(true);
    });
    it('rejects when no term matches', () => {
      expect(matchesKeyword(job, 'plumber welder')).toBe(false);
    });
  });

  describe('matchesCompany', () => {
    const job = mk({ company: 'Google India' });
    it('matches on a case-insensitive substring of the employer', () => {
      expect(matchesCompany(job, 'google')).toBe(true);
      expect(matchesCompany(job, 'India')).toBe(true);
    });
    it('passes everything when no company is given', () => {
      expect(matchesCompany(job, '')).toBe(true);
      expect(matchesCompany(job, '   ')).toBe(true);
    });
    it('rejects a different employer', () => {
      expect(matchesCompany(job, 'microsoft')).toBe(false);
    });
  });

  describe('matchesType', () => {
    it('matches the declared type', () => {
      expect(matchesType(mk({ type: 'full_time' }), 'full_time')).toBe(true);
      expect(matchesType(mk({ type: 'part_time' }), 'part_time')).toBe(true);
      expect(matchesType(mk({ type: 'freelance' }), 'contract')).toBe(true);
    });
    it('lets undisclosed types through (like the salary filter)', () => {
      expect(matchesType(mk({ type: null }), 'full_time')).toBe(true);
    });
    it('rejects a mismatched declared type', () => {
      expect(matchesType(mk({ type: 'full_time' }), 'part_time')).toBe(false);
    });
    it('finds internships by title even when untyped', () => {
      expect(matchesType(mk({ title: 'Software Engineering Intern', type: null }), 'internship')).toBe(true);
      expect(matchesType(mk({ title: 'Software Engineer', type: null }), 'internship')).toBe(false);
    });
    it('matches freelance by type or title, but not untyped jobs', () => {
      expect(matchesType(mk({ type: 'freelance' }), 'freelance')).toBe(true);
      expect(matchesType(mk({ title: 'Freelance Writer', type: null }), 'freelance')).toBe(true);
      expect(matchesType(mk({ type: null }), 'freelance')).toBe(false);
    });
    it('matches temporary/seasonal by type or title, but not untyped jobs', () => {
      expect(matchesType(mk({ type: 'temporary' }), 'temporary')).toBe(true);
      expect(matchesType(mk({ title: 'Seasonal Sales Associate', type: null }), 'temporary')).toBe(true);
      expect(matchesType(mk({ type: null }), 'temporary')).toBe(false);
    });
    it('passes everything when no type is given', () => {
      expect(matchesType(mk({ type: 'full_time' }), undefined)).toBe(true);
    });
  });

  describe('normalizeJooble', () => {
    it('maps a Jooble row into the unified shape', () => {
      const j = normalizeJooble({
        id: 42, title: 'Backend Engineer', company: 'Acme KK', location: 'Tokyo, Japan',
        salary: '¥8,000,000', type: 'Full-time', snippet: 'Build APIs', link: 'https://jooble.org/x',
        updated: '2026-10-01T00:00:00Z',
      });
      expect(j).toMatchObject({ source: 'Jooble', title: 'Backend Engineer', company: 'Acme KK', url: 'https://jooble.org/x', type: 'full_time' });
      expect(j?.postedAt).toBe('2026-10-01T00:00:00.000Z');
    });
    it('skips rows without a link or title', () => {
      expect(normalizeJooble({ title: 'x' })).toBeNull();
    });
  });

  describe('normalizeCareerjet', () => {
    it('maps a Careerjet row and parses its human date', () => {
      const j = normalizeCareerjet({
        title: 'Data Analyst', company: 'Globex', locations: 'Osaka',
        salary: '¥6M', description: 'SQL and dashboards', url: 'https://careerjet/x', date: 'Fri, 20 Sep 2024',
      }, 'jp');
      expect(j).toMatchObject({ source: 'Careerjet', title: 'Data Analyst', location: 'Osaka' });
      // Assert the parsed month (not the exact day — toISOString is UTC, so a
      // local-midnight date can land on the 19th or 20th depending on timezone).
      expect(j?.postedAt).toMatch(/^2024-09-\d\dT/);
    });
    it('falls back to the country name when no location is given', () => {
      const j = normalizeCareerjet({ title: 'Dev', company: 'C', url: 'u', date: null }, 'jp');
      expect(j?.location).toBe('Japan');
    });
    it('keeps the v4 salary floor only when it is yearly', () => {
      const yearly = normalizeCareerjet({ title: 'Dev', url: 'u', salary_min: 50000, salary_type: 'Y' }, 'gb');
      const hourly = normalizeCareerjet({ title: 'Dev', url: 'u', salary_min: 20, salary_type: 'H' }, 'gb');
      expect(yearly?.salaryMin).toBe(50000);
      expect(hourly?.salaryMin).toBeNull();
    });
  });

  describe('normalizeMuse', () => {
    it('maps a Muse row, joining location names', () => {
      const j = normalizeMuse({
        id: 7, name: 'Product Manager', company: { name: 'Muse Co' }, type: 'Full Time',
        locations: [{ name: 'Tokyo, Japan' }, { name: 'Remote' }],
        contents: '<p>Lead products</p>', refs: { landing_page: 'https://themuse/x' },
        publication_date: '2026-09-15T10:00:00Z',
      });
      expect(j).toMatchObject({ source: 'Muse', title: 'Product Manager', url: 'https://themuse/x', type: 'full_time' });
      expect(j?.location).toBe('Tokyo, Japan, Remote');
      expect(j?.remote).toBe(true);
    });
    it('skips rows without a landing page', () => {
      expect(normalizeMuse({ name: 'x', refs: {} })).toBeNull();
    });
  });

  describe('sortByDateDesc', () => {
    it('newest first, undated last', () => {
      const out = sortByDateDesc([
        mk({ id: 'old', postedAt: '2020-01-01T00:00:00Z' }),
        mk({ id: 'none', postedAt: null }),
        mk({ id: 'new', postedAt: '2026-08-19T00:00:00Z' }),
      ]);
      expect(out.map(j => j.id)).toEqual(['new', 'old', 'none']);
    });
  });

  describe('normalizers', () => {
    it('normalizeAdzuna maps fields and flags remote from the text', () => {
      const job = normalizeAdzuna({
        id: 42, title: 'Backend Engineer', company: { display_name: 'Acme' },
        location: { display_name: 'Bengaluru' }, salary_min: 2_000_000, salary_max: 3_000_000,
        contract_time: 'full_time', category: { label: 'IT Jobs' }, created: '2026-08-10T00:00:00Z',
        redirect_url: 'https://adzuna/x', description: 'This role is work from home',
      }, 'in');
      expect(job).toMatchObject({
        title: 'Backend Engineer', company: 'Acme', source: 'Adzuna',
        remote: true, salary: '₹2.0M–₹3.0M', salaryMin: 2_000_000,
      });
    });
    it('normalizeRemoteOK skips the legal first element (no position)', () => {
      expect(normalizeRemoteOK({ legal: 'notice' })).toBeNull();
    });
    it('normalizeArbeitnow converts epoch seconds → ISO', () => {
      const job = normalizeArbeitnow({
        slug: 'x', title: 'Dev', company_name: 'Acme', location: 'Berlin',
        remote: false, url: 'https://a/x', created_at: 1_787_133_637, tags: ['Marketing'],
      });
      expect(job?.postedAt).toBe(new Date(1_787_133_637 * 1000).toISOString());
      expect(job?.remote).toBe(false);
    });
  });

  describe('cleanText', () => {
    it('strips tags and decodes entities', () => {
      expect(cleanText('<b>Senior</b> &amp; Lead')).toBe('Senior & Lead');
    });
  });
});
