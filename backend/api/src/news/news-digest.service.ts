import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { PrismaService } from '../prisma/prisma.service';
import { NewsService } from './news.service';
import { NotificationsService } from '../notifications/notifications.service';
import { NewsCategory } from './news.util';

const ALL_CATS: NewsCategory[] = ['markets', 'tech', 'science'];
const PRUNE_DAYS = 7;

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

        const counts = new Map<NewsCategory, number>();
        for (const i of mine) counts.set(i.category, (counts.get(i.category) ?? 0) + 1);
        const parts = [...counts.entries()].map(([c, n]) => `${n} ${c}`);

        const tokens = await this.notifications.tokensFor([user.id]);
        await this.notifications.sendToTokens(tokens, {
          title: `🗞️ Your briefing — ${mine.length} new ${mine.length > 1 ? 'stories' : 'story'}`,
          body: `${parts.join(' · ')}\n${mine[0].title}`,
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
