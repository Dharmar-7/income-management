import { Body, Controller, Get, Post, Query, UseGuards } from '@nestjs/common';
import { JobsService } from './jobs.service';
import { JobAlertsService } from './job-alerts.service';
import { SearchJobsDto } from './dto/search-jobs.dto';
import { SyncSearchesDto } from './dto/sync-searches.dto';
import { ClerkAuthGuard } from '../auth/clerk.guard';
import { CurrentUser } from '../auth/current-user.decorator';

// Auth-guarded (JWT only, no DB lookup) so this never becomes an open proxy that
// burns our Adzuna quota. Search results aren't user-specific; saved-search sync is.
@Controller('jobs')
@UseGuards(ClerkAuthGuard)
export class JobsController {
  constructor(
    private readonly jobs: JobsService,
    private readonly alerts: JobAlertsService,
  ) {}

  @Get()
  search(@Query() dto: SearchJobsDto) {
    return this.jobs.search(dto);
  }

  // The app mirrors its saved searches here so the hourly cron can alert on new matches.
  @Post('searches/sync')
  syncSearches(@CurrentUser() clerkId: string, @Body() dto: SyncSearchesDto) {
    return this.alerts.syncSearches(clerkId, dto.searches);
  }
}
