import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { PrismaService } from '../prisma/prisma.service';
import { NewsService } from './news.service';
import { NotificationsService } from '../notifications/notifications.service';
import { NewsCategory } from './news.util';

const ALL_CATS: NewsCategory[] = ['markets', 'tech', 'science'];
const PRUNE_DAYS = 7;
const HEADLINES = 3; // how many headlines to show in the digest body

// Pick up to `n` headlines, round-robin across the categories present, so a
// high-volume desk (markets) can't crowd out tech/science in the preview.
function balancedHeadlines(items: { title: string; category: NewsCategory }[], n: number): string[] {
  const byCat = new Map<NewsCategory, string[]>();
  for (const i of items) {
    const arr = byCat.get(i.category) ?? [];
    arr.push(i.title);
    byCat.set(i.category, arr);
  }
  const cats = [...byCat.keys()];
  const picked: string[] = [];
  let idx = 0;
  while (picked.length < n && cats.some(c => (byCat.get(c)?.length ?? 0) > 0)) {
    const arr = byCat.get(cats[idx % cats.length]);
    if (arr && arr.length) picked.push(arr.shift()!);
    idx++;
  }
  return picked;
}

@Injectable()
export class NewsDigestService {
  private readonly logger = new Logger(NewsDigestService.name);

  constructor(
    private prisma: PrismaService,
    private news: NewsService,
    private notifications: NotificationsService,
  ) {}

  // A morning + evening briefing (IST) — a digest of what's NEW since last run,
  // never one-notification-per-headline. Skips the whole fetch if nobody opted in.
  @Cron('0 8,20 * * *', { timeZone: 'Asia/Kolkata' })
  async sendDigest(): Promise<void> {
    const opted = await this.prisma.user.findMany({
      where: { notifyNews: true },
      select: { id: true, newsCategories: true },
    });
    if (!opted.length) return;

    const items = await this.news.fetchAll();
    if (!items.length) return;

    const links = items.map(i => i.link);
    const existing = await this.prisma.newsSeen.findMany({
      where: { link: { in: links } },
      select: { link: true },
    });
    const seen = new Set(existing.map(e => e.link));
    const fresh = items.filter(i => !seen.has(i.link));

    const priorCount = await this.prisma.newsSeen.count();
    if (fresh.length) {
      await this.prisma.newsSeen.createMany({
        data: fresh.map(i => ({ link: i.link })),
        skipDuplicates: true,
      });
    }

    // First-ever run → just seed the baseline; don't blast the existing backlog.
    if (priorCount === 0 || !fresh.length) {
      await this.prune();
      return;
    }

    for (const user of opted) {
      try {
        const cats = (user.newsCategories.length ? user.newsCategories : ALL_CATS) as NewsCategory[];
        const mine = fresh.filter(i => cats.includes(i.category));
        if (!mine.length) continue;

        const headlines = balancedHeadlines(mine, HEADLINES);
        const more = mine.length - headlines.length;
        const body = headlines.map(h => `• ${h}`).join('\n') + (more > 0 ? `\n…and ${more} more` : '');

        const tokens = await this.notifications.tokensFor([user.id]);
        await this.notifications.sendToTokens(tokens, {
          title: `🗞️ Your briefing — ${mine.length} new ${mine.length > 1 ? 'stories' : 'story'}`,
          body,
          data: { type: 'news' },
        });
        await this.prisma.user.update({ where: { id: user.id }, data: { newsDigestAt: new Date() } });
      } catch (e) {
        this.logger.warn(`News digest failed for user ${user.id}: ${(e as Error).message}`);
      }
    }

    await this.prune();
  }

  private async prune(): Promise<void> {
    const cutoff = new Date(Date.now() - PRUNE_DAYS * 86_400_000);
    await this.prisma.newsSeen.deleteMany({ where: { seenAt: { lt: cutoff } } }).catch(() => {});
  }
}
