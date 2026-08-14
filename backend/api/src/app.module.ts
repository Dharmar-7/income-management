import { Module } from '@nestjs/common';
import { SentryModule, SentryGlobalFilter } from '@sentry/nestjs/setup';
import { ThrottlerModule, ThrottlerGuard } from '@nestjs/throttler';
import { ScheduleModule } from '@nestjs/schedule';
import { APP_FILTER, APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { LoggingInterceptor } from './common/logging.interceptor';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { HealthModule } from './health/health.module';
import { AuthModule } from './auth/auth.module';
import { PrismaModule } from './prisma/prisma.module';
import { UsersModule } from './users/users.module';
import { ImportModule } from './import/import.module';
import { TransactionsModule } from './transactions/transactions.module';
import { BudgetsModule } from './budgets/budgets.module';
import { ReportsModule } from './reports/reports.module';
import { CashModule } from './cash/cash.module';
import { SmsModule } from './sms/sms.module';
import { SavingsModule } from './savings/savings.module';
import { NotesModule } from './notes/notes.module';
import { RecurringModule } from './recurring/recurring.module';
import { LoansModule } from './loans/loans.module';
import { GoalsModule } from './goals/goals.module';
import { NetworthModule } from './networth/networth.module';
import { SettlementsModule } from './settlements/settlements.module';
import { CalendarModule } from './calendar/calendar.module';
import { StreaksModule } from './streaks/streaks.module';
import { DashboardModule } from './dashboard/dashboard.module';
import { DocumentsModule } from './documents/documents.module';
import { EventsModule } from './events/events.module';
import { HabitsModule } from './habits/habits.module';
import { BanksModule } from './banks/banks.module';
import { SafeToSpendModule } from './safe-to-spend/safe-to-spend.module';

@Module({
  imports: [
    // Sentry must come first so its filter wraps everything; it is a no-op
    // when SENTRY_DSN is unset (init in instrument.ts is skipped).
    SentryModule.forRoot(),
    ThrottlerModule.forRoot([{ ttl: 60000, limit: 100 }]),
    ScheduleModule.forRoot(),   // enables @Cron decorators
    PrismaModule,
    HealthModule,
    AuthModule,
    UsersModule,
    ImportModule,
    TransactionsModule,
    BudgetsModule,
    ReportsModule,
    CashModule,
    SmsModule,
    SavingsModule,
    NotesModule,
    RecurringModule,
    LoansModule,
    GoalsModule,
    NetworthModule,
    SettlementsModule,
    CalendarModule,
    StreaksModule,
    DashboardModule,
    DocumentsModule,
    EventsModule,
    HabitsModule,
    BanksModule,
    SafeToSpendModule,
  ],
  controllers: [AppController],
  providers: [
    AppService,
    // Report unhandled exceptions to Sentry (inert when SENTRY_DSN unset)
    { provide: APP_FILTER, useClass: SentryGlobalFilter },
    // Apply rate limiting globally to all routes
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    // Log every request with userId, method, path, and duration
    { provide: APP_INTERCEPTOR, useClass: LoggingInterceptor },
  ],
})
export class AppModule {}
