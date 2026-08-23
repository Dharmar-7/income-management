import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

const EXPO_PUSH_URL = 'https://exp.host/--/api/v2/push/send';

export interface PushMessage {
  title: string;
  body: string;
  data?: Record<string, unknown>;
}

@Injectable()
export class NotificationsService {
  private readonly logger = new Logger(NotificationsService.name);
  constructor(private prisma: PrismaService) {}

  // A push token is globally unique to one device. Upsert and (re)point it at
  // whoever is signed in now — handles a device being handed to a new account.
  async registerToken(clerkId: string, token: string, platform?: string) {
    const userId = await this.prisma.resolveUserId(clerkId);
    await this.prisma.pushToken.upsert({
      where: { token },
      update: { userId, platform },
      create: { token, platform, userId },
    });
    return { ok: true };
  }

  async removeToken(token: string) {
    await this.prisma.pushToken.deleteMany({ where: { token } });
    return { ok: true };
  }

  // ── Notification preferences ──
  async getPrefs(clerkId: string) {
    const userId = await this.prisma.resolveUserId(clerkId);
    const u = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { notifyJobs: true, notifyNews: true, newsCategories: true },
    });
    return u ?? { notifyJobs: true, notifyNews: false, newsCategories: [] };
  }

  async updatePrefs(
    clerkId: string,
    dto: { notifyJobs?: boolean; notifyNews?: boolean; newsCategories?: string[] },
  ) {
    const userId = await this.prisma.resolveUserId(clerkId);
    return this.prisma.user.update({
      where: { id: userId },
      data: {
        ...(dto.notifyJobs !== undefined ? { notifyJobs: dto.notifyJobs } : {}),
        ...(dto.notifyNews !== undefined ? { notifyNews: dto.notifyNews } : {}),
        ...(dto.newsCategories !== undefined ? { newsCategories: dto.newsCategories } : {}),
      },
      select: { notifyJobs: true, notifyNews: true, newsCategories: true },
    });
  }

  async tokensFor(userIds: string[]): Promise<string[]> {
    if (!userIds.length) return [];
    const rows = await this.prisma.pushToken.findMany({
      where: { userId: { in: userIds } },
      select: { token: true },
    });
    return rows.map(r => r.token);
  }

  // Send one message to many tokens via Expo's free push service. Chunks to 100
  // (Expo's per-request cap) and prunes tokens Expo reports as unregistered.
  async sendToTokens(tokens: string[], msg: PushMessage): Promise<void> {
    const valid = tokens.filter(t => t?.startsWith('ExponentPushToken'));
    if (!valid.length) return;

    for (let i = 0; i < valid.length; i += 100) {
      const chunk = valid.slice(i, i + 100);
      const messages = chunk.map(to => ({
        to,
        title: msg.title,
        body: msg.body,
        data: msg.data ?? {},
        sound: 'default',
        priority: 'high',
        channelId: 'default',
      }));
      try {
        const res = await fetch(EXPO_PUSH_URL, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
          body: JSON.stringify(messages),
        });
        const json = (await res.json().catch(() => null)) as
          | { data?: { status: string; details?: { error?: string } }[] }
          | null;
        if (json?.data) await this.pruneInvalid(chunk, json.data);
      } catch (e) {
        this.logger.warn(`Expo push failed: ${(e as Error).message}`);
      }
    }
  }

  // Delete tokens Expo says are dead so we stop wasting sends on them.
  private async pruneInvalid(
    tokens: string[],
    receipts: { status: string; details?: { error?: string } }[],
  ): Promise<void> {
    const dead = receipts
      .map((r, i) => (r.status === 'error' && r.details?.error === 'DeviceNotRegistered' ? tokens[i] : null))
      .filter((t): t is string => !!t);
    if (dead.length) await this.prisma.pushToken.deleteMany({ where: { token: { in: dead } } });
  }
}
