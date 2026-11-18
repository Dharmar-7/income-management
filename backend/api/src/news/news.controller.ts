import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { ClerkAuthGuard } from '../auth/clerk.guard';
import { ArticleService } from './article.service';

@Controller('news')
@UseGuards(ClerkAuthGuard)
export class NewsController {
  constructor(private readonly articles: ArticleService) {}

  // GET /news/article?url=<article link> — reader-view text for the app.
  @Get('article')
  article(@Query('url') url = '') {
    return this.articles.read(url);
  }
}
