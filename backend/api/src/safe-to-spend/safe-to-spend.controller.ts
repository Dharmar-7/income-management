import { Controller, Get, UseGuards } from '@nestjs/common';
import { SafeToSpendService } from './safe-to-spend.service';
import { ClerkAuthGuard } from '../auth/clerk.guard';
import { CurrentUser } from '../auth/current-user.decorator';

@Controller('safe-to-spend')
export class SafeToSpendController {
  constructor(private readonly service: SafeToSpendService) {}

  // GET /safe-to-spend — today's spendable number for the current pay cycle.
  @Get()
  @UseGuards(ClerkAuthGuard)
  get(@CurrentUser() clerkId: string) {
    return this.service.getSafeToSpend(clerkId);
  }
}
