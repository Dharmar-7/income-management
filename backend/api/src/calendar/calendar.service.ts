import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { occurrenceInfo, EVENT_ICON } from '../events/events.service';

export interface CalendarEvent {
  date: string;        // ISO date
  kind: 'bill' | 'income' | 'emi' | 'goal' | 'reminder' | 'event';
  title: string;
  amount: number | null;
  icon: string;
}

// Next occurrence of a monthly EMI given its day-of-month, on/after `from`.
function nextMonthlyDate(day: number, from: Date): Date {
  const d = new Date(from.getFullYear(), from.getMonth(), day);
  const today = new Date(from.getFullYear(), from.getMonth(), from.getDate());
  if (d < today) d.setMonth(d.getMonth() + 1);
  return d;
}

@Injectable()
export class CalendarService {
  constructor(private prisma: PrismaService) {}

  private resolveUserId(clerkId: string): Promise<string> {
    return this.prisma.resolveUserId(clerkId);
  }

  // Aggregate everything dated into one upcoming agenda — bills/income from
  // recurring rules, loan EMIs, goal target dates and note reminders.
  async getUpcoming(clerkId: string, days = 60): Promise<CalendarEvent[]> {
    const userId = await this.resolveUserId(clerkId);

    const now = new Date();
    const start = new Date(now.getFullYear(), now.getMonth(), now.getDate()); // start of today
    const end = new Date(start);
    end.setDate(end.getDate() + days);

    const events: { date: Date; kind: CalendarEvent['kind']; title: string; amount: number | null; icon: string }[] = [];

    // All five sources fetched in one parallel batch — the DB is cross-region,
    // so each sequential round-trip would add ~1s of wall-clock time.
    const [recurring, loans, goals, notes, eventRows] = await Promise.all([
      this.prisma.recurringTransaction.findMany({
        where: { userId, isActive: true, nextDueDate: { gte: start, lte: end } },
      }),
      this.prisma.loan.findMany({ where: { userId, isActive: true } }),
      this.prisma.goal.findMany({
        where: { userId, targetDate: { gte: start, lte: end } },
      }),
      this.prisma.note.findMany({
        where: { userId, reminderAt: { gte: start, lte: end } },
        select: { title: true, reminderAt: true },
      }),
      this.prisma.event.findMany({ where: { userId } }),
    ]);

    // Recurring bills / income
    for (const r of recurring) {
      const income = r.type === 'CREDIT';
      events.push({
        date: r.nextDueDate,
        kind: income ? 'income' : 'bill',
        title: r.name,
        amount: r.amount,
        icon: income ? '💰' : '🔁',
      });
    }

    // Loan EMIs — next due date computed from the EMI day-of-month
    for (const l of loans) {
      const due = nextMonthlyDate(l.emiDay, now);
      if (due >= start && due <= end) {
        events.push({ date: due, kind: 'emi', title: `${l.name} EMI`, amount: l.emiAmount, icon: '🏦' });
      }
    }

    // Goal target dates
    for (const g of goals) {
      if (g.targetDate) {
        events.push({ date: g.targetDate, kind: 'goal', title: `Goal: ${g.name}`, amount: g.targetAmount, icon: g.icon });
      }
    }

    // Note reminders
    for (const n of notes) {
      if (n.reminderAt) {
        events.push({ date: n.reminderAt, kind: 'reminder', title: n.title?.trim() || 'Reminder', amount: null, icon: '🔔' });
      }
    }

    // Memorable events — next yearly occurrence (birthdays, anniversaries)
    for (const ev of eventRows) {
      const info = occurrenceInfo(ev.date, now);
      if (info.next >= start && info.next <= end) {
        events.push({ date: info.next, kind: 'event', title: ev.title, amount: null, icon: EVENT_ICON[ev.type] });
      }
    }

    events.sort((a, b) => a.date.getTime() - b.date.getTime());
    return events.map(e => ({ ...e, date: e.date.toISOString() }));
  }
}
