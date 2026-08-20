import {
  BadRequestException, Body, Controller, Post, UploadedFile, UseGuards, UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import { AtsService } from './ats.service';
import { ClerkAuthGuard } from '../auth/clerk.guard';

@Controller('ats')
@UseGuards(ClerkAuthGuard)
export class AtsController {
  constructor(private readonly ats: AtsService) {}

  // POST /ats/review — multipart: `file` (resume PDF/image) + `jobDescription`
  // text field (+ optional `jobTitle`). Returns the ATS score + suggestions.
  @Post('review')
  @UseInterceptors(
    FileInterceptor('file', {
      storage: memoryStorage(),
      limits: { fileSize: 10 * 1024 * 1024 }, // 10MB
      fileFilter: (_req, file, cb) => {
        if (file.mimetype === 'application/pdf' || file.mimetype.startsWith('image/')) cb(null, true);
        else cb(new BadRequestException('Upload your resume as a PDF or an image.'), false);
      },
    }),
  )
  async review(
    @UploadedFile() file: Express.Multer.File,
    @Body('jobDescription') jobDescription?: string,
    @Body('jobTitle') jobTitle?: string,
  ) {
    if (!file) throw new BadRequestException('Attach your resume (PDF or image).');
    return this.ats.review(file.buffer, file.mimetype, jobDescription, jobTitle);
  }
}
