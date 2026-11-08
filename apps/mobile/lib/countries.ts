// The country list the Jobs location picker offers. Mirrors the backend catalogue
// (backend/api/src/jobs/countries.ts) — codes must match so a selection resolves
// to results. Adzuna serves only ~19 of these; the rest come from Careerjet /
// Jooble / The Muse. Grouped loosely by region, with India first (home market).

export interface Country { code: string; name: string; flag: string }

export const COUNTRIES: Country[] = [
  { code: 'in', name: 'India', flag: '🇮🇳' },
  { code: 'us', name: 'United States', flag: '🇺🇸' },
  { code: 'gb', name: 'United Kingdom', flag: '🇬🇧' },
  { code: 'ca', name: 'Canada', flag: '🇨🇦' },
  { code: 'au', name: 'Australia', flag: '🇦🇺' },
  { code: 'nz', name: 'New Zealand', flag: '🇳🇿' },
  { code: 'ie', name: 'Ireland', flag: '🇮🇪' },
  { code: 'sg', name: 'Singapore', flag: '🇸🇬' },
  { code: 'my', name: 'Malaysia', flag: '🇲🇾' },
  { code: 'ph', name: 'Philippines', flag: '🇵🇭' },
  { code: 'hk', name: 'Hong Kong', flag: '🇭🇰' },
  { code: 'jp', name: 'Japan', flag: '🇯🇵' },
  { code: 'kr', name: 'South Korea', flag: '🇰🇷' },
  { code: 'cn', name: 'China', flag: '🇨🇳' },
  { code: 'tw', name: 'Taiwan', flag: '🇹🇼' },
  { code: 'id', name: 'Indonesia', flag: '🇮🇩' },
  { code: 'th', name: 'Thailand', flag: '🇹🇭' },
  { code: 'vn', name: 'Vietnam', flag: '🇻🇳' },
  { code: 'pk', name: 'Pakistan', flag: '🇵🇰' },
  { code: 'bd', name: 'Bangladesh', flag: '🇧🇩' },
  { code: 'lk', name: 'Sri Lanka', flag: '🇱🇰' },
  { code: 'np', name: 'Nepal', flag: '🇳🇵' },
  { code: 'ae', name: 'United Arab Emirates', flag: '🇦🇪' },
  { code: 'sa', name: 'Saudi Arabia', flag: '🇸🇦' },
  { code: 'qa', name: 'Qatar', flag: '🇶🇦' },
  { code: 'kw', name: 'Kuwait', flag: '🇰🇼' },
  { code: 'bh', name: 'Bahrain', flag: '🇧🇭' },
  { code: 'om', name: 'Oman', flag: '🇴🇲' },
  { code: 'il', name: 'Israel', flag: '🇮🇱' },
  { code: 'tr', name: 'Turkey', flag: '🇹🇷' },
  { code: 'de', name: 'Germany', flag: '🇩🇪' },
  { code: 'fr', name: 'France', flag: '🇫🇷' },
  { code: 'nl', name: 'Netherlands', flag: '🇳🇱' },
  { code: 'be', name: 'Belgium', flag: '🇧🇪' },
  { code: 'lu', name: 'Luxembourg', flag: '🇱🇺' },
  { code: 'ch', name: 'Switzerland', flag: '🇨🇭' },
  { code: 'at', name: 'Austria', flag: '🇦🇹' },
  { code: 'it', name: 'Italy', flag: '🇮🇹' },
  { code: 'es', name: 'Spain', flag: '🇪🇸' },
  { code: 'pt', name: 'Portugal', flag: '🇵🇹' },
  { code: 'se', name: 'Sweden', flag: '🇸🇪' },
  { code: 'no', name: 'Norway', flag: '🇳🇴' },
  { code: 'dk', name: 'Denmark', flag: '🇩🇰' },
  { code: 'fi', name: 'Finland', flag: '🇫🇮' },
  { code: 'pl', name: 'Poland', flag: '🇵🇱' },
  { code: 'cz', name: 'Czechia', flag: '🇨🇿' },
  { code: 'sk', name: 'Slovakia', flag: '🇸🇰' },
  { code: 'hu', name: 'Hungary', flag: '🇭🇺' },
  { code: 'ro', name: 'Romania', flag: '🇷🇴' },
  { code: 'bg', name: 'Bulgaria', flag: '🇧🇬' },
  { code: 'gr', name: 'Greece', flag: '🇬🇷' },
  { code: 'hr', name: 'Croatia', flag: '🇭🇷' },
  { code: 'si', name: 'Slovenia', flag: '🇸🇮' },
  { code: 'rs', name: 'Serbia', flag: '🇷🇸' },
  { code: 'ua', name: 'Ukraine', flag: '🇺🇦' },
  { code: 'ru', name: 'Russia', flag: '🇷🇺' },
  { code: 'ee', name: 'Estonia', flag: '🇪🇪' },
  { code: 'lv', name: 'Latvia', flag: '🇱🇻' },
  { code: 'lt', name: 'Lithuania', flag: '🇱🇹' },
  { code: 'kz', name: 'Kazakhstan', flag: '🇰🇿' },
  { code: 'br', name: 'Brazil', flag: '🇧🇷' },
  { code: 'mx', name: 'Mexico', flag: '🇲🇽' },
  { code: 'ar', name: 'Argentina', flag: '🇦🇷' },
  { code: 'cl', name: 'Chile', flag: '🇨🇱' },
  { code: 'co', name: 'Colombia', flag: '🇨🇴' },
  { code: 'pe', name: 'Peru', flag: '🇵🇪' },
  { code: 've', name: 'Venezuela', flag: '🇻🇪' },
  { code: 'cr', name: 'Costa Rica', flag: '🇨🇷' },
  { code: 'uy', name: 'Uruguay', flag: '🇺🇾' },
  { code: 'ec', name: 'Ecuador', flag: '🇪🇨' },
  { code: 'do', name: 'Dominican Republic', flag: '🇩🇴' },
  { code: 'za', name: 'South Africa', flag: '🇿🇦' },
  { code: 'ng', name: 'Nigeria', flag: '🇳🇬' },
  { code: 'ke', name: 'Kenya', flag: '🇰🇪' },
  { code: 'gh', name: 'Ghana', flag: '🇬🇭' },
  { code: 'tz', name: 'Tanzania', flag: '🇹🇿' },
  { code: 'ug', name: 'Uganda', flag: '🇺🇬' },
  { code: 'eg', name: 'Egypt', flag: '🇪🇬' },
  { code: 'ma', name: 'Morocco', flag: '🇲🇦' },
  { code: 'dz', name: 'Algeria', flag: '🇩🇿' },
  { code: 'tn', name: 'Tunisia', flag: '🇹🇳' },
];

// How many countries one search may fan out over (must match backend MAX_COUNTRIES).
export const MAX_COUNTRIES = 5;

const BY_CODE = new Map(COUNTRIES.map(c => [c.code, c] as const));
export const countryOf = (code: string): Country | undefined => BY_CODE.get(code);

// The Jobs `where` value is one string: 'remote', 'all', or a comma-joined list of
// country codes (e.g. 'jp,kr'). This renders it as a short, human label for chips.
export function summarizeWhere(where: string): string {
  if (where === 'remote') return '🌍 Remote';
  if (where === 'all') return '🌐 All major markets';
  const codes = where.split(',').filter(Boolean);
  if (codes.length === 0) return 'Select location';
  const first = countryOf(codes[0]);
  const head = first ? `${first.flag} ${first.name}` : codes[0].toUpperCase();
  return codes.length > 1 ? `${head} +${codes.length - 1}` : head;
}
