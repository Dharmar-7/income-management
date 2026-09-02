import { Module } from '@nestjs/common';
import { MoneyAlertsService } from './money-alerts.service';
import { NotificationsModule } from '../notifications/notifications.module';

@Module({
  imports: [NotificationsModule], // pushes through it
  providers: [MoneyAlertsService],
})
export class MoneyAlertsModule {}
