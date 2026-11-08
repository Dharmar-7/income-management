import { Controller, Post, Get, Body, UseGuards } from '@nestjs/common';
import { SmsSyncService } from './sms-sync.service';
import { ClerkAuthGuard } from '../auth/clerk.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import { RawSms } from './sms-parser.service';
import { IsArray, ArrayMaxSize, ValidateNested, IsString, IsNumber } from 'class-validator';
import { Type } from 'class-transformer';

class RawSmsDto implements RawSms {
  @IsString()
  body: string;

  @IsNumber()
  date: number;

  @IsString()
  address: string;
}

class SmsSyncDto {
  @IsArray()
  @ArrayMaxSize(5000) // the app pre-filters to bank-looking SMS, so this is generous
  @ValidateNested({ each: true })
  @Type(() => RawSmsDto)
  messages: RawSmsDto[];
}

@Controller('sms')
@UseGuards(ClerkAuthGuard)
export class SmsController {
  constructor(private service: SmsSyncService) {}

  // GET /sms/last-sync — mobile calls this first to know from what date to read
  @Get('last-sync')
  async getLastSync(@CurrentUser() userId: string) {
    const date = await this.service.getLastSyncDate(userId);
    // If never synced: go back 90 days
    const since = date ?? new Date(Date.now() - 90 * 24 * 60 * 60 * 1000);
    return { since: since.toISOString(), sinceMs: since.getTime() };
  }

  // POST /sms/sync — mobile sends raw SMS messages, backend parses + deduplicates
  @Post('sync')
  sync(@CurrentUser() userId: string, @Body() body: SmsSyncDto) {
    return this.service.sync(userId, body.messages);
  }
}
