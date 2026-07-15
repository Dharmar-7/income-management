import { Injectable, BadRequestException, Logger } from '@nestjs/common';
import { TransactionType } from '@prisma/client';

// pdf-parse v2 dropped v1's default-function export in favour of a PDFParse class
// (require('pdf-parse')() throws "pdfParse is not a function"). We require + destructure
// with an inline type so TypeScript doesn't need the package's "exports" map resolved.
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { PDFParse } = require('pdf-parse') as {
  PDFParse: new (opts: { data: Uint8Array; password?: string }) => {
    getText(): Promise<{ text: string; total?: number }>;
    getScreenshot(params?: {
      desiredWidth?: number;
      imageBuffer?: boolean;
      imageDataUrl?: boolean;
      first?: number; // render only pages 1..first
    }): Promise<{ pages: { data: Uint8Array }[] }>;
    destroy(): Promise<void>;
  };
};

export interface ParsedStatementTxn {
  date: string; // YYYY-MM-DD
  merchant: string;
  amount: number;
  type: TransactionType; // the parser only ever emits DEBIT or CREDIT
  description?: string;
  upiRef?: string;
  balance?: number;
}

/**
 * Free, offline bank-statement reader.
 *  - Text PDFs  → extracted with pdf-parse.
 *  - Images/photos/screenshots → OCR'd with Tesseract (open-source, on-server).
 * The extracted text is then parsed into transaction rows with heuristics tuned
 * for Indian bank statements. Extraction is best-effort — the mobile app shows a
 * review screen so the user fixes/deselects rows before anything is saved.
 */
@Injectable()
export class StatementParserService {
  private readonly logger = new Logger(StatementParserService.name);

  private readonly MONTHS: Record<string, number> = {
    jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6,
    jul: 7, aug: 8, sep: 9, sept: 9, oct: 10, nov: 11, dec: 12,
  };

  // A transaction date at the START of a line. Two shapes seen across banks:
  // dd-MMM-yy (IOB, e.g. "14-Jun-26") and dd-mm-yyyy (TMB, e.g. "29-05-2026").
  // Separators may be -, /, ".", or a space (OCR turns "14-Jun-26" into "14 Jun 26").
  private readonly DATE_LEAD =
    /^(\d{1,2}[-/ ][A-Za-z]{3,4}[-/ ]\d{2,4}|\d{1,2}[-/.]\d{1,2}[-/.]\d{2,4})\b/;
  // A bracketed value-date at the start of a line, e.g. "(14-Jun-26)".
  private readonly VDATE_LEAD = /^\((\d{1,2}[-/ ][A-Za-z]{3,4}[-/ ]\d{2,4})\)\s*/;
  // A trailing run of ≥2 amount "cells" — money (1234.56 / 1,234.56) or a "-" placeholder
  // for an empty debit/credit column, e.g. "- 6.00 7,948.80", "100.00 - 7,942.80" (IOB
  // 3-column) or "70.00 672.88" (TMB: amount + balance, no placeholder).
  private readonly AMOUNTS_TAIL =
    /((?:-|\d[\d,]*\.\d{2})(?:\s+(?:-|\d[\d,]*\.\d{2}))+)\s*$/;
  // Lines that are headers/footers/totals, never transaction rows.
  private readonly SKIP_LINE =
    /(opening balance|closing balance|statement (of|for)|account (no|holder|number)|customer id|ifsc|ifs code|micr code|branch (name|address|code)|phone no|contact no|e-?mail id|a\/c type|page \d+ of|effective available|computer generated|auto generated|authenticated|regd address|report generation|never share|^particulars\b|transaction\s*type|chq\.?\s*no|withdrawals|deposits|debit\(rs\)|balance\(inr\))/i;

  // Render's free tier has 512 MB RAM and 0.1 CPU — OCR cost must stay bounded
  // or the instance OOMs / the gateway kills the request at ~100 s.
  private readonly MAX_OCR_PAGES = 6;

  async parse(buffer: Buffer, mimetype: string): Promise<ParsedStatementTxn[]> {
    this.logger.log(`Statement upload: ${mimetype}, ${(buffer.length / 1024).toFixed(0)} KB`);
    const text = await this.extractText(buffer, mimetype);
    if (!text || text.replace(/\s/g, '').length < 20) {
      throw new BadRequestException(
        'Could not read any text from the file. If this is a scanned PDF, upload a clear photo/screenshot of the statement instead.',
      );
    }
    return this.parseText(text);
  }

  /**
   * Pure text → rows step (no I/O). Public so it can be unit-tested directly and
   * reused by any future "paste statement text" path. Throws if nothing parses.
   */
  parseText(text: string): ParsedStatementTxn[] {
    const rows = this.parseRows(text);
    if (rows.length === 0) {
      throw new BadRequestException(
        "Couldn't find any transactions in the file. Make sure it's a bank statement with a dated transaction table, or upload a clearer image.",
      );
    }
    return rows;
  }

  // ── text extraction ──────────────────────────────────────────────────────────
  private async extractText(buffer: Buffer, mimetype: string): Promise<string> {
    if (mimetype === 'application/pdf') {
      const parser = new PDFParse({ data: buffer });
      try {
        const res = await parser.getText();
        const text = res.text;
        const totalPages = res.total ?? 0;
        // pdf-parse emits a "-- N of M --" marker per page even when the page has
        // no text at all, so an image-only PDF looks non-empty and sails past the
        // length check — then fails later with a misleading "no transactions"
        // error (seen with TMB e-statements, whose pages are rendered as images).
        const realChars = (text ?? '')
          .replace(/--\s*\d+\s*of\s*\d+\s*--/g, '')
          .replace(/\s/g, '').length;
        if (realChars >= 20) {
          this.logger.log(`PDF text layer: ${realChars} chars across ${totalPages} pages.`);
          return text;
        }

        // No usable text layer — render each page to a bitmap and OCR it with
        // the same Tesseract pipeline used for photos. @napi-rs/canvas ships
        // prebuilt binaries for linux-x64, so this works on Render.
        // Rendered pages are already crisp black-on-white, so they skip the jimp
        // preprocessing photos get: at 1500 px they OCR just as accurately
        // (validated 26/26 rows on a real TMB statement) at a fraction of the
        // CPU and memory — critical on Render's free tier.
        this.logger.log(
          `PDF has no text layer (${realChars} chars, ${totalPages} pages) — rendering pages to images for OCR.`,
        );
        if (totalPages > this.MAX_OCR_PAGES) {
          this.logger.warn(
            `PDF has ${totalPages} pages; OCR limited to the first ${this.MAX_OCR_PAGES} to stay within server limits.`,
          );
        }
        const shot = await parser.getScreenshot({
          desiredWidth: 1500,
          imageBuffer: true,
          imageDataUrl: false,
          ...(totalPages > this.MAX_OCR_PAGES ? { first: this.MAX_OCR_PAGES } : {}),
        });
        return this.ocrAll(shot.pages.map((p) => Buffer.from(p.data)));
      } finally {
        await parser.destroy().catch(() => {});
      }
    }
    if (mimetype.startsWith('image/')) {
      const prepped = await this.preprocessImage(buffer);
      return this.ocrAll([prepped]);
    }
    throw new BadRequestException('Unsupported file type. Upload a PDF or an image (PNG/JPG).');
  }

  /**
   * Boost OCR accuracy on photos/screenshots: grayscale, upscale small images,
   * and normalise contrast. This is the single biggest lever — verified locally
   * that a screenshot-resolution statement goes from 0% to 100% of rows detected
   * once upscaled to ~2200px wide before OCR.
   *
   * Uses jimp (pure JavaScript, no native binary) on purpose: sharp ships
   * platform-specific binaries and a Windows-generated lockfile leaves Render's
   * linux-x64 without one, so sharp silently fails to load there. jimp works the
   * same on every platform. Best-effort regardless — on any failure we fall back
   * to the raw bytes so OCR still runs.
   */
  private async preprocessImage(buffer: Buffer): Promise<Buffer> {
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const mod: any = await import('jimp');
      const Jimp = mod.default ?? mod;
      const image = await Jimp.read(buffer);
      if (image.bitmap.width < 1700) image.resize(2200, Jimp.AUTO); // upscale tiny text
      image.greyscale().normalize();
      return await image.getBufferAsync(Jimp.MIME_PNG);
    } catch (err) {
      this.logger.warn(`Image preprocessing skipped (${(err as Error).message}); using raw bytes.`);
      return buffer;
    }
  }

  // OCR one or more page images with a single shared Tesseract worker —
  // worker startup costs seconds, so multi-page PDFs must not pay it per page.
  private async ocrAll(buffers: Buffer[]): Promise<string> {
    // Lazy-load Tesseract so it only spins up when an image is actually uploaded.
    const { createWorker, PSM } = await import('tesseract.js');
    const tWorker = Date.now();
    const worker = await createWorker('eng');
    this.logger.log(`OCR worker ready in ${((Date.now() - tWorker) / 1000).toFixed(1)}s.`);
    try {
      // PSM 6 = "assume a single uniform block of text" → reads the statement
      // row-by-row left-to-right. The default (PSM 3, auto) detects the table's
      // columns and reads them top-to-bottom column-by-column, which scatters each
      // row's date and amounts onto different lines and breaks the row parser.
      // preserve_interword_spaces keeps the column gaps intact.
      await worker.setParameters({
        tessedit_pageseg_mode: PSM.SINGLE_BLOCK,
        preserve_interword_spaces: '1',
      });
      let text = '';
      let pageNo = 0;
      for (const buffer of buffers) {
        const tPage = Date.now();
        const { data } = await worker.recognize(buffer);
        pageNo += 1;
        this.logger.log(
          `OCR page ${pageNo}/${buffers.length} done in ${((Date.now() - tPage) / 1000).toFixed(1)}s.`,
        );
        text += (data.text ?? '') + '\n';
      }
      return text;
    } catch (err) {
      this.logger.error('OCR failed', err as Error);
      throw new BadRequestException('Could not read the image. Try a clearer, straight-on photo.');
    } finally {
      await worker.terminate();
    }
  }

  // ── date helpers ───────────────────────────────────────────────────────────────
  private iso(y: number, mo: number, d: number): string | null {
    if (mo < 1 || mo > 12 || d < 1 || d > 31) return null;
    return `${y}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
  }

  private parseDate(token: string): string | null {
    const t = token.trim();
    let m = /^(\d{1,2})[-/ ]([A-Za-z]{3,4})[-/ ](\d{2,4})$/.exec(t); // 13-Jun-26 / 13 Jun 26
    if (m) {
      const mo = this.MONTHS[m[2].toLowerCase()];
      let y = +m[3];
      if (mo) { if (y < 100) y += 2000; return this.iso(y, mo, +m[1]); }
    }
    m = /^(\d{4})[-/](\d{1,2})[-/](\d{1,2})$/.exec(t); // 2026-06-13
    if (m) return this.iso(+m[1], +m[2], +m[3]);
    m = /^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})$/.exec(t); // 13/06/2026
    if (m) { let y = +m[3]; if (y < 100) y += 2000; return this.iso(y, +m[2], +m[1]); }
    return null;
  }

  // ── row parsing ──────────────────────────────────────────────────────────────
  // Indian bank statements (and their pdf-parse output) spread one transaction across
  // several lines:
  //     14-Jun-26                                          ← date
  //     (14-Jun-26)                                        ← value date
  //     UPI/103481250943/CR/ NPCI BHIM                     ← particulars
  //     /HDF/BHIMCASHB S46063125 Transfer - 6.00 7,948.80  ← …Ref Type Debit Credit Balance
  // We walk the lines holding the current date and an accumulating particulars buffer,
  // and emit when a line ends in the amount columns. Exactly one of the debit/credit
  // cells is a number (the other is "-"), which gives the direction. The same logic
  // also handles single-line rows (e.g. OCR output) that share one line.
  private parseRows(text: string): ParsedStatementTxn[] {
    const lines = text
      .split(/\r?\n/)
      .map((l) => l.replace(/\s+/g, ' ').trim())
      .filter(Boolean);

    const txns: ParsedStatementTxn[] = [];
    let currentDate: string | null = null;
    let buf: string[] = []; // particulars accumulated since the date line
    let prevBalance: number | null = null;
    let dateLines = 0;

    const desc = () => buf.join(' ').replace(/\s+/g, ' ').trim();

    for (const raw of lines) {
      let line = raw;

      // Strip a leading transaction date — it starts a new record.
      const dm = this.DATE_LEAD.exec(line);
      if (dm) {
        const iso = this.parseDate(dm[1]);
        if (iso) { currentDate = iso; buf = []; dateLines++; line = line.slice(dm[0].length).trim(); }
      }
      // Strip a leading "(value date)".
      const vm = this.VDATE_LEAD.exec(line);
      if (vm) {
        if (!currentDate) { const iso = this.parseDate(vm[1]); if (iso) currentDate = iso; }
        line = line.slice(vm[0].length).trim();
      }
      if (!line) continue;
      // Seed the running balance from the opening line so the FIRST row's debit/credit
      // delta (used when there's no explicit Dr/Cr column, e.g. TMB) is correct.
      const ob = /^opening balance\b.*?([\d,]+\.\d{2})\s*$/i.exec(line);
      if (ob) { prevBalance = this.money(ob[1]); continue; }
      if (this.SKIP_LINE.test(line)) continue;

      // Does this line end in the amount columns? If so, it completes a transaction.
      const am = this.AMOUNTS_TAIL.exec(line);
      if (am && currentDate) {
        const cells = am[1].split(/\s+/).filter(Boolean);
        const balance = this.money(cells[cells.length - 1]);
        let amount: number | null = null;
        let type: TransactionType = TransactionType.DEBIT;

        if (balance !== null && cells.length >= 3) {
          // [debit, credit, balance] — exactly one of debit/credit is a number.
          const debit = this.money(cells[cells.length - 3]);
          const credit = this.money(cells[cells.length - 2]);
          if (debit !== null) { amount = debit; type = TransactionType.DEBIT; }
          else if (credit !== null) { amount = credit; type = TransactionType.CREDIT; }
        } else if (balance !== null && cells.length === 2) {
          // [amount, balance] — direction from a Dr/Cr token, else the running balance.
          amount = this.money(cells[0]);
          const drcr = /(?:^|[^A-Za-z])(DR|CR)(?:[^A-Za-z]|$)/i.exec(`${desc()} ${line}`);
          if (drcr) type = drcr[1].toUpperCase() === 'CR' ? TransactionType.CREDIT : TransactionType.DEBIT;
          else if (prevBalance !== null) type = balance < prevBalance ? TransactionType.DEBIT : TransactionType.CREDIT;
        }

        if (amount !== null && amount > 0 && balance !== null) {
          // Particulars = everything buffered + this line up to the amounts (drop the
          // trailing transaction-type word).
          const pre = line.slice(0, am.index).replace(/\b(transfer|upi|neft|imps|rtgs|cash|atm|pos)\b\s*$/i, '').trim();
          const particulars = `${desc()} ${pre}`.replace(/\s+/g, ' ').trim();
          if (/[A-Za-z]/.test(particulars)) { // skip the totals row (digits only, no payee)
            txns.push({
              date: currentDate,
              merchant: this.extractMerchant(particulars),
              amount,
              type,
              upiRef: this.extractRef(particulars),
              balance,
            });
            prevBalance = balance;
            buf = [];
          }
        }
        continue; // amounts line consumed (or totals row ignored) — never buffer it
      }

      // Otherwise it's a particulars line; accumulate under the current date.
      if (currentDate) buf.push(line);
    }

    this.logger.log(
      `Statement parse: ${lines.length} lines, ${dateLines} date-lines, ${txns.length} transactions extracted.`,
    );
    if (txns.length === 0 && lines.length > 0) {
      const sample = lines.slice(0, 6).map((l) => l.slice(0, 90)).join('  ⏐  ');
      this.logger.warn(`No transactions parsed. First lines read: ${sample}`);
    }

    return txns;
  }

  // Parse an Indian-format money cell ("1,234.56"); null for "-" or anything non-money.
  private money(tok: string): number | null {
    if (!tok || !/^\d[\d,]*\.\d{2}$/.test(tok)) return null;
    const n = parseFloat(tok.replace(/,/g, ''));
    return isFinite(n) ? n : null;
  }

  // Best-effort payee name from the particulars text.
  private extractMerchant(p: string): string {
    let m = /\/(?:DR|CR)\/\s*([^/]+?)\s*\//i.exec(p); // IOB UPI: …/DR|CR/ <name> /…
    if (m && /[A-Za-z]/.test(m[1])) return this.cleanMerchant(m[1]);
    m = /UPI\/\d+\/([^/]+?)\/[A-Za-z]{2,6}\//i.exec(p); // TMB UPI: UPI/<id>/<name>/<bank>/…
    if (m && /[A-Za-z]/.test(m[1])) return this.cleanMerchant(m[1]);
    m = /NEFT-[A-Za-z]+-[A-Za-z0-9]+-(.+?)-[A-Za-z0-9]+/i.exec(p); // NEFT: …-<name>-<remark>
    if (m && /[A-Za-z]/.test(m[1])) return this.cleanMerchant(m[1]);
    const s = p
      .replace(/UPI\/[\d/]*\/(?:DR|CR)\//gi, ' ')
      .replace(/NEFT-[A-Za-z]+-[A-Za-z0-9]+-/gi, ' ')
      .replace(/\b[A-Z]?\d{6,}\b/g, ' ')
      .replace(/\b(transfer|upi|neft|imps|rtgs|dr|cr|payment|paid|via|no remark|remark)\b/gi, ' ')
      .replace(/[/*|:\\()-]+/g, ' ');
    return this.cleanMerchant(s) || 'Bank transaction';
  }

  private cleanMerchant(s: string): string {
    return s.replace(/\s+/g, ' ').replace(/^[^A-Za-z0-9]+|[^A-Za-z0-9]+$/g, '').trim().slice(0, 120);
  }

  // A reference for dedup — the bank's Ref/Cheque No (e.g. "S46063125"), else a long id.
  private extractRef(p: string): string | undefined {
    const m = /\bS\d{6,}\b/.exec(p) ?? /\b\d{9,}\b/.exec(p);
    return m ? m[0].slice(0, 60) : undefined;
  }
}
