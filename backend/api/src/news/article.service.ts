import { BadRequestException, Injectable, Logger, UnprocessableEntityException } from '@nestjs/common';
import { lookup } from 'node:dns/promises';
import { Article, checkArticleUrl, extractArticle, isPrivateAddress } from './article.util';

// Fetches a news page and returns its reader-view text (see article.util.ts).
// No database access: this costs no Neon compute.

const UA = 'Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Mobile Safari/537.36';
const TIMEOUT_MS = 10_000;
const MAX_BYTES = 3 * 1024 * 1024;
const MAX_REDIRECTS = 4;
const CACHE_TTL_MS = 6 * 60 * 60 * 1000;
const CACHE_MAX = 150;

@Injectable()
export class ArticleService {
  private readonly logger = new Logger(ArticleService.name);
  private readonly cache = new Map<string, { at: number; article: Article }>();

  async read(rawUrl: string): Promise<Article> {
    const start = checkArticleUrl(rawUrl);
    if (!start) throw new BadRequestException('That link can’t be opened in the reader.');

    const key = start.toString();
    const hit = this.cache.get(key);
    if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.article;

    const { html, finalUrl } = await this.fetchHtml(start);
    const article = extractArticle(html, finalUrl);
    if (!article || article.blocks.length === 0) {
      throw new UnprocessableEntityException('Couldn’t find the article text on that page.');
    }

    if (this.cache.size >= CACHE_MAX) this.cache.delete(this.cache.keys().next().value!);
    this.cache.set(key, { at: Date.now(), article });
    return article;
  }

  // Every hop is re-validated, so a public URL can't redirect us inward.
  private async assertPublicHost(u: URL): Promise<void> {
    let addrs: { address: string }[];
    try {
      addrs = await lookup(u.hostname, { all: true });
    } catch {
      throw new UnprocessableEntityException('Couldn’t reach that site.');
    }
    if (addrs.length === 0 || addrs.some(a => isPrivateAddress(a.address))) {
      throw new BadRequestException('That link can’t be opened in the reader.');
    }
  }

  private async fetchHtml(start: URL): Promise<{ html: string; finalUrl: string }> {
    let url = start;
    for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
      await this.assertPublicHost(url);
      let res: Response;
      try {
        res = await fetch(url, {
          redirect: 'manual',
          signal: AbortSignal.timeout(TIMEOUT_MS),
          headers: { 'User-Agent': UA, Accept: 'text/html,application/xhtml+xml', 'Accept-Language': 'en-IN,en;q=0.9' },
        });
      } catch {
        throw new UnprocessableEntityException('That site took too long to respond.');
      }

      if (res.status >= 300 && res.status < 400) {
        const next = checkArticleUrl(new URL(res.headers.get('location') ?? '', url).toString());
        if (!next) throw new UnprocessableEntityException('That site redirected somewhere we can’t open.');
        url = next;
        continue;
      }
      if (!res.ok) throw new UnprocessableEntityException(`That site refused the request (${res.status}).`);

      const type = res.headers.get('content-type') ?? '';
      if (!/html/i.test(type)) throw new UnprocessableEntityException('That link isn’t a web article.');

      const html = await this.readCapped(res, type);
      return { html, finalUrl: url.toString() };
    }
    throw new UnprocessableEntityException('Too many redirects.');
  }

  private async readCapped(res: Response, contentType: string): Promise<string> {
    const reader = res.body?.getReader();
    if (!reader) return '';
    const chunks: Uint8Array[] = [];
    let total = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > MAX_BYTES) { await reader.cancel(); break; } // keep what we have; the article is near the top
      chunks.push(value);
    }
    const charset = /charset=([\w-]+)/i.exec(contentType)?.[1] ?? 'utf-8';
    try {
      return new TextDecoder(charset).decode(Buffer.concat(chunks));
    } catch {
      this.logger.warn(`Unknown charset ${charset}; decoding as utf-8`);
      return new TextDecoder('utf-8').decode(Buffer.concat(chunks));
    }
  }
}
