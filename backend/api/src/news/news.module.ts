import { Module } from '@nestjs/common';
import { NewsService } from './news.service';
import { NewsDigestService } from './news-digest.service';
import { ArticleService } from './article.service';
import { NewsController } from './news.controller';
import { NotificationsModule } from '../notifications/notifications.module';

@Module({
  imports: [NotificationsModule], // the digest pushes through it
  controllers: [NewsController],
  providers: [NewsService, NewsDigestService, ArticleService],
  exports: [NewsService], // WatchlistService reuses the fetcher
})
export class NewsModule {}
