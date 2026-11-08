import { Injectable } from '@nestjs/common';
import { TransactionType, ImportSource } from '@prisma/client';

export interface ParsedSmsTransaction {
  merchant: string;
  amount: number;
  type: TransactionType;
  date: Date;
  source: ImportSource;
  upiRef: string | null;
  balance: number | null;   // null for IOB/TMB that don't include it
  isAtm: boolean;
  bank: string | null;      // short bank name ("IOB", "TMB", …) when recognisable
  rawSms: string;
}

export interface RawSms {
  body: string;
  date: number;   // epoch ms from Android
  address: string; // sender ID e.g. "VM-IOBCHN-S"
}

// ─── Filters ───────────────────────────────────────────────────────────────
// Bank alerts come from alphanumeric DLT headers ("VM-IOBCHN-S"); a phone
// number sender is a person, never a bank alert.
const PHONE_SENDER_RE = /^\+?\d[\d\s-]{5,}$/;
// TRAI DLT headers end in -P for promotional traffic (offers, ads).
const PROMO_HEADER_RE = /-P$/i;

// Messages that mention money but are not a completed transaction: OTPs,
// offers, loan pitches, payment requests, reminders for future debits.
// (Not links/"click"/"limit": real alerts often end with "Not you? click …" or
// "Avl credit limit Rs …".)
const NOT_A_TRANSACTION_RE = new RegExp([
  '\\botp\\b', 'one[\\s-]?time[\\s-]?password', 'verification code',
  'pre-?approved', '\\boffers?\\b', 'apply now', '\\beligible',
  'congratulations', '\\bwon\\b', '\\bwin\\b',
  'loan (?:of|up ?to|amount)', 'get up ?to',
  'will be (?:debited|credited|deducted)', 'to be (?:debited|credited)', 'due (?:on|date|by)', 'is due', 'amount due',
  'has requested', 'collect request', 'requested money', 'payment request',
  'reward points?', 'statement (?:is|has been) (?:generated|sent)',
  'failed', 'declined', 'unsuccessful',
].join('|'), 'i');

// Every real alert names the account/card/rail it touched.
const ACCOUNT_MARKER_RE = /a\/c|\bacc(?:oun)?t\b|\bacct\b|\bcard\b|x{2,}\d{2,}|\*{2,}\d{2,}|\bupi\b|\bvpa\b|\bneft\b|\bimps\b|\brtgs\b|\batm\b/i;

// Direction cues. Whichever appears FIRST in the message wins — e.g.
// "Rs.500 debited from A/c … and credited to x@ybl" is a debit for this user.
const DEBIT_CUE_RE = /\b(?:debited|debit of|spent|withdrawn|withdrawal|paid|sent|purchase|deducted|dr)\b/i;
const CREDIT_CUE_RE = /\b(?:credited|credit of|received|deposited|cr)\b/i;
const REFUND_CUE_RE = /refund|reversed|reversal|\btdr\b|cashback/i;

const AMOUNT_RE = /(?:Rs\.?|INR|₹)\s*([\d,]+(?:\.\d{1,2})?)/gi;
// An amount right after one of these is a balance/limit, not the transaction.
const BALANCE_PREFIX_RE = /(?:bal(?:ance)?|limit)\s*(?:is|:|-)?\s*(?:Rs\.?|INR|₹)?\s*$/i;

// Sender-header fragments and full names → the short name users give their
// Bank in the app. Sender headers look like "VM-IOBCHN-S" / "JD-TMBANK".
const BANKS: { name: string; header: RegExp; body: RegExp }[] = [
  { name: 'IOB',      header: /IOB/i,              body: /indian overseas/i },
  { name: 'TMB',      header: /TMB/i,              body: /tamilnad mercantile/i },
  { name: 'SBI',      header: /SBI/i,              body: /state bank of india/i },
  { name: 'HDFC',     header: /HDFC/i,             body: /hdfc bank/i },
  { name: 'ICICI',    header: /ICICI/i,            body: /icici bank/i },
  { name: 'Axis',     header: /AXIS/i,             body: /axis bank/i },
  { name: 'Kotak',    header: /KOTAK/i,            body: /kotak/i },
  { name: 'Canara',   header: /CANBNK|CANARA/i,    body: /canara bank/i },
  { name: 'Indian Bank', header: /INDBNK|INDIANB/i, body: /\bindian bank\b/i },
  { name: 'KVB',      header: /KVB/i,              body: /karur vysya/i },
  { name: 'City Union', header: /CUB/i,            body: /city union/i },
];

@Injectable()
export class SmsParserService {

  parse(messages: RawSms[]): ParsedSmsTransaction[] {
    const results: ParsedSmsTransaction[] = [];

    for (const sms of messages) {
      const parsed = this.parseSingle(sms);
      if (parsed) results.push(parsed);
    }

    return results;
  }

  private parseSingle(sms: RawSms): ParsedSmsTransaction | null {
    const body = sms.body ?? '';
    const lower = body.toLowerCase();
    const address = (sms.address ?? '').trim();

    if (PHONE_SENDER_RE.test(address) || PROMO_HEADER_RE.test(address)) return null;
    if (NOT_A_TRANSACTION_RE.test(body)) return null;

    const isRefund = REFUND_CUE_RE.test(lower);
    const type = this.extractType(body, isRefund);
    if (!type) return null;                       // no debit/credit/refund verb
    if (!ACCOUNT_MARKER_RE.test(body)) return null;

    const amount = this.extractAmount(body);
    if (!amount || amount <= 0) return null;

    const date = new Date(sms.date);
    const upiRef = this.extractUpiRef(body);
    const balance = this.extractBalance(body);
    const isAtm = this.detectAtm(lower);
    const merchant = this.extractMerchant(body, lower, isAtm, upiRef, type);

    return {
      merchant,
      amount,
      type,
      date,
      source: ImportSource.SMS,
      upiRef,
      balance,
      isAtm,
      bank: this.detectBank(address, body),
      rawSms: body,
    };
  }

  // ─── Field extractors ──────────────────────────────────────────

  private extractType(body: string, isRefund: boolean): TransactionType | null {
    if (isRefund) return TransactionType.REFUND;
    const d = body.search(DEBIT_CUE_RE);
    const c = body.search(CREDIT_CUE_RE);
    if (d === -1 && c === -1) return null;
    if (c === -1) return TransactionType.DEBIT;
    if (d === -1) return TransactionType.CREDIT;
    return d < c ? TransactionType.DEBIT : TransactionType.CREDIT;
  }

  private extractAmount(body: string): number | null {
    // Patterns: "Rs.1,000.00", "Rs 1000", "INR 1,000", "₹1000". Take the first
    // amount that isn't a balance/limit ("Avl Bal: Rs.40,000").
    for (const m of body.matchAll(AMOUNT_RE)) {
      const before = body.slice(Math.max(0, (m.index ?? 0) - 20), m.index);
      if (BALANCE_PREFIX_RE.test(before)) continue;
      const value = parseFloat(m[1].replace(/,/g, ''));
      if (!isNaN(value) && value > 0) return value;
    }
    return null;
  }

  private extractUpiRef(body: string): string | null {
    const patterns = [
      // "UPI Ref: 412345678012", "UPI Ref No: 412345678012", "UPI/412345678012"
      /(?:UPI\s*[Rr]ef(?:erence)?(?:\s*[Nn]o)?\.?:?\s*|UPI\/)(\d{10,})/,
      // "UPI/DR/412345678012/NAME", "UPI/CR/412345678012/…"
      /UPI\/(?:DR|CR|P2A|P2M)\/(\d{10,})/i,
      // "Ref No 412345678012", "RRN 412345678012", "UTR: SBIN1234567890"
      /(?:\bRef(?:erence)?\s*(?:No|Number)?|\bRRN|\bUTR)\.?\s*:?\s*([A-Z0-9]{10,})/i,
    ];
    for (const re of patterns) {
      const match = body.match(re);
      if (match) return match[1];
    }
    return null;
  }

  private extractBalance(body: string): number | null {
    // "Avl Bal: Rs.40,000", "Available Balance: Rs 40000", "Bal:40000"
    const match = body.match(
      /(?:Avl\.?\s*Bal(?:ance)?|Available\s*Bal(?:ance)?|Bal)\s*:?\s*(?:Rs\.?|INR|₹)?\s*([\d,]+(?:\.\d{1,2})?)/i
    );
    if (!match) return null;

    // IOB sometimes returns "NA" — ignore
    if (match[1].toLowerCase() === 'na') return null;

    const value = parseFloat(match[1].replace(/,/g, ''));
    return isNaN(value) ? null : value;
  }

  private detectAtm(lower: string): boolean {
    return (
      lower.includes('atm') ||
      lower.includes('cash withdrawal') ||
      lower.includes('cash withd') ||
      lower.includes('atm withdrawal')
    );
  }

  private detectBank(address: string, body: string): string | null {
    // Strip the DLT prefix/suffix ("VM-IOBCHN-S" → "IOBCHN") before matching.
    const header = address.replace(/^[A-Z]{2}-/i, '').replace(/-[A-Z]$/i, '');
    for (const b of BANKS) {
      if (b.header.test(header) || b.body.test(body)) return b.name;
    }
    return null;
  }

  private extractMerchant(
    body: string,
    lower: string,
    isAtm: boolean,
    upiRef: string | null,
    type: TransactionType,
  ): string {
    if (isAtm) return 'ATM Withdrawal';

    // Try to extract VPA (virtual payment address): "to merchant@bank"
    const vpaMatch = body.match(/(?:to|at|from|by)\s+(?:VPA\s+)?([\w.\-]+@[\w.\-]+)/i);
    if (vpaMatch) {
      // Convert "swiggy@icici" → "Swiggy"
      const vpa = vpaMatch[1].split('@')[0];
      return vpa.charAt(0).toUpperCase() + vpa.slice(1);
    }

    // ICICI format: "amount UPI ref 123 - MERCHANT NAME"
    const dashMerchant = body.match(/UPI\s+ref\s+\d+\s+-\s+([^\n.]+)/i);
    if (dashMerchant) return dashMerchant[1].trim();

    // Narration format: "UPI/DR/412345678012/MERCHANT NAME/…"
    const narration = body.match(/UPI\/(?:DR|CR|P2A|P2M)\/\d+\/([A-Za-z][A-Za-z .&]*[A-Za-z])/i);
    if (narration) return narration[1].trim();

    // "transfer to NAME", "payment to NAME", "trf to NAME"; for credits "from NAME"
    const toMatch = body.match(/(?:transfer|payment|paid|trf|sent)\s+to\s+([A-Z][A-Za-z\s.&]+?)(?:\s+via|\s+on|\s+ref|\s+upi|\.|,|\n|$)/i);
    if (toMatch) return toMatch[1].trim();
    if (type !== TransactionType.DEBIT) {
      const fromMatch = body.match(/\bfrom\s+([A-Z][A-Za-z\s.&]+?)(?:\s+via|\s+on|\s+ref|\s+upi|\.|,|\n|$)/i);
      if (fromMatch && !/^(?:your|a\/?c|account)\b/i.test(fromMatch[1])) return fromMatch[1].trim();
    }

    // Card spend: "spent … at MERCHANT on"
    const atMatch = body.match(/\bat\s+([A-Z][A-Za-z0-9\s.&*'-]+?)(?:\s+on|\s+via|\.|,|\n|$)/i);
    if (atMatch && !/^atm\b/i.test(atMatch[1])) return atMatch[1].trim();

    // Fallback labels based on type
    if (lower.includes('neft')) return 'NEFT Transfer';
    if (lower.includes('rtgs')) return 'RTGS Transfer';
    if (lower.includes('imps')) return 'IMPS Transfer';
    if (upiRef && /upi/i.test(body)) return 'UPI Payment';
    return 'Bank Transaction';
  }
}
