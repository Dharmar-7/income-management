import { BadRequestException, Injectable } from '@nestjs/common';
import { StatementParserService } from '../import/statement-parser.service';
import { analyzeResume, AtsResult } from './ats.util';

@Injectable()
export class AtsService {
  // Reuses the statement importer's PDF/OCR text extraction — no new engine.
  constructor(private readonly parser: StatementParserService) {}

  // Stateless: extracts the resume text, scores it against the JD, returns the
  // report. Nothing is stored (no Prisma → no Neon).
  async review(
    fileBuffer: Buffer,
    mimetype: string,
    jobDescription?: string,
    jobTitle?: string,
  ): Promise<AtsResult & { jobTitle: string | null }> {
    const jd = (jobDescription ?? '').trim();
    if (jd.length < 40) {
      throw new BadRequestException(
        'Paste a fuller job description (a sentence or two at least) so we can compare it to your resume.',
      );
    }

    let resumeText: string;
    try {
      resumeText = await this.parser.extractText(fileBuffer, mimetype);
    } catch {
      throw new BadRequestException(
        'Could not read that resume file. Upload a text-based PDF (or a clear photo/scan).',
      );
    }

    return { ...analyzeResume(resumeText, jd), jobTitle: jobTitle?.trim() || null };
  }
}
