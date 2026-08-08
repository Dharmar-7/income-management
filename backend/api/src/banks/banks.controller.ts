import { Controller, Get, Post, Patch, Delete, Body, Param, UseGuards } from '@nestjs/common';
import { BanksService } from './banks.service';
import { ClerkAuthGuard } from '../auth/clerk.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import { CreateBankDto } from './dto/create-bank.dto';
import { UpdateBankDto } from './dto/update-bank.dto';

@Controller('banks')
@UseGuards(ClerkAuthGuard)
export class BanksController {
  constructor(private service: BanksService) {}

  @Get()
  findAll(@CurrentUser() clerkId: string) {
    return this.service.findAll(clerkId);
  }

  @Post()
  create(@CurrentUser() clerkId: string, @Body() dto: CreateBankDto) {
    return this.service.create(clerkId, dto);
  }

  @Patch(':id')
  update(@CurrentUser() clerkId: string, @Param('id') id: string, @Body() dto: UpdateBankDto) {
    return this.service.update(clerkId, id, dto);
  }

  @Delete(':id')
  remove(@CurrentUser() clerkId: string, @Param('id') id: string) {
    return this.service.remove(clerkId, id);
  }
}
