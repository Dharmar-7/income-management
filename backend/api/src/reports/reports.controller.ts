import {
  Controller,
  Get,
  Query,
  UseGuards,
  StreamableFile,
} from '@nestjs/common';
import { ReportsService } from './reports.service';
import { ClerkAuthGuard } from '../auth/clerk.guard';
import { CurrentUser } from '../auth/current-user.decorator';

function toInt(val: string | undefined, fallback: number): number {
  const n = parseInt(val ?? '', 10);
  return isNaN(n) ? fallback : n;
}

@Controller('reports')
@UseGuards(ClerkAuthGuard)
export class ReportsController {
  constructor(private service: ReportsService) {}

  // GET /reports/monthly?month=4&year=2026
  @Get('monthly')
  getMonthly(
    @CurrentUser() userId: string,
    @Query('month') month?: string,
    @Query('year') year?: string,
  ) {
    return this.service.getMonthlyReport(
      userId,
      month ? toInt(month, undefined!) : undefined,
      year ? toInt(year, undefined!) : undefined,
    );
  }

  // GET /reports/annual?year=2026
  @Get('annual')
  getAnnual(@CurrentUser() userId: string, @Query('year') year?: string) {
    return this.service.getAnnualReport(
      userId,
      year ? toInt(year, undefined!) : undefined,
    );
  }

  // GET /reports/category-averages?months=3
  // Average monthly spend per category — powers the Safety Net runway.
  @Get('category-averages')
  getCategoryAverages(
    @CurrentUser() userId: string,
    @Query('months') months?: string,
  ) {
    return this.service.getCategoryAverages(userId, months ? toInt(months, 3) : 3);
  }

  // GET /reports/export?month=4&year=2026
  // Returns a CSV file — StreamableFile tells NestJS to send raw bytes, not JSON
  @Get('export')
  async exportCsv(
    @CurrentUser() userId: string,
    @Query('month') month?: string,
    @Query('year') year?: string,
  ): Promise<StreamableFile> {
    const m = month ? toInt(month, undefined!) : undefined;
    const y = year ? toInt(year, undefined!) : undefined;
    const csv = await this.service.generateCsv(userId, m, y);

    const now = new Date();
    const label = m
      ? `${y ?? now.getFullYear()}-${String(m).padStart(2, '0')}`
      : String(y ?? now.getFullYear());

    return new StreamableFile(Buffer.from(csv, 'utf-8'), {
      type: 'text/csv; charset=utf-8',
      disposition: `attachment; filename="transactions-${label}.csv"`,
    });
  }
}
