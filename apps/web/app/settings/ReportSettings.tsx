'use client';

import { useState, useEffect } from 'react';
import { useAuth } from '@clerk/nextjs';

const MONTH_DAYS = Array.from({ length: 28 }, (_, i) => i + 1);

export default function ReportSettings() {
  const { getToken } = useAuth();
  const [monthStartDay, setMonthStartDay] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const token = await getToken();
        const res = await fetch(`${process.env.NEXT_PUBLIC_API_URL}/users/me`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${token}` },
        });
        const data = await res.json();
        setMonthStartDay(data.monthStartDay ?? 1);
      } catch {
        setMonthStartDay(1);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function save(day: number) {
    if (day === monthStartDay || saving) return;
    setSaving(true);
    const prev = monthStartDay;
    setMonthStartDay(day);
    try {
      const token = await getToken();
      const res = await fetch(`${process.env.NEXT_PUBLIC_API_URL}/users/me`, {
        method: 'PATCH',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ monthStartDay: day }),
      });
      if (!res.ok) throw new Error();
    } catch {
      setMonthStartDay(prev);
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="bg-white dark:bg-gray-800 rounded-2xl border border-gray-200 dark:border-gray-700 p-6 mt-6">
      <h2 className="font-semibold text-gray-800 dark:text-gray-100">My month starts on</h2>
      <p className="text-sm text-gray-500 dark:text-gray-400 mt-1 mb-4">
        Paid at month-end? Set the day your salary usually arrives (e.g. 28) and monthly
        reports will follow your pay cycle instead of the calendar month. Day 1 = normal
        calendar month.
      </p>
      {monthStartDay === null ? (
        <div className="h-24 rounded-xl bg-gray-100 dark:bg-gray-700 animate-pulse" />
      ) : (
        <>
          <div className="flex flex-wrap gap-1.5">
            {MONTH_DAYS.map(day => (
              <button
                key={day}
                onClick={() => save(day)}
                disabled={saving}
                className={`w-10 h-9 rounded-lg border text-sm font-semibold transition-colors ${
                  day === monthStartDay
                    ? 'bg-indigo-600 border-indigo-600 text-white'
                    : 'border-gray-200 dark:border-gray-600 text-gray-500 dark:text-gray-400 hover:border-indigo-400'
                }`}
              >
                {day}
              </button>
            ))}
          </div>
          {monthStartDay > 1 && (
            <p className="text-xs text-gray-400 dark:text-gray-500 mt-3">
              {monthStartDay > 15
                ? `e.g. "July" report = ${monthStartDay} Jun → ${monthStartDay - 1} Jul`
                : `e.g. "July" report = ${monthStartDay} Jul → ${monthStartDay - 1} Aug`}
            </p>
          )}
        </>
      )}
    </section>
  );
}
