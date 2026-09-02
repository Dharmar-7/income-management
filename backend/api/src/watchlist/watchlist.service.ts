import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from '../prisma/prisma.service';
import { JobsService } from '../jobs/jobs.service';
import { NewsService } from '../news/news.service';
import { NotificationsService, isQuietHoursIST } from '../notifications/notifications.service';
import { WatchItemDto } from './dto/sync-watches.dto';

const SEEN_CAP = 400; // bound each watch's remembered id/link lists

// A "watch" follows one company/topic term across BOTH channels: new job
// postings (hourly) and fresh news (twice daily, aligned with the digest). Each
// watch keeps its own seen-sets; the first run per channel is a silent baseline
// so we never blast the existing backlog. Crons are hourly / 2×-day — never
// sub-hourly — to respect the Neon free-tier budget.
@Injectable()
export class WatchlistService {
  private readonly logger = new Logger(WatchlistService.name);

  constructor(
    private prisma: PrismaService,
    private jobs: JobsService,
    private news: NewsService,
    private notifications: NotificationsService,
  ) {}

  // Mirror the device's watch terms server-side. Upserts by (userId, clientId);
  // drops any the device no longer has.
  async sync(clerkId: string, items: WatchItemDto[]) {
    const userId = await this.prisma.resolveUserId(clerkId);
    const clientIds = items.map(i => i.clientId);

    await this.prisma.$transaction([
      ...items.map(i =>
        this.prisma.watch.upsert({
          where: { userId_clientId: { userId, clientId: i.clientId } },
          update: { term: i.term },
          create: { userId, clientId: i.clientId, term: i.term, seenJobIds: [], seenNewsLinks: [] },
        }),
      ),
      this.prisma.watch.deleteMany({
        where: { userId, clientId: { notIn: clientIds.length ? clientIds : ['__none__'] } },
      }),
    ]);
    return { ok: true, count: items.length };
  }

  async list(clerkId: string) {
    const userId = await this.prisma.resolveUserId(clerkId);
    return this.prisma.watch.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      select: { clientId: true, term: true },
    });
  }

  @Cron(CronExpression.EVERY_HOUR)
  async runJobWatch(): Promise<void> {
    const watches = await this.prisma.watch.findMany({
      include: { user: { select: { quietOvernight: true } } },
    });
    if (!watches.length) return;

    const quiet = isQuietHoursIST();
    for (const w of watches) {
      try {
        if (quiet && w.user.quietOvernight) continue; // hold overnight
        // Broad: the term as a keyword, no country restriction — Adzuna (India)
        // plus the worldwide remote boards. Covers company names and topics alike.
        const { jobs } = await this.jobs.search({ what: w.term, sortByDate: true });
        if (!jobs.length) continue;

        const ids = jobs.map(j => j.id);
        const merged = Array.from(new Set([...ids, ...w.seenJobIds])).slice(0, SEEN_CAP);

        if (!w.seenJobIds.length) {
          await this.prisma.watch.update({ where: { id: w.id }, data: { seenJobIds: merged } });
          continue;
        }

        const seen = new Set(w.seenJobIds);
        const fresh = jobs.filter(j => !seen.has(j.id));
        if (fresh.length) {
          const tokens = await this.notifications.tokensFor([w.userId]);
          await this.notifications.sendToTokens(tokens, {
            title: `👀 ${fresh.length} new ${w.term} job${fresh.length > 1 ? 's' : ''}`,
            body: fresh[0].title,
            data: { type: 'watch-jobs', clientId: w.clientId, term: w.term },
          });
        }

        await this.prisma.watch.update({
          where: { id: w.id },
          data: { seenJobIds: merged, lastNotifiedAt: fresh.length ? new Date() : w.lastNotifiedAt },
        });
      } catch (e) {
        this.logger.warn(`Watch job check failed for ${w.id}: ${(e as Error).message}`);
      }
    }
  }

  @Cron('0 8,20 * * *', { timeZone: 'Asia/Kolkata' })
  async runNewsWatch(): Promise<void> {
    const watches = await this.prisma.watch.findMany();
    if (!watches.length) return;

    const items = await this.news.fetchAll();
    if (!items.length) return;

    for (const w of watches) {
      try {
        const term = w.term.toLowerCase();
        const matched = items.filter(i => `${i.title} ${i.source}`.toLowerCase().includes(term));
        if (!matched.length) continue;

        const links = matched.map(i => i.link);
        const merged = Array.from(new Set([...links, ...w.seenNewsLinks])).slice(0, SEEN_CAP);

        if (!w.seenNewsLinks.length) {
          await this.prisma.watch.update({ where: { id: w.id }, data: { seenNewsLinks: merged } });
          continue;
        }

        const seen = new Set(w.seenNewsLinks);
        const fresh = matched.filter(i => !seen.has(i.link));
        if (fresh.length) {
          const tokens = await this.notifications.tokensFor([w.userId]);
          await this.notifications.sendToTokens(tokens, {
            title: `👀 ${fresh.length} ${w.term} ${fresh.length > 1 ? 'stories' : 'story'}`,
            body: fresh[0].title,
            data: { type: 'watch-news', clientId: w.clientId, term: w.term },
          });
        }

        await this.prisma.watch.update({
          where: { id: w.id },
          data: { seenNewsLinks: merged, lastNotifiedAt: fresh.length ? new Date() : w.lastNotifiedAt },
        });
      } catch (e) {
        this.logger.warn(`Watch news check failed for ${w.id}: ${(e as Error).message}`);
      }
    }
  }
}
