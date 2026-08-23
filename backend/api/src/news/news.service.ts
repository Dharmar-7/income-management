import { Injectable } from '@nestjs/common';
import { NEWS_FEEDS, NewsFeed, NewsItem, parseNewsItems } from './news.util';

const UA = 'Mozilla/5.0 (compatible; VeloraNews/1.0)';
const TIMEOUT_MS = 9_000;
const PER_FEED = 40;

@Injectable()
export class NewsService {
  // Fetch + parse every feed. Server-side has no CORS limits, and a
  // slow/dead feed just contributes nothing (never throws).
  async fetchAll(): Promise<NewsItem[]> {
    const batches = await Promise.all(NEWS_FEEDS.map(f => this.fetchOne(f)));
    return batches.flat();
  }

  private async fetchOne(feed: NewsFeed): Promise<NewsItem[]> {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
    try {
      const res = await fetch(feed.url, {
        headers: { 'User-Agent': UA, Accept: 'application/rss+xml, application/atom+xml, application/xml, text/xml, */*' },
        signal: ctrl.signal,
      });
      if (!res.ok) return [];
      return parseNewsItems(await res.text(), feed).slice(0, PER_FEED);
    } catch {
      return [];
    } finally {
      clearTimeout(timer);
    }
  }
}
