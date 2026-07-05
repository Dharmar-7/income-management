import { Controller, Get } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Controller('health')
export class HealthController {
  constructor(private prisma: PrismaService) {}

  @Get()
  check() {
    return {
      status: 'ok',
      timestamp: new Date().toISOString(),
    };
  }

  // Deep check — touches the database so an external uptime pinger keeps BOTH
  // the Render instance AND the Neon compute awake. Without the SELECT 1, Neon
  // auto-suspends after idle and the first real query of the day pays the
  // multi-second resume cost users see as "slow first login".
  @Get('deep')
  async deep() {
    const start = Date.now();
    await this.prisma.$queryRaw`SELECT 1`;
    return {
      status: 'ok',
      dbLatencyMs: Date.now() - start,
      timestamp: new Date().toISOString(),
    };
  }
}
