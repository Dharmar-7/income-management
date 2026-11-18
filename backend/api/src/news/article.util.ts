import { isIP } from 'node:net';
import { parseHTML } from 'linkedom';
import { Readability } from '@mozilla/readability';

// ─────────────────────────────────────────────────────────────────────────────
// Reader view: turn a news article page into clean text blocks the app renders
// natively (like Firefox Reader View — Mozilla's Readability does the
// "which part is the article" work). Pure functions only; fetching lives in
// ArticleService so this stays unit-testable.
// ─────────────────────────────────────────────────────────────────────────────

export type ArticleBlockType = 'p' | 'h' | 'li' | 'quote';
export interface ArticleBlock { type: ArticleBlockType; text: string }

export interface Article {
  url: string;              // final URL after redirects
  title: string;
  byline: string | null;
  siteName: string | null;
  published: string | null; // ISO string when the page states it
  image: string | null;     // absolute URL of the lead image
  blocks: ArticleBlock[];
  wordCount: number;
  // True when we got only a teaser (paywall, consent wall, JS-only page):
  // the app then nudges the user to the original instead.
  partial: boolean;
}

const MIN_FULL_WORDS = 120;

// ─── SSRF guard ──────────────────────────────────────────────────────────────
// The endpoint fetches user-supplied URLs, so it must never reach our own
// network or cloud metadata. Applied to every resolved address of every hop.

export function isPrivateAddress(ip: string): boolean {
  const v = isIP(ip);
  if (v === 4) {
    const [a, b] = ip.split('.').map(Number);
    return (
      a === 0 || a === 10 || a === 127 ||
      (a === 100 && b >= 64 && b <= 127) ||  // carrier-grade NAT
      (a === 169 && b === 254) ||             // link-local / cloud metadata
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      (a === 198 && (b === 18 || b === 19)) || // benchmarking
      a >= 224                                 // multicast + reserved
    );
  }
  if (v === 6) {
    const s = ip.toLowerCase();
    if (s === '::' || s === '::1') return true;
    const mapped = s.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
    if (mapped) return isPrivateAddress(mapped[1]);
    return /^(fc|fd|fe8|fe9|fea|feb|ff)/.test(s); // unique-local, link-local, multicast
  }
  return true; // not an IP at all → refuse
}

// Shape check before any network access. Returns a normalised URL or null.
export function checkArticleUrl(raw: string): URL | null {
  if (!raw || raw.length > 2048) return null;
  let u: URL;
  try { u = new URL(raw); } catch { return null; }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') return null;
  if (u.username || u.password) return null;
  if (u.port && u.port !== '80' && u.port !== '443') return null;
  const host = u.hostname.toLowerCase();
  if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local') || host.endsWith('.internal')) return null;
  if (isIP(host.replace(/^\[|\]$/g, ''))) return null; // bare IPs: only real hostnames
  if (!host.includes('.')) return null;
  u.hash = '';
  return u;
}

// ─── Extraction ──────────────────────────────────────────────────────────────

function clean(text: string | null | undefined): string {
  return (text ?? '').replace(/\s+/g, ' ').trim();
}

function meta(doc: Document, ...names: string[]): string | null {
  for (const n of names) {
    const el = doc.querySelector(`meta[property="${n}"], meta[name="${n}"]`);
    const v = clean(el?.getAttribute('content'));
    if (v) return v;
  }
  return null;
}

function absolute(src: string | null, base: string): string | null {
  if (!src) return null;
  try {
    const u = new URL(src, base);
    return u.protocol === 'https:' || u.protocol === 'http:' ? u.toString() : null;
  } catch {
    return null;
  }
}

const BLOCK_SELECTOR = 'p, h1, h2, h3, h4, h5, h6, li, blockquote, pre';
const CONTAINERS = new Set(['LI', 'BLOCKQUOTE']);

// Flatten Readability's cleaned HTML into ordered text blocks. A <p> inside a
// <li>/<blockquote> is folded into that container so text isn't repeated.
export function htmlToBlocks(html: string): ArticleBlock[] {
  const { document } = parseHTML(`<!doctype html><html><body>${html}</body></html>`);
  const blocks: ArticleBlock[] = [];
  for (const el of Array.from(document.querySelectorAll(BLOCK_SELECTOR)) as Element[]) {
    let insideContainer = false;
    for (let a = el.parentElement; a; a = a.parentElement) {
      if (CONTAINERS.has(a.tagName)) { insideContainer = true; break; }
    }
    if (insideContainer) continue;

    const text = clean(el.textContent);
    if (text.length < 2) continue;
    const tag = el.tagName;
    const type: ArticleBlockType =
      /^H[1-6]$/.test(tag) ? 'h' : tag === 'LI' ? 'li' : tag === 'BLOCKQUOTE' ? 'quote' : 'p';
    blocks.push({ type, text });
  }
  return blocks;
}

export function extractArticle(html: string, url: string): Article | null {
  const { document } = parseHTML(html);

  // Read page metadata BEFORE Readability, which mutates the document.
  const image = absolute(meta(document, 'og:image', 'twitter:image', 'twitter:image:src'), url);
  const published = meta(document, 'article:published_time', 'og:published_time', 'date', 'pubdate');
  const ogTitle = meta(document, 'og:title', 'twitter:title');
  const ogSite = meta(document, 'og:site_name');

  const parsed = new Readability(document as unknown as Document).parse();
  if (!parsed) return null;

  let blocks = htmlToBlocks(parsed.content ?? '');
  // Some pages use <div>/<br> instead of paragraphs — fall back to text lines.
  if (blocks.length === 0 && parsed.textContent) {
    blocks = parsed.textContent
      .split(/\n\s*\n/)
      .map(clean)
      .filter(t => t.length > 1)
      .map(text => ({ type: 'p' as const, text }));
  }

  const title = clean(parsed.title) || ogTitle || '';
  const byline = clean(parsed.byline) || null;
  // Readability often repeats the headline (and sometimes the author) up top.
  while (blocks[0] && (blocks[0].text === title || (byline && blocks[0].text === byline))) blocks = blocks.slice(1);

  const wordCount = blocks.reduce((n, b) => n + b.text.split(' ').length, 0);
  const publishedIso = (() => {
    const raw = published ?? parsed.publishedTime ?? null;
    const t = raw ? Date.parse(raw) : NaN;
    return isNaN(t) ? null : new Date(t).toISOString();
  })();

  return {
    url,
    title,
    byline,
    siteName: clean(parsed.siteName) || ogSite,
    published: publishedIso,
    image,
    blocks,
    wordCount,
    partial: wordCount < MIN_FULL_WORDS,
  };
}
