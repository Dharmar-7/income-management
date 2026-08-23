import { Module } from '@nestjs/common';
import { WatchlistController } from './watchlist.controller';
import { WatchlistService } from './watchlist.service';
import { JobsModule } from '../jobs/jobs.module';
import { NewsModule } from '../news/news.module';
import { NotificationsModule } from '../notifications/notifications.module';

@Module({
  imports: [JobsModule, NewsModule, NotificationsModule], // reuses the aggregator, fetcher, and push
  controllers: [WatchlistController],
  providers: [WatchlistService],
})
export class WatchlistModule {}
