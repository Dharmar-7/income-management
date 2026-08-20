import { Module } from '@nestjs/common';
import { ImportController } from './import.controller';
import { ImportService } from './import.service';
import { TakeoutParserService } from './takeout-parser.service';
import { CategorizerService } from './categorizer.service';
import { StatementParserService } from './statement-parser.service';
import { AuthModule } from '../auth/auth.module';

@Module({
  imports: [AuthModule],
  controllers: [ImportController],
  providers: [ImportService, TakeoutParserService, CategorizerService, StatementParserService],
  exports: [CategorizerService, StatementParserService],
})
export class ImportModule {}
