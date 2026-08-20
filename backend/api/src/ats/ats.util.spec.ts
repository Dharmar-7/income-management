import { analyzeResume, extractKeywords } from './ats.util';

const JD = `We are looking for a Senior React Developer with strong TypeScript and Node.js
  experience. You will build REST APIs, work with PostgreSQL and AWS, and use Docker.
  Familiarity with GraphQL and CI/CD pipelines is a plus. Great communication skills required.`;

describe('ats.util', () => {
  describe('extractKeywords', () => {
    it('surfaces real skills over filler words', () => {
      const kws = extractKeywords(JD);
      expect(kws).toEqual(expect.arrayContaining(['react', 'typescript', 'node', 'postgresql', 'aws', 'docker']));
      expect(kws).not.toContain('the');
      expect(kws).not.toContain('with');
      expect(kws).not.toContain('experience'); // generic filler is stopworded
    });
  });

  describe('analyzeResume', () => {
    const pad = 'lorem ipsum dolor sit amet '.repeat(40); // keep length checks happy

    it('scores a matching resume higher than an unrelated one', () => {
      const good = `John Doe john@doe.com +1 555 123 4567
        Experience: Senior React developer building TypeScript apps, Node REST APIs, PostgreSQL, AWS, Docker, GraphQL, CI/CD.
        Skills: React, TypeScript, Node, PostgreSQL, AWS, Docker, GraphQL. Education: BSc Computer Science. ${pad}`;
      const bad = `Jane Smith jane@smith.com
        Experience: Pastry chef and barista. Skills: baking, latte art. Education: Culinary school. ${pad}`;
      const g = analyzeResume(good, JD);
      const b = analyzeResume(bad, JD);
      expect(g.score).toBeGreaterThan(b.score);
      expect(g.matched).toEqual(expect.arrayContaining(['react', 'typescript']));
      expect(g.missing.length).toBeLessThan(b.missing.length);
    });

    it('flags a near-empty (image-based) resume as unreadable', () => {
      const res = analyzeResume('   ', JD);
      expect(res.checks.find(c => c.key === 'readable')?.ok).toBe(false);
      expect(res.score).toBeLessThan(40);
    });

    it('detects a missing education section', () => {
      const r = analyzeResume(`john@x.com react typescript node aws docker postgresql ${'word '.repeat(200)}`, JD);
      expect(r.checks.find(c => c.key === 'education')?.ok).toBe(false);
    });
  });
});
