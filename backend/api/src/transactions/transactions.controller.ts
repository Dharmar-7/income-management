import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Param,
  Query,
  Body,
  UseGuards,
} from '@nestjs/common';
import { TransactionsService } from './transactions.service';
import { ClerkAuthGuard } from '../auth/clerk.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import { TransactionType } from '@prisma/client';
import { UpdateTransactionDto } from './dto/update-transaction.dto';
import { CreateTransactionDto } from './dto/create-transaction.dto';

// Helper to safely parse integers from query params
function toInt(val: string | undefined, fallback: number): number {
  const n = parseInt(val ?? '', 10);
  return isNaN(n) ? fallback : n;
}

@Controller('transactions')
@UseGuards(ClerkAuthGuard)
export class TransactionsController {
  constructor(private service: TransactionsService) {}

  // GET /transactions?page=1&limit=20&search=swiggy&type=DEBIT&sortBy=date&sortOrder=desc
  @Get()
  findAll(
    @CurrentUser() userId: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
    @Query('search') search?: string,
    @Query('categoryId') categoryId?: string,
    @Query('type') type?: string,
    @Query('dateFrom') dateFrom?: string,
    @Query('dateTo') dateTo?: string,
    @Query('sortBy') sortBy?: string,
    @Query('sortOrder') sortOrder?: string,
  ) {
    // Get the internal userId from our DB using clerkId
    return this.service.findAll(userId, {
      page: toInt(page, 1),
      limit: Math.min(toInt(limit, 20), 100), // max 100 per page
      search,
      categoryId,
      type: type as TransactionType | undefined,
      dateFrom: dateFrom ? new Date(dateFrom) : undefined,
      dateTo: dateTo ? new Date(dateTo) : undefined,
      sortBy: (sortBy === 'amount' ? 'amount' : 'date') as 'date' | 'amount',
      sortOrder: (sortOrder === 'asc' ? 'asc' : 'desc') as 'asc' | 'desc',
    });
  }

  // GET /transactions/summary?month=4&year=2026
  @Get('summary')
  getSummary(
    @CurrentUser() userId: string,
    @Query('month') month?: string,
    @Query('year') year?: string,
  ) {
    return this.service.getSummary(
      userId,
      month ? toInt(month, undefined!) : undefined,
      year ? toInt(year, undefined!) : undefined,
    );
  }

  // GET /transactions/by-category?month=4&year=2026
  @Get('by-category')
  getByCategory(
    @CurrentUser() userId: string,
    @Query('month') month?: string,
    @Query('year') year?: string,
  ) {
    return this.service.getByCategory(
      userId,
      month ? toInt(month, undefined!) : undefined,
      year ? toInt(year, undefined!) : undefined,
    );
  }

  // GET /transactions/by-month
  @Get('by-month')
  getByMonth(@CurrentUser() userId: string) {
    return this.service.getByMonth(userId);
  }

  // GET /transactions/history?months=12 — compact rows for on-device analysis
  // (Velora Brain). Declared before ':id' so 'history' isn't read as an id.
  @Get('history')
  getHistory(@CurrentUser() userId: string, @Query('months') months?: string) {
    return this.service.getHistory(userId, toInt(months, 12));
  }

  // GET /transactions/categories — list all categories for dropdown
  @Get('categories')
  getCategories() {
    return this.service.getCategories();
  }

  // GET /transactions/:id — single transaction detail
  @Get(':id')
  findOne(@CurrentUser() userId: string, @Param('id') id: string) {
    return this.service.findOne(userId, id);
  }

  // PATCH /transactions/:id — update category or note
  @Patch(':id')
  update(
    @CurrentUser() userId: string,
    @Param('id') id: string,
    @Body() body: UpdateTransactionDto,
  ) {
    return this.service.update(userId, id, body);
  }

  // POST /transactions — manually add a transaction
  @Post()
  create(
    @CurrentUser() userId: string,
    @Body() body: CreateTransactionDto,
  ) {
    return this.service.create(userId, body);
  }

  // DELETE /transactions/:id — only works for MANUAL transactions
  @Delete(':id')
  remove(@CurrentUser() userId: string, @Param('id') id: string) {
    return this.service.remove(userId, id);
  }
}
