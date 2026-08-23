import { Module } from '@nestjs/common';
import { JobsController } from './jobs.controller';
import { JobsService } from './jobs.service';
import { JobAlertsService } from './job-alerts.service';
import { NotificationsModule } from '../notifications/notifications.module';

@Module({
  imports: [NotificationsModule], // JobAlertsService pushes through it
  controllers: [JobsController],
  providers: [JobsService, JobAlertsService],
  exports: [JobsService], // WatchlistService reuses the aggregator
})
export class JobsModule {}
