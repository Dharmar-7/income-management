// News feed catalog + a tiny, dependency-free RSS/Atom parser.
//
// WHY it lives entirely on the device (no backend, no DB):
// React Native's fetch has no CORS restriction, so the phone can pull public RSS
// feeds directly. That means the News screen never touches our NestJS API or the
// Neon database — it can't wake Neon, needs no cron, and costs zero compute. It
// also keeps working while Render is asleep. The only network traffic is the
// phone talking straight to the publishers.
//
// Results are fetched through React Query, whose cache is already persisted to
// AsyncStorage (see app/_layout.tsx), so the screen opens instantly to the last
// headlines even offline, then refreshes in the background.

// A browser-ish UA — a few publishers reject the default RN user-agent.
const UA =
  'Mozilla/5.0 (Linux; Android 13) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Mobile Safari/537.36 Velora/1.0';

// Give a single slow/dead feed this long before we give up on it. Promise.all
// still resolves the others, so one laggard never blocks the whole category.
const FEED_TIMEOUT_MS = 9_000;

export type CategoryKey = 'top' | 'markets' | 'tech' | 'science';

export interface Feed {
  name: string; // shown as the source label on each card
  url: string;
}

export interface Category {
  key: CategoryKey;
  label: string;
  emoji: string;
  // 'top' has no feeds of its own — it merges everything (see feedsFor()).
  feeds?: Feed[];
}

export interface NewsItem {
  id: string; // stable key (the article link, or source+title if none)
  title: string;
  summary: string; // plain-language sentence, HTML stripped — '' if the feed gives none
  link: string; // opened in an in-app browser on tap
  source: string;
  published: number | null; // epoch ms, or null if the feed omitted/garbled the date
}

// ─── The feeds ────────────────────────────────────────────────────────────────
// All verified live and returning well-formed RSS/Atom. India-first for markets
// (matches the user), plus CNBC for global moves that ripple into local markets.

const MARKETS: Feed[] = [
  { name: 'Economic Times', url: 'https://economictimes.indiatimes.com/markets/rssfeeds/1977021501.cms' },
  { name: 'Mint', url: 'https://www.livemint.com/rss/markets' },
  { name: 'Business Standard', url: 'https://www.business-standard.com/rss/markets-106.rss' },
  { name: 'CNBC', url: 'https://search.cnbc.com/rs/search/combinedcms/view.xml?partnerId=wrss01&id=10000664' },
  // Broader business/industry desks too. The *money* side of sports,
  // entertainment, gaming and media surfaces here — IPL media-rights auctions,
  // PVR box-office numbers, Zee–Sony deals, the 28% gaming-GST ruling, etc.
  // Filtering by SOURCE (a business desk) rather than by topic keeps the finance
  // angle and leaves out the pure match-scores / celebrity-gossip noise.
  { name: 'Economic Times', url: 'https://economictimes.indiatimes.com/industry/rssfeeds/13352306.cms' },
  { name: 'Mint', url: 'https://www.livemint.com/rss/industry' },
];

const TECH: Feed[] = [
  { name: 'Hacker News', url: 'https://news.ycombinator.com/rss' },
  { name: 'The Verge', url: 'https://www.theverge.com/rss/index.xml' },
  { name: 'TechCrunch', url: 'https://techcrunch.com/feed/' },
  { name: 'Ars Technica', url: 'https://feeds.arstechnica.com/arstechnica/index' },
];

const SCIENCE: Feed[] = [
  { name: 'ScienceDaily', url: 'https://www.sciencedaily.com/rss/top/science.xml' },
  { name: 'MIT Tech Review', url: 'https://www.technologyreview.com/feed/' },
  { name: 'Phys.org', url: 'https://phys.org/rss-feed/' },
  { name: 'NASA', url: 'https://www.nasa.gov/news-release/feed/' },
];

export const CATEGORIES: Category[] = [
  { key: 'top', label: 'Top', emoji: '⭐' },
  { key: 'markets', label: 'Markets', emoji: '📈', feeds: MARKETS },
  { key: 'tech', label: 'Tech', emoji: '💻', feeds: TECH },
  { key: 'science', label: 'Science', emoji: '🔬', feeds: SCIENCE },
];

const ALL_FEEDS: Feed[] = [...MARKETS, ...TECH, ...SCIENCE];

// Which category a source belongs to — lets the UI colour each card's dot by its
// world, even in the mixed "Top" tab.
export const SOURCE_CATEGORY: Record<string, CategoryKey> = (() => {
  const map: Record<string, CategoryKey> = {};
  for (const cat of CATEGORIES) for (const f of cat.feeds ?? []) map[f.name] = cat.key;
  return map;
})();

function feedsFor(key: CategoryKey): Feed[] {
  if (key === 'top') return ALL_FEEDS;
  return CATEGORIES.find(c => c.key === key)?.feeds ?? [];
}

// ─── Text cleanup ───────────────────────────────────────────────────────────

function stripCdata(s: string): string {
  return s.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1');
}

const NAMED_ENTITIES: Record<string, string> = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ',
  ldquo: '“', rdquo: '”', lsquo: '‘', rsquo: '’', hellip: '…', mdash: '—', ndash: '–',
};

function decodeEntities(s: string): string {
  return s
    .replace(/&#x([0-9a-fA-F]+);/g, (_, h) => codePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => codePoint(parseInt(d, 10)))
    .replace(/&([a-zA-Z]+);/g, (m, name) => NAMED_ENTITIES[name] ?? m);
}

function codePoint(code: number): string {
  try {
    return Number.isFinite(code) ? String.fromCodePoint(code) : '';
  } catch {
    return '';
  }
}

function stripTags(s: string): string {
  return s.replace(/<[^>]+>/g, ' ');
}

// Feeds double-bind their text differently: some wrap real HTML in CDATA, others
// HTML-escape the markup (ET's <description> is literally `&lt;a&gt;…`). Decoding,
// stripping tags, then decoding once more handles both and any leftover
// double-escaping, leaving a clean plain-language sentence.
function clean(raw: string | null, cap: number): string {
  if (!raw) return '';
  let out = stripCdata(raw);
  out = decodeEntities(out);
  out = stripTags(out);
  out = decodeEntities(out);
  out = out.replace(/\s+/g, ' ').trim();
  if (out.length > cap) out = out.slice(0, cap - 1).replace(/\s+\S*$/, '').trimEnd() + '…';
  return out;
}

// ─── Parsing ──────────────────────────────────────────────────────────────────

function firstTag(block: string, name: string): string | null {
  const m = block.match(new RegExp(`<${name}\\b[^>]*>([\\s\\S]*?)</${name}>`, 'i'));
  return m ? m[1] : null;
}

// Atom links are attributes, not text. Prefer the human page (rel="alternate");
// fall back to the first link that has an href.
function atomLink(block: string): string | null {
  const alternate =
    block.match(/<link\b[^>]*\brel=["']alternate["'][^>]*\bhref=["']([^"']+)["']/i) ||
    block.match(/<link\b[^>]*\bhref=["']([^"']+)["'][^>]*\brel=["']alternate["']/i);
  if (alternate) return alternate[1];
  const any = block.match(/<link\b[^>]*\bhref=["']([^"']+)["']/i);
  return any ? any[1] : null;
}

export function parseFeed(xml: string, source: string): NewsItem[] {
  // Atom uses <entry>; RSS uses <item>. Some RSS feeds carry an <atom:link> self
  // reference, so only treat a feed as Atom when it has entries and no items.
  const isAtom = /<entry[\s>]/i.test(xml) && !/<item[\s>]/i.test(xml);
  const blockRe = isAtom
    ? /<entry\b[^>]*>([\s\S]*?)<\/entry>/gi
    : /<item\b[^>]*>([\s\S]*?)<\/item>/gi;

  const items: NewsItem[] = [];
  let m: RegExpExecArray | null;
  while ((m = blockRe.exec(xml))) {
    const block = m[1];

    const title = clean(firstTag(block, 'title'), 180);
    if (!title) continue;

    let link = '';
    if (isAtom) {
      link = atomLink(block) ?? '';
    } else {
      // Mint (and others) CDATA-wrap the URL — <link><![CDATA[https://…]]></link> —
      // so strip that BEFORE the http test, or the link is missed and the card
      // can't be tapped through.
      const raw = stripCdata(firstTag(block, 'link') ?? '').trim();
      if (/^https?:/i.test(raw)) {
        link = raw;
      } else {
        // Some feeds leave <link> empty and put the URL in a permalink <guid>.
        const guid = stripCdata(firstTag(block, 'guid') ?? '').trim();
        if (/^https?:/i.test(guid)) link = guid;
      }
    }
    link = decodeEntities(stripCdata(link)).trim();

    let summary = clean(
      isAtom
        ? firstTag(block, 'summary') ?? firstTag(block, 'content')
        : firstTag(block, 'description'),
      220,
    );
    // A few feeds (e.g. Hacker News) put only a "Comments"/"Read more" link in the
    // description, which strips down to a lone meaningless word — drop those so the
    // card shows a clean headline instead.
    if (/^(comments?|read more|continue reading|read article|more)$/i.test(summary)) summary = '';

    const rawDate = isAtom
      ? firstTag(block, 'published') ?? firstTag(block, 'updated')
      : firstTag(block, 'pubDate') ?? firstTag(block, 'dc:date') ?? firstTag(block, 'date');
    let published: number | null = null;
    if (rawDate) {
      // Some feeds CDATA-wrap the date too, so strip before parsing.
      const t = Date.parse(stripCdata(rawDate).trim());
      if (!Number.isNaN(t)) published = t;
    }

    items.push({ id: link || `${source}:${title}`, title, summary, link, source, published });
  }
  return items;
}

// ─── Fetching ─────────────────────────────────────────────────────────────────

// Never throws: a failed/slow/malformed feed just contributes nothing, so the
// category still renders whatever the healthy feeds returned.
async function fetchOneFeed(feed: Feed): Promise<NewsItem[]> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FEED_TIMEOUT_MS);
  try {
    const res = await fetch(feed.url, {
      headers: { 'User-Agent': UA, Accept: 'application/rss+xml, application/atom+xml, application/xml, text/xml, */*' },
      signal: controller.signal,
    });
    if (!res.ok) return [];
    return parseFeed(await res.text(), feed.name);
  } catch {
    return [];
  } finally {
    clearTimeout(timer);
  }
}

export async function fetchNews(key: CategoryKey): Promise<NewsItem[]> {
  const feeds = feedsFor(key);
  // In "Top" we blend many feeds, so cap each one's share — otherwise a
  // high-volume publisher (Mint, ScienceDaily) would crowd out everyone else.
  const perFeed = key === 'top' ? 8 : 100;

  const batches = await Promise.all(
    feeds.map(async f => (await fetchOneFeed(f)).slice(0, perFeed)),
  );

  const seen = new Set<string>();
  const merged = batches.flat().filter(item => {
    const dedupeKey = (item.link || item.title).toLowerCase();
    if (seen.has(dedupeKey)) return false;
    seen.add(dedupeKey);
    return true;
  });

  merged.sort((a, b) => (b.published ?? 0) - (a.published ?? 0));

  // Every feed failed (e.g. no connectivity). Throw so React Query keeps showing
  // the last good, persisted headlines instead of blanking the screen with [].
  if (merged.length === 0) {
    throw new Error('Couldn’t reach the news right now. Pull down to try again.');
  }

  return merged.slice(0, key === 'top' ? 60 : 50);
}

// ─── Search ─────────────────────────────────────────────────────────────────
// A broad, deduped pool across EVERY feed, fetched once and cached (React Query
// persists it), so a company/keyword search has plenty to match and filtering
// then happens instantly on-device as the user types — no refetch per keystroke.
// A higher per-feed cap than "top" widens the net without being unbounded.
export async function fetchNewsPool(): Promise<NewsItem[]> {
  const batches = await Promise.all(
    ALL_FEEDS.map(async f => (await fetchOneFeed(f)).slice(0, 40)),
  );

  const seen = new Set<string>();
  const merged = batches.flat().filter(item => {
    const dedupeKey = (item.link || item.title).toLowerCase();
    if (seen.has(dedupeKey)) return false;
    seen.add(dedupeKey);
    return true;
  });

  merged.sort((a, b) => (b.published ?? 0) - (a.published ?? 0));

  if (merged.length === 0) {
    throw new Error('Couldn’t reach the news right now. Pull down to try again.');
  }
  return merged;
}

// Match a story against a search query. Every whitespace-split term must appear
// (AND) across the title, summary or source — so "reliance results" narrows
// rather than widening. Matching a company name is just the common case.
export function matchesNewsQuery(item: NewsItem, query: string): boolean {
  const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (!terms.length) return true;
  const hay = `${item.title} ${item.summary} ${item.source}`.toLowerCase();
  return terms.every(t => hay.includes(t));
}
