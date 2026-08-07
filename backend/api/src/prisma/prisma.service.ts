import { Injectable, Logger, OnModuleInit, NotFoundException } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit {
  private readonly logger = new Logger(PrismaService.name);

  // clerkId → internal User.id. This mapping never changes for a given user,
  // so we cache it in memory and skip a DB round-trip on every authenticated
  // request (previously every endpoint did its own user.findUnique first).
  private readonly userIdCache = new Map<string, string>();

  async onModuleInit() {
    // Connect eagerly so the first real request is fast — but NEVER block app
    // startup on it. If the DB is unreachable (e.g. Neon quota-suspended), an
    // awaited $connect() hangs onModuleInit → Nest never finishes booting → the
    // HTTP server never listens → even /health (no DB) stops responding, taking
    // the WHOLE API down over a DB-only outage. Prisma connects lazily on the
    // first query anyway, so swallowing a failure here is safe.
    this.$connect().catch(err =>
      this.logger.warn(`Initial DB connect failed (will retry lazily on first query): ${err.message}`),
    );
  }

  // Resolve our internal User.id from a Clerk user id, cached after first lookup.
  async resolveUserId(clerkId: string): Promise<string> {
    const cached = this.userIdCache.get(clerkId);
    if (cached) return cached;

    const user = await this.user.findUnique({
      where: { clerkId },
      select: { id: true },
    });
    if (!user) throw new NotFoundException('User not found. Please log in again.');

    this.userIdCache.set(clerkId, user.id);
    return user.id;
  }
}
