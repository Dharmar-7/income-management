import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class UsersService {
  constructor(private prisma: PrismaService) {}

  // Called after login — finds existing user or creates a new one
  async findOrCreate(clerkId: string, email: string, name?: string) {
    return this.prisma.user.upsert({
      where: { clerkId },
      update: { email, name },   // keep email/name in sync if they change in Clerk
      create: { clerkId, email, name },
    });
  }

  async findByClerkId(clerkId: string) {
    return this.prisma.user.findUnique({ where: { clerkId } });
  }

  async updateSettings(
    clerkId: string,
    data: { monthStartDay?: number; stsBuffer?: number; stsDailyTarget?: number },
  ) {
    return this.prisma.user.update({
      where: { clerkId },
      data: {
        ...(data.monthStartDay !== undefined && { monthStartDay: data.monthStartDay }),
        ...(data.stsBuffer !== undefined && { stsBuffer: data.stsBuffer }),
        // 0 from the client clears the manual cap back to auto (stored as null).
        ...(data.stsDailyTarget !== undefined && {
          stsDailyTarget: data.stsDailyTarget > 0 ? data.stsDailyTarget : null,
        }),
      },
    });
  }
}
