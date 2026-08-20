import { Module } from '@nestjs/common';
import { AtsController } from './ats.controller';
import { AtsService } from './ats.service';
import { ImportModule } from '../import/import.module';

@Module({
  imports: [ImportModule], // for StatementParserService (PDF/OCR text extraction)
  controllers: [AtsController],
  providers: [AtsService],
})
export class AtsModule {}
