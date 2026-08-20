import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { JobsService } from './jobs.service';
import { SearchJobsDto } from './dto/search-jobs.dto';
import { ClerkAuthGuard } from '../auth/clerk.guard';

// Auth-guarded (JWT only, no DB lookup) so this never becomes an open proxy that
// burns our Adzuna quota. Jobs aren't user-specific, so no @CurrentUser needed.
@Controller('jobs')
@UseGuards(ClerkAuthGuard)
export class JobsController {
  constructor(private readonly jobs: JobsService) {}

  @Get()
  search(@Query() dto: SearchJobsDto) {
    return this.jobs.search(dto);
  }
}
