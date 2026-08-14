import { Module } from '@nestjs/common';
import { SafeToSpendController } from './safe-to-spend.controller';
import { SafeToSpendService } from './safe-to-spend.service';

@Module({
  controllers: [SafeToSpendController],
  providers: [SafeToSpendService],
})
export class SafeToSpendModule {}
