import {
  Controller, Get, Post, Delete,
  Param, Body, Query, UseGuards,
} from '@nestjs/common';
import { SettlementsService } from './settlements.service';
import { ClerkAuthGuard } from '../auth/clerk.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import { CreateSettlementDto, AddEntryDto, SettleDto } from './dto/create-settlement.dto';

@Controller('settlements')
@UseGuards(ClerkAuthGuard)
export class SettlementsController {
  constructor(private service: SettlementsService) {}

  @Get()
  findAll(@CurrentUser() clerkId: string) {
    return this.service.findAll(clerkId);
  }

  @Get('suggestions')
  getSuggestions(@CurrentUser() clerkId: string, @Query('txId') txId: string) {
    return this.service.getSuggestions(clerkId, txId);
  }

  @Post()
  create(@CurrentUser() clerkId: string, @Body() dto: CreateSettlementDto) {
    return this.service.create(clerkId, dto);
  }

  // Add another leg to a tab — another send (PRINCIPAL) or a return (REPAYMENT).
  @Post(':id/entries')
  addEntry(@CurrentUser() clerkId: string, @Param('id') id: string, @Body() dto: AddEntryDto) {
    return this.service.addEntry(clerkId, id, dto);
  }

  // Remove one leg (restores its linked transaction's type).
  @Delete(':id/entries/:entryId')
  removeEntry(
    @CurrentUser() clerkId: string,
    @Param('id') id: string,
    @Param('entryId') entryId: string,
  ) {
    return this.service.removeEntry(clerkId, id, entryId);
  }

  @Post(':id/settle')
  settle(@CurrentUser() clerkId: string, @Param('id') id: string, @Body() dto: SettleDto) {
    return this.service.settle(clerkId, id, dto);
  }

  @Delete(':id')
  cancel(@CurrentUser() clerkId: string, @Param('id') id: string) {
    return this.service.cancel(clerkId, id);
  }
}
