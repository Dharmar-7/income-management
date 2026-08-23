import { Body, Controller, Get, Post, UseGuards } from '@nestjs/common';
import { WatchlistService } from './watchlist.service';
import { SyncWatchesDto } from './dto/sync-watches.dto';
import { ClerkAuthGuard } from '../auth/clerk.guard';
import { CurrentUser } from '../auth/current-user.decorator';

@Controller('watchlist')
@UseGuards(ClerkAuthGuard)
export class WatchlistController {
  constructor(private readonly watchlist: WatchlistService) {}

  @Get()
  list(@CurrentUser() clerkId: string) {
    return this.watchlist.list(clerkId);
  }

  // The app mirrors its watched terms here so the crons can alert on new matches.
  @Post('sync')
  sync(@CurrentUser() clerkId: string, @Body() dto: SyncWatchesDto) {
    return this.watchlist.sync(clerkId, dto.watches);
  }
}
