import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from '../prisma/prisma.service';
import { JobsService } from './jobs.service';
import { NotificationsService } from '../notifications/notifications.service';
import { SearchJobsDto } from './dto/search-jobs.dto';
import { SyncSearchItemDto } from './dto/sync-searches.dto';

const SEEN_CAP = 400; // keep each search's remembered id list bounded

@Injectable()
export class JobAlertsService {
  private readonly logger = new Logger(JobAlertsService.name);

  constructor(
    private prisma: PrismaService,
    private jobs: JobsService,
    private notifications: NotificationsService,
  ) {}

  // Mirror the device's saved searches server-side so the hourly cron can re-run
  // them even when the app is closed. Upserts by (userId, clientId); drops any
  // the device no longer has.
  async syncSearches(clerkId: string, items: SyncSearchItemDto[]) {
    const userId = await this.prisma.resolveUserId(clerkId);
    const clientIds = items.map(i => i.clientId);

    await this.prisma.$transaction([
      ...items.map(i =>
        this.prisma.savedJobSearch.upsert({
          where: { userId_clientId: { userId, clientId: i.clientId } },
          update: {
            label: i.label, what: i.what, company: i.company ?? null,
            where: i.where ?? null, level: i.level ?? null, type: i.type ?? null, salaryMin: i.salaryMin ?? null,
          },
          create: {
            userId, clientId: i.clientId, label: i.label, what: i.what, company: i.company ?? null,
            where: i.where ?? null, level: i.level ?? null, type: i.type ?? null, salaryMin: i.salaryMin ?? null,
            seenJobIds: [],
          },
        }),
      ),
      this.prisma.savedJobSearch.deleteMany({
        where: { userId, clientId: { notIn: clientIds.length ? clientIds : ['__none__'] } },
      }),
    ]);
    return { ok: true, count: items.length };
  }

  private toDto(s: { what: string; company: string | null; where: string | null; level: string | null; type: string | null; salaryMin: number | null }): SearchJobsDto {
    const dto: SearchJobsDto = { what: s.what, sortByDate: true };
    if (s.company) dto.company = s.company;
    if (s.where === 'remote') dto.remote = true;
    else if (s.where) dto.country = s.where;
    if (s.level === 'senior' || s.level === 'mid' || s.level === 'junior') dto.level = s.level;
    if (s.type === 'full_time' || s.type === 'part_time' || s.type === 'contract' || s.type === 'internship') dto.type = s.type;
    if (s.salaryMin != null) dto.salaryMin = s.salaryMin;
    return dto;
  }

  // Hourly (not sub-hourly — protects the Neon free-tier budget). Re-runs every
  // saved search and pushes new matches. The FIRST run per search only records a
  // baseline, so we never blast the whole existing backlog as "new".
  @Cron(CronExpression.EVERY_HOUR)
  async runAlerts(): Promise<void> {
    const searches = await this.prisma.savedJobSearch.findMany({
      include: { user: { select: { notifyJobs: true } } },
    });
    if (!searches.length) return;

    for (const s of searches) {
      try {
        if (!s.user.notifyJobs) continue;

        const { jobs } = await this.jobs.search(this.toDto(s));
        if (!jobs.length) continue;

        const ids = jobs.map(j => j.id);
        const merged = Array.from(new Set([...ids, ...s.seenJobIds])).slice(0, SEEN_CAP);

        // First run → establish the baseline silently.
        if (!s.seenJobIds.length) {
          await this.prisma.savedJobSearch.update({ where: { id: s.id }, data: { seenJobIds: merged } });
          continue;
        }

        const seen = new Set(s.seenJobIds);
        const fresh = jobs.filter(j => !seen.has(j.id));

        if (fresh.length) {
          const tokens = await this.notifications.tokensFor([s.userId]);
          await this.notifications.sendToTokens(tokens, {
            title: `🆕 ${fresh.length} new ${s.label} job${fresh.length > 1 ? 's' : ''}`,
            body: fresh[0].title,
            data: { type: 'jobs', clientId: s.clientId },
          });
        }

        await this.prisma.savedJobSearch.update({
          where: { id: s.id },
          data: { seenJobIds: merged, lastNotifiedAt: fresh.length ? new Date() : s.lastNotifiedAt },
        });
      } catch (e) {
        this.logger.warn(`Job alert failed for search ${s.id}: ${(e as Error).message}`);
      }
    }
  }
}
