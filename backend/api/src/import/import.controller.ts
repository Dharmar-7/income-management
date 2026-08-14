import {
  Controller,
  Post,
  Body,
  UseGuards,
  UseInterceptors,
  UploadedFile,
  BadRequestException,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import { ImportService } from './import.service';
import { CommitStatementDto } from './dto/commit-statement.dto';
import { ClerkAuthGuard } from '../auth/clerk.guard';
import { CurrentUser } from '../auth/current-user.decorator';

@Controller('import')
@UseGuards(ClerkAuthGuard)  // all import routes require login
export class ImportController {
  constructor(private importService: ImportService) {}

  // POST /import/takeout
  // Accepts a JSON file, parses it, and imports transactions
  @Post('takeout')
  @UseInterceptors(
    FileInterceptor('file', {
      storage: memoryStorage(), // keep file in memory, don't write to disk
      limits: {
        fileSize: 50 * 1024 * 1024, // 50MB max
      },
      fileFilter: (_req, file, callback) => {
        // Only allow JSON files
        if (
          file.mimetype === 'application/json' ||
          file.originalname.endsWith('.json')
        ) {
          callback(null, true);
        } else {
          callback(
            new BadRequestException('Only JSON files are allowed.'),
            false,
          );
        }
      },
    }),
  )
  async uploadTakeout(
    @UploadedFile() file: Express.Multer.File,
    @CurrentUser() userId: string,
  ) {
    if (!file) {
      throw new BadRequestException('No file uploaded. Please attach a JSON file.');
    }

    const summary = await this.importService.importTakeout(file.buffer, userId);

    return {
      message: `Import complete. ${summary.imported} transactions imported.`,
      ...summary,
    };
  }

  // POST /import/statement/parse
  // Accepts a bank statement (text PDF or image), extracts transactions, and
  // returns them for review. Nothing is saved yet.
  @Post('statement/parse')
  @UseInterceptors(
    FileInterceptor('file', {
      storage: memoryStorage(),
      limits: { fileSize: 15 * 1024 * 1024 }, // 15MB max
      fileFilter: (_req, file, callback) => {
        if (file.mimetype === 'application/pdf' || file.mimetype.startsWith('image/')) {
          callback(null, true);
        } else {
          callback(
            new BadRequestException('Upload a PDF or an image (PNG/JPG).'),
            false,
          );
        }
      },
    }),
  )
  async parseStatement(
    @UploadedFile() file: Express.Multer.File,
    @CurrentUser() userId: string,
    // Optional multipart text field — the password for an encrypted PDF. Sent
    // only on the retry after the app is told the file is password-protected.
    @Body('password') password?: string,
  ) {
    if (!file) {
      throw new BadRequestException('No file uploaded. Please attach a PDF or image.');
    }
    return this.importService.parseStatement(file.buffer, file.mimetype, userId, password?.trim() || undefined);
  }

  // POST /import/statement/commit
  // Saves the rows the user kept after reviewing the parsed statement.
  @Post('statement/commit')
  async commitStatement(
    @Body() dto: CommitStatementDto,
    @CurrentUser() userId: string,
  ) {
    const summary = await this.importService.commitStatement(userId, dto.transactions, dto.bankId);
    return {
      message: `Imported ${summary.imported} transactions.`,
      ...summary,
    };
  }
}
