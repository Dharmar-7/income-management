// Offline, no-AI "ATS reviewer": compares a resume's text against a job
// description the way a real applicant-tracking system roughly does — keyword
// coverage plus structural/parse checks. Pure functions (no network, no ML),
// matching the app's free/offline philosophy; the service feeds it extracted text.

export interface AtsCheck { key: string; label: string; ok: boolean; hint: string }
export interface AtsResult {
  score: number;          // 0-100 overall
  coverage: number;       // 0-100 JD-keyword coverage
  matched: string[];
  missing: string[];
  checks: AtsCheck[];
  keywordCount: number;
  resumeWordCount: number;
}

// Common English + generic JD filler — excluded so keywords skew toward real skills.
const STOPWORDS = new Set([
  'the', 'a', 'an', 'and', 'or', 'of', 'to', 'in', 'for', 'with', 'on', 'at', 'by', 'from', 'as',
  'is', 'are', 'be', 'been', 'being', 'was', 'were', 'will', 'would', 'can', 'could', 'should', 'may',
  'we', 'you', 'our', 'your', 'their', 'they', 'them', 'it', 'its', 'this', 'that', 'these', 'those',
  'into', 'per', 'via', 'etc', 'eg', 'ie', 'not', 'but', 'if', 'then', 'than', 'so', 'such', 'both',
  'experience', 'experienced', 'years', 'year', 'work', 'working', 'team', 'teams', 'role', 'roles',
  'ability', 'able', 'strong', 'good', 'great', 'excellent', 'knowledge', 'skills', 'skill', 'including',
  'include', 'includes', 'must', 'should', 'required', 'require', 'requirements', 'responsibilities',
  'responsible', 'candidate', 'candidates', 'ideal', 'looking', 'join', 'company', 'job', 'position',
  'opportunity', 'environment', 'using', 'use', 'used', 'help', 'support', 'new', 'well', 'plus',
  'across', 'within', 'high', 'quality', 'best', 'practices', 'practice', 'ensure', 'deliver', 'build',
  'building', 'develop', 'development', 'design', 'designing', 'related', 'field', 'degree', 'plus',
  'about', 'all', 'any', 'more', 'most', 'other', 'who', 'what', 'when', 'where', 'how', 'have', 'has',
  'do', 'does', 'get', 'like', 'want', 'need', 'us', 'up', 'out', 'over', 'also', 'day', 'time',
]);

// Terms we always treat as meaningful if present, so important skills surface even
// when their frequency in the JD is low.
const SKILL_HINTS = new Set([
  'react', 'node', 'nodejs', 'javascript', 'typescript', 'python', 'java', 'kotlin', 'swift', 'go',
  'golang', 'rust', 'ruby', 'rails', 'php', 'laravel', 'c++', 'c#', 'dotnet', '.net', 'scala',
  'sql', 'nosql', 'mongodb', 'postgres', 'postgresql', 'mysql', 'redis', 'elasticsearch', 'kafka',
  'aws', 'azure', 'gcp', 'docker', 'kubernetes', 'terraform', 'ansible', 'linux', 'nginx',
  'graphql', 'rest', 'grpc', 'api', 'apis', 'microservices', 'git', 'ci', 'cd', 'cicd', 'devops',
  'agile', 'scrum', 'kanban', 'jira', 'redux', 'html', 'css', 'sass', 'tailwind', 'bootstrap',
  'express', 'nestjs', 'nextjs', 'django', 'flask', 'spring', 'hibernate', 'android', 'ios',
  'flutter', 'react-native', 'machine', 'learning', 'ml', 'ai', 'nlp', 'data', 'analytics',
  'pandas', 'numpy', 'tensorflow', 'pytorch', 'spark', 'hadoop', 'tableau', 'powerbi', 'excel',
  'figma', 'communication', 'leadership', 'testing', 'jest', 'cypress', 'selenium', 'security',
]);

// Split on anything that isn't alphanumeric, + or # (keeps c++, c#). "node.js" → node, js.
function tokenize(text: string): string[] {
  return text.toLowerCase().split(/[^a-z0-9+#]+/).filter(Boolean);
}

export function extractKeywords(jd: string, limit = 24): string[] {
  const counts = new Map<string, number>();
  for (const tok of tokenize(jd)) {
    if (tok.length < 2 || STOPWORDS.has(tok) || /^\d+$/.test(tok)) continue;
    counts.set(tok, (counts.get(tok) ?? 0) + 1);
  }
  const ranked = [...counts.entries()].sort((a, b) => {
    const sa = SKILL_HINTS.has(a[0]) ? 1 : 0;
    const sb = SKILL_HINTS.has(b[0]) ? 1 : 0;
    if (sb !== sa) return sb - sa;          // known skills first
    if (b[1] !== a[1]) return b[1] - a[1];  // then by frequency
    return a[0] < b[0] ? -1 : 1;            // then alphabetical (stable)
  });
  return ranked.slice(0, limit).map(([w]) => w);
}

export function analyzeResume(resumeText: string, jdText: string): AtsResult {
  const keywords = extractKeywords(jdText);
  const resumeTokens = new Set(tokenize(resumeText));
  const matched = keywords.filter(k => resumeTokens.has(k));
  const missing = keywords.filter(k => !resumeTokens.has(k));
  const coverage = keywords.length ? matched.length / keywords.length : 0;

  const words = resumeText.trim().split(/\s+/).filter(Boolean).length;
  const has = (re: RegExp) => re.test(resumeText);
  const hasEmail = /[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/i.test(resumeText);

  const checks: AtsCheck[] = [
    {
      key: 'readable', label: 'Readable text (not a scanned image)', ok: words >= 120,
      hint: 'Very little text could be extracted — your resume may be image-based or scanned. Export a text-based PDF so an ATS can parse it.',
    },
    {
      key: 'contact', label: 'Contact email present', ok: hasEmail,
      hint: 'Add a clear email address (and phone number) near the top.',
    },
    {
      key: 'experience', label: 'Experience section', ok: has(/\b(experience|employment|work history)\b/i),
      hint: 'Add a clearly titled "Experience" or "Work History" section.',
    },
    {
      key: 'education', label: 'Education section', ok: has(/\b(education|qualification|academic)\b/i),
      hint: 'Add an "Education" section.',
    },
    {
      key: 'skills', label: 'Skills section', ok: has(/\b(skills|technologies|tech stack|competenc)\w*/i),
      hint: 'Add a "Skills" section listing your key tools and technologies.',
    },
    {
      key: 'length', label: 'Reasonable length (~1–2 pages)', ok: words >= 200 && words <= 1200,
      hint: words < 200
        ? 'Looks short — add more detail on your experience and impact.'
        : 'Looks long — trim to the most relevant 1–2 pages.',
    },
  ];

  const checksPassed = checks.filter(c => c.ok).length / checks.length;
  const score = Math.round(100 * (0.7 * coverage + 0.3 * checksPassed));

  return {
    score,
    coverage: Math.round(coverage * 100),
    matched,
    missing,
    checks,
    keywordCount: keywords.length,
    resumeWordCount: words,
  };
}
