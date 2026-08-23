// Server-side news catalog + a minimal RSS/Atom item extractor (title + link is
// all the digest needs to count new stories). Mirrors the feeds in the mobile
// reader (apps/mobile/lib/newsFeeds.ts) — keep the two in sync.

export type NewsCategory = 'markets' | 'tech' | 'science';

export interface NewsFeed { name: string; url: string; category: NewsCategory }
export interface NewsItem { title: string; link: string; source: string; category: NewsCategory }

export const NEWS_FEEDS: NewsFeed[] = [
  // markets / business (money side of the wider world surfaces via the biz desks)
  { name: 'Economic Times', url: 'https://economictimes.indiatimes.com/markets/rssfeeds/1977021501.cms', category: 'markets' },
  { name: 'Mint', url: 'https://www.livemint.com/rss/markets', category: 'markets' },
  { name: 'Business Standard', url: 'https://www.business-standard.com/rss/markets-106.rss', category: 'markets' },
  { name: 'CNBC', url: 'https://search.cnbc.com/rs/search/combinedcms/view.xml?partnerId=wrss01&id=10000664', category: 'markets' },
  { name: 'ET Industry', url: 'https://economictimes.indiatimes.com/industry/rssfeeds/13352306.cms', category: 'markets' },
  { name: 'Mint Industry', url: 'https://www.livemint.com/rss/industry', category: 'markets' },
  // tech
  { name: 'Hacker News', url: 'https://news.ycombinator.com/rss', category: 'tech' },
  { name: 'The Verge', url: 'https://www.theverge.com/rss/index.xml', category: 'tech' },
  { name: 'TechCrunch', url: 'https://techcrunch.com/feed/', category: 'tech' },
  { name: 'Ars Technica', url: 'https://feeds.arstechnica.com/arstechnica/index', category: 'tech' },
  // science
  { name: 'ScienceDaily', url: 'https://www.sciencedaily.com/rss/top/science.xml', category: 'science' },
  { name: 'MIT Tech Review', url: 'https://www.technologyreview.com/feed/', category: 'science' },
  { name: 'Phys.org', url: 'https://phys.org/rss-feed/', category: 'science' },
  { name: 'NASA', url: 'https://www.nasa.gov/news-release/feed/', category: 'science' },
];

function stripCdata(s: string): string {
  return s.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1');
}
function firstTag(block: string, name: string): string | null {
  const m = block.match(new RegExp(`<${name}\\b[^>]*>([\\s\\S]*?)</${name}>`, 'i'));
  return m ? m[1] : null;
}
function decodeBasic(s: string): string {
  return s
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'");
}
function cleanTitle(raw: string | null): string {
  if (!raw) return '';
  return decodeBasic(stripCdata(raw).replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim().slice(0, 200);
}

export function parseNewsItems(xml: string, feed: NewsFeed): NewsItem[] {
  const isAtom = /<entry[\s>]/i.test(xml) && !/<item[\s>]/i.test(xml);
  const re = isAtom ? /<entry\b[^>]*>([\s\S]*?)<\/entry>/gi : /<item\b[^>]*>([\s\S]*?)<\/item>/gi;
  const out: NewsItem[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml))) {
    const block = m[1];
    const title = cleanTitle(firstTag(block, 'title'));
    if (!title) continue;

    let link = '';
    if (isAtom) {
      link = block.match(/<link\b[^>]*\bhref=["']([^"']+)["']/i)?.[1] ?? '';
    } else {
      const raw = stripCdata(firstTag(block, 'link') ?? '').trim();
      if (/^https?:/i.test(raw)) link = raw;
      else {
        const guid = stripCdata(firstTag(block, 'guid') ?? '').trim();
        if (/^https?:/i.test(guid)) link = guid;
      }
    }
    link = decodeBasic(link).trim();

    out.push({ title, link: link || `${feed.name}:${title}`, source: feed.name, category: feed.category });
  }
  return out;
}
