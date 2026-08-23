import { Module } from '@nestjs/common';
import { NewsService } from './news.service';
import { NewsDigestService } from './news-digest.service';
import { NotificationsModule } from '../notifications/notifications.module';

@Module({
  imports: [NotificationsModule], // the digest pushes through it
  providers: [NewsService, NewsDigestService],
  exports: [NewsService], // WatchlistService reuses the fetcher
})
export class NewsModule {}
