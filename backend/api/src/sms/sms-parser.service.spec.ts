import { Test, TestingModule } from '@nestjs/testing';
import { SmsParserService, RawSms } from './sms-parser.service';
import { TransactionType, ImportSource } from '@prisma/client';

// Helper — build a RawSms object
function makeSms(body: string, overrides: Partial<RawSms> = {}): RawSms {
  return {
    body,
    date: new Date('2026-05-09T10:00:00.000Z').getTime(),
    address: 'IOB-BANK',
    ...overrides,
  };
}

describe('SmsParserService', () => {
  let service: SmsParserService;

  beforeEach(async () => {
    // No dependencies — no mocks needed
    const module: TestingModule = await Test.createTestingModule({
      providers: [SmsParserService],
    }).compile();

    service = module.get<SmsParserService>(SmsParserService);
  });

  // ─── parse() — top-level filtering ──────────────────────────────────────

  describe('parse', () => {
    it('returns empty array for empty input', () => {
      expect(service.parse([])).toHaveLength(0);
    });

    it('filters out non-bank SMS (OTP, promo, etc.)', () => {
      const result = service.parse([
        makeSms('Your OTP is 123456. Valid for 10 minutes.'),
        makeSms('Congratulations! You have won a prize. Click here.'),
        makeSms('Your order has been shipped.'),
      ]);
      expect(result).toHaveLength(0);
    });

    it('parses multiple valid bank SMS messages', () => {
      const result = service.parse([
        makeSms('Your A/c XXXXXX1234 is Debited by Rs.500.00 via UPI. UPI Ref:412345678901.'),
        makeSms('Your A/c XXXXXX1234 is Credited by Rs.5000.00. UPI Ref:412345678902.'),
      ]);
      expect(result).toHaveLength(2);
    });

    it('sets ImportSource to SMS on every parsed message', () => {
      const result = service.parse([
        makeSms('Your A/c XXXXXX1234 is Debited by Rs.200.00 via UPI. UPI Ref:412345678901.'),
      ]);
      expect(result[0].source).toBe(ImportSource.SMS);
    });

    it('uses the epoch ms date from the raw SMS', () => {
      const epochMs = new Date('2026-01-15T08:30:00.000Z').getTime();
      const result = service.parse([
        makeSms('Your A/c XXXXXX1234 is Debited by Rs.200.00. UPI Ref:412345678901.', { date: epochMs }),
      ]);
      expect(result[0].date.getTime()).toBe(epochMs);
    });
  });

  // ─── Amount extraction ───────────────────────────────────────────────────

  describe('amount extraction', () => {
    it('parses Rs.1,000.00 format (IOB standard)', () => {
      const result = service.parse([
        makeSms('Your A/c XXXXXX1234 is Debited by Rs.1,000.00 via UPI. UPI Ref:412345678901.'),
      ]);
      expect(result[0].amount).toBe(1000);
    });

    it('parses Rs 500 format (no dot, no comma)', () => {
      const result = service.parse([
        makeSms('Your A/c XXXXXX1234 is Debited Rs 500 via UPI. UPI Ref:412345678901.'),
      ]);
      expect(result[0].amount).toBe(500);
    });

    it('parses INR 1000 format', () => {
      const result = service.parse([
        makeSms('INR 1000 debited from your account. UPI Ref:412345678901.'),
      ]);
      expect(result[0].amount).toBe(1000);
    });

    it('parses ₹450 format (symbol only)', () => {
      const result = service.parse([
        makeSms('₹450 debited from your account. UPI Ref:412345678901.'),
      ]);
      expect(result[0].amount).toBe(450);
    });

    it('parses amount with thousand separators (Rs.10,500.50)', () => {
      const result = service.parse([
        makeSms('Debited by Rs.10,500.50 from your A/c. UPI Ref:412345678901.'),
      ]);
      expect(result[0].amount).toBeCloseTo(10500.5);
    });

    it('skips SMS with no detectable amount', () => {
      const result = service.parse([
        makeSms('Your account has been debited. Please check your passbook.'),
      ]);
      expect(result).toHaveLength(0);
    });
  });

  // ─── Transaction type detection ──────────────────────────────────────────

  describe('type detection', () => {
    it('marks DEBIT for "Debited" keyword', () => {
      const result = service.parse([
        makeSms('Your A/c is Debited by Rs.500.00. UPI Ref:412345678901.'),
      ]);
      expect(result[0].type).toBe(TransactionType.DEBIT);
    });

    it('marks DEBIT for "withdrawn" keyword (ATM)', () => {
      const result = service.parse([
        makeSms('Rs.2000.00 withdrawn from ATM at SBI ATM. Avl Bal:Rs.38000.'),
      ]);
      expect(result[0].type).toBe(TransactionType.DEBIT);
    });

    it('marks CREDIT for "Credited" keyword', () => {
      const result = service.parse([
        makeSms('Your A/c XXXXXX1234 is Credited by Rs.5000.00. UPI Ref:412345678902.'),
      ]);
      expect(result[0].type).toBe(TransactionType.CREDIT);
    });

    it('marks CREDIT for "credited" keyword', () => {
      const result = service.parse([
        makeSms('Rs.1000 credited to your A/c. UPI Ref:412345678902.'),
      ]);
      expect(result[0].type).toBe(TransactionType.CREDIT);
    });

    it('defaults to DEBIT when no explicit credit keyword is present', () => {
      // Message passes the bank-SMS filter (has "debit") but has no "credited/received" word
      const result = service.parse([
        makeSms('Your A/c is Debited by Rs.300 for misc charges. UPI Ref:412345678901.'),
      ]);
      expect(result[0].type).toBe(TransactionType.DEBIT);
    });
  });

  // ─── UPI reference extraction ────────────────────────────────────────────

  describe('UPI ref extraction', () => {
    it('extracts "UPI Ref:412345678901" (no space, colon)', () => {
      const result = service.parse([
        makeSms('Debited Rs.500. UPI Ref:412345678901.'),
      ]);
      expect(result[0].upiRef).toBe('412345678901');
    });

    it('extracts "UPI Ref No: 412345678901" (with space)', () => {
      const result = service.parse([
        makeSms('Debited Rs.500. UPI Ref No: 412345678901.'),
      ]);
      expect(result[0].upiRef).toBe('412345678901');
    });

    it('extracts "UPI/412345678901" (slash format)', () => {
      const result = service.parse([
        makeSms('Debited Rs.500. UPI/412345678901.'),
      ]);
      expect(result[0].upiRef).toBe('412345678901');
    });

    it('returns null when no UPI ref present (ATM, NEFT)', () => {
      const result = service.parse([
        makeSms('Rs.2000.00 withdrawn from ATM. Avl Bal:Rs.38000.'),
      ]);
      expect(result[0].upiRef).toBeNull();
    });
  });

  // ─── Balance extraction ───────────────────────────────────────────────────

  describe('balance extraction', () => {
    it('extracts "Avl Bal:Rs.40,000.00" format', () => {
      const result = service.parse([
        makeSms('Debited Rs.500. UPI Ref:412345678901. Avl Bal:Rs.40,000.00'),
      ]);
      expect(result[0].balance).toBe(40000);
    });

    it('extracts "Available Balance: Rs 38000" format', () => {
      const result = service.parse([
        makeSms('Rs.450 debited. UPI Ref:412345678901. Available Balance: Rs 38000'),
      ]);
      expect(result[0].balance).toBe(38000);
    });

    it('returns null when balance is "NA" (IOB/TMB)', () => {
      const result = service.parse([
        makeSms('Dear Customer,Rs.1000.00 debited. UPI Ref:412345678903. Bal:NA'),
      ]);
      expect(result[0].balance).toBeNull();
    });

    it('returns null when no balance in SMS', () => {
      const result = service.parse([
        makeSms('Your A/c is Debited by Rs.500.00. UPI Ref:412345678901.'),
      ]);
      expect(result[0].balance).toBeNull();
    });
  });

  // ─── ATM detection ────────────────────────────────────────────────────────

  describe('ATM detection', () => {
    it('detects "ATM" keyword', () => {
      const result = service.parse([
        makeSms('Rs.2000.00 withdrawn from ATM. Avl Bal:Rs.38000.'),
      ]);
      expect(result[0].isAtm).toBe(true);
    });

    it('detects "cash withdrawal" keyword', () => {
      const result = service.parse([
        makeSms('Your A/c is Debited by Rs.2000.00 for cash withdrawal on 09-May-26.'),
      ]);
      expect(result[0].isAtm).toBe(true);
    });

    it('sets merchant to "ATM Withdrawal" for ATM transactions', () => {
      const result = service.parse([
        makeSms('Rs.2000.00 withdrawn from ATM. Avl Bal:Rs.38000.'),
      ]);
      expect(result[0].merchant).toBe('ATM Withdrawal');
    });

    it('is false for regular UPI transactions', () => {
      const result = service.parse([
        makeSms('Debited Rs.450 to swiggy@icici via UPI. UPI Ref:412345678901.'),
      ]);
      expect(result[0].isAtm).toBe(false);
    });
  });

  // ─── Merchant extraction ──────────────────────────────────────────────────

  describe('merchant extraction', () => {
    it('extracts VPA "to swiggy@icici" → "Swiggy"', () => {
      const result = service.parse([
        makeSms('Rs.450 debited to swiggy@icici via UPI. UPI Ref:412345678901.'),
      ]);
      expect(result[0].merchant).toBe('Swiggy');
    });

    it('capitalises first letter of VPA merchant', () => {
      const result = service.parse([
        makeSms('Rs.120 debited to zomato@icici. UPI Ref:412345678901.'),
      ]);
      expect(result[0].merchant.charAt(0)).toBe(result[0].merchant.charAt(0).toUpperCase());
    });

    it('extracts ICICI dash format "UPI ref 123 - MERCHANT NAME"', () => {
      const result = service.parse([
        makeSms('Rs.800 debited. UPI ref 412345678901 - BigBasket Grocery. Avl Bal:Rs.37000.'),
      ]);
      expect(result[0].merchant).toBe('BigBasket Grocery');
    });

    it('falls back to "UPI Payment" when UPI ref present but no merchant found', () => {
      const result = service.parse([
        makeSms('Your A/c is Debited by Rs.500. UPI Ref:412345678901.'),
      ]);
      expect(result[0].merchant).toBe('UPI Payment');
    });

    it('falls back to "NEFT Transfer" for NEFT transactions', () => {
      const result = service.parse([
        makeSms('Your A/c is Debited by Rs.10000 via NEFT on 09-May-26.'),
      ]);
      expect(result[0].merchant).toBe('NEFT Transfer');
    });

    it('falls back to "RTGS Transfer" for RTGS transactions', () => {
      const result = service.parse([
        makeSms('Your A/c is Debited by Rs.50000 via RTGS on 09-May-26.'),
      ]);
      expect(result[0].merchant).toBe('RTGS Transfer');
    });

    it('falls back to "Bank Transaction" when nothing else matches', () => {
      const result = service.parse([
        makeSms('Your A/c is Debited by Rs.300 on 09-May-26.'),
      ]);
      expect(result[0].merchant).toBe('Bank Transaction');
    });
  });

  // ─── Real-world SMS samples ───────────────────────────────────────────────

  describe('real-world SMS samples', () => {
    it('parses a real IOB debit SMS', () => {
      const [tx] = service.parse([
        makeSms(
          'Your A/c XXXXXX1234 is Debited by Rs.1,500.00 on 09-May-26 via UPI. UPI Ref:412345678901. Avl Bal:Rs.38,500.00',
        ),
      ]);
      expect(tx.amount).toBe(1500);
      expect(tx.type).toBe(TransactionType.DEBIT);
      expect(tx.upiRef).toBe('412345678901');
      expect(tx.balance).toBe(38500);
      expect(tx.isAtm).toBe(false);
    });

    it('parses a real TMB SMS with NA balance', () => {
      const [tx] = service.parse([
        makeSms(
          'Dear Customer,Rs.2,000.00 debited from A/c XXXXXX5678 on 09/05/2026. UPI Ref:412345678903. Bal:NA',
        ),
      ]);
      expect(tx.amount).toBe(2000);
      expect(tx.type).toBe(TransactionType.DEBIT);
      expect(tx.upiRef).toBe('412345678903');
      expect(tx.balance).toBeNull();
    });

    it('parses a real ATM withdrawal SMS', () => {
      const [tx] = service.parse([
        makeSms(
          'Your A/c XXXXXX1234 is Debited by Rs.3,000.00 for ATM cash withdrawal on 09-May-26. Avl Bal:Rs.35,500.00',
        ),
      ]);
      expect(tx.amount).toBe(3000);
      expect(tx.type).toBe(TransactionType.DEBIT);
      expect(tx.isAtm).toBe(true);
      expect(tx.merchant).toBe('ATM Withdrawal');
      expect(tx.upiRef).toBeNull();
    });

    it('parses a Google Pay UPI debit with VPA merchant', () => {
      const [tx] = service.parse([
        makeSms(
          'Rs.450 debited to swiggy@icici via UPI. UPI Ref No: 412345678905. Available Balance: Rs.38,550.00',
        ),
      ]);
      expect(tx.amount).toBe(450);
      expect(tx.merchant).toBe('Swiggy');
      expect(tx.upiRef).toBe('412345678905');
    });

    it('parses a credit (salary/transfer)', () => {
      const [tx] = service.parse([
        makeSms(
          'Your A/c XXXXXX1234 is Credited by Rs.50,000.00 on 09-May-26. UPI Ref:412345678906.',
        ),
      ]);
      expect(tx.amount).toBe(50000);
      expect(tx.type).toBe(TransactionType.CREDIT);
    });
  });
  // ─── Rejecting non-transactions ───────────────────────────────────────────

  describe('rejects messages that are not completed transactions', () => {
    it.each([
      ['a loan offer', 'Congratulations! You are pre-approved for a personal loan of Rs.5,00,000. Apply now.'],
      ['a credit card offer', 'Get up to Rs.2,000 cashback offer on your new credit card. T&C apply.'],
      ['an OTP', 'OTP for your txn of Rs.1,500.00 on A/c XX1234 is 482913. Do not share.'],
      ['a future debit reminder', 'Rs.5,000 will be debited from A/c XX1234 on 10-May for your SIP.'],
      ['a bill due reminder', 'Your card XX1234 bill of Rs.12,000 is due on 15-May.'],
      ['a UPI collect request', 'Ramesh has requested money Rs.500 from you via UPI.'],
      ['a failed transaction', 'Txn of Rs.800 from A/c XX1234 failed. Amount debited will be reversed.'],
    ])('%s', (_label, body) => {
      expect(service.parse([makeSms(body)])).toEqual([]);
    });

    it('ignores SMS from a phone number (a person, not a bank)', () => {
      const sms = makeSms('Sent Rs.500 to your A/c, please check', { address: '+919876543210' });
      expect(service.parse([sms])).toEqual([]);
    });

    it('ignores promotional DLT headers (-P)', () => {
      const sms = makeSms('Rs.500 credited to your A/c XX1234 as reward', { address: 'VM-OFFERS-P' });
      expect(service.parse([sms])).toEqual([]);
    });

    it('needs an account / card / UPI marker', () => {
      expect(service.parse([makeSms('Rs.500 debited. Thank you.')])).toEqual([]);
    });

    it('keeps a real alert that ends with a "Not you?" help line', () => {
      const [tx] = service.parse([makeSms(
        'Rs.250 debited from A/c XX1234 to swiggy@icici. UPI Ref 412345678901. Not you? Call 18001234 or click https://bank.in/block',
      )]);
      expect(tx.amount).toBe(250);
    });
  });

  // ─── Direction and amount ─────────────────────────────────────────────────

  describe('direction and amount', () => {
    it('uses whichever verb comes first ("debited … credited to x@ybl" is a debit)', () => {
      const [tx] = service.parse([makeSms('Rs.500 debited from A/c XX1234 and credited to ravi@ybl. UPI Ref 412345678901')]);
      expect(tx.type).toBe(TransactionType.DEBIT);
      expect(tx.merchant).toBe('Ravi');
    });

    it('treats a credit-card spend as a debit', () => {
      const [tx] = service.parse([makeSms('Rs.1,299 spent on your credit card XX9876 at AMAZON on 09-May. Avl limit Rs.45,000')]);
      expect(tx.type).toBe(TransactionType.DEBIT);
      expect(tx.amount).toBe(1299);
      expect(tx.merchant).toBe('AMAZON');
    });

    it('skips a balance that appears before the amount', () => {
      const [tx] = service.parse([makeSms('Avl Bal Rs.40,000. Rs.700 debited from A/c XX1234 via UPI. UPI Ref 412345678901')]);
      expect(tx.amount).toBe(700);
    });

    it('takes the sender name for a credit ("from NAME")', () => {
      const [tx] = service.parse([makeSms('Rs.2,000 credited to A/c XX1234 from RAVI KUMAR via IMPS. Ref No 612345678901')]);
      expect(tx.type).toBe(TransactionType.CREDIT);
      expect(tx.merchant).toBe('RAVI KUMAR');
    });
  });

  // ─── Reference numbers ────────────────────────────────────────────────────

  describe('reference numbers', () => {
    it('reads the UPI/DR/<ref>/<name> narration', () => {
      const [tx] = service.parse([makeSms('A/c XX1234 debited Rs.150.00 Info: UPI/DR/412345678901/TEA STALL/okaxis')]);
      expect(tx.upiRef).toBe('412345678901');
      expect(tx.merchant).toBe('TEA STALL');
    });

    it('reads an IMPS/NEFT "Ref No" or UTR', () => {
      const [tx] = service.parse([makeSms('Rs.10,000 debited from A/c XX1234 via NEFT. UTR: SBIN526129123456')]);
      expect(tx.upiRef).toBe('SBIN526129123456');
    });
  });

  // ─── Bank detection ───────────────────────────────────────────────────────

  describe('bank detection', () => {
    it('detects IOB from the sender header', () => {
      const [tx] = service.parse([makeSms('Rs.100 debited from A/c XX1234 via UPI. UPI Ref 412345678901', { address: 'VM-IOBCHN-S' })]);
      expect(tx.bank).toBe('IOB');
    });

    it('detects TMB from the sender header', () => {
      const [tx] = service.parse([makeSms('Rs.100 debited from A/c XX1234 via UPI. UPI Ref 412345678901', { address: 'JD-TMBANK' })]);
      expect(tx.bank).toBe('TMB');
    });

    it('detects the bank from its full name in the body', () => {
      const [tx] = service.parse([makeSms('Tamilnad Mercantile Bank: Rs.100 credited to A/c XX1234. UPI Ref 412345678901', { address: 'AX-ALERTS' })]);
      expect(tx.bank).toBe('TMB');
    });

    it('is null when the bank is unknown', () => {
      const [tx] = service.parse([makeSms('Rs.100 debited from A/c XX1234 via UPI. UPI Ref 412345678901', { address: 'AX-MYBANK' })]);
      expect(tx.bank).toBeNull();
    });
  });
});
