import { useState } from 'react';
import { View, Text, TouchableOpacity, ActivityIndicator } from 'react-native';
import { useTheme } from '@/context/ThemeContext';
import { hSelect } from '@/lib/haptics';
import type { CommitRow } from '@/components/StatementReviewSheet';

// A statement row the server didn't import, with why and what it matched.
export interface SkippedRow {
  transaction: CommitRow;
  reason: 'same-ref' | 'same-entry' | 'repeat-in-file';
  existing: {
    id: string;
    merchant: string;
    amount: number;
    date: string;
    type: string;
    source: string;
  } | null;
}

const SOURCE_LABEL: Record<string, string> = {
  SMS: 'from SMS',
  MANUAL: 'added by hand',
  STATEMENT: 'from a statement',
  TAKEOUT: 'from Google Pay',
  GMAIL: 'from Gmail',
};

const inr = (n: number) => `₹${n.toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;
const day = (d: string) => new Date(d).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });

function reasonText(r: SkippedRow): string {
  const src = r.existing ? SOURCE_LABEL[r.existing.source] ?? '' : '';
  switch (r.reason) {
    case 'same-ref':
      return `Same reference no. as "${r.existing?.merchant}" on ${r.existing ? day(r.existing.date) : '—'} ${src}`.trim();
    case 'same-entry':
      return `Same name, amount and date as a transaction already saved ${src}`.trim();
    case 'repeat-in-file':
      return 'Appears more than once in this statement';
  }
}

// Shown under the import result: every row that "existed", so the user can
// check it and add the ones that are really new. Nothing is pre-ticked — the
// safe default is that a skipped row really is a duplicate.
export default function SkippedStatementRows({
  rows,
  adding,
  onAdd,
}: {
  rows: SkippedRow[];
  adding: boolean;
  onAdd: (rows: SkippedRow[]) => void;
}) {
  const { theme: c } = useTheme();
  const [picked, setPicked] = useState<Set<number>>(new Set());

  if (rows.length === 0) return null;

  const toggle = (i: number) => {
    hSelect();
    setPicked(prev => {
      const next = new Set(prev);
      if (next.has(i)) next.delete(i);
      else next.add(i);
      return next;
    });
  };
  const allPicked = picked.size === rows.length;

  return (
    <View style={{ marginBottom: 16 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 6 }}>
        <Text style={{ flex: 1, fontWeight: '700', color: c.text, fontSize: 14 }}>
          Not imported ({rows.length})
        </Text>
        <TouchableOpacity
          onPress={() => { hSelect(); setPicked(allPicked ? new Set() : new Set(rows.map((_, i) => i))); }}
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
        >
          <Text style={{ color: c.primary, fontWeight: '600', fontSize: 13 }}>{allPicked ? 'Clear' : 'Select all'}</Text>
        </TouchableOpacity>
      </View>
      <Text style={{ color: c.textMuted, fontSize: 12, marginBottom: 10, lineHeight: 17 }}>
        These looked like transactions you already have. Check each one; if it's really a separate payment, tick it and add it.
      </Text>

      {rows.map((r, i) => {
        const on = picked.has(i);
        const t = r.transaction;
        return (
          <TouchableOpacity
            key={i}
            onPress={() => toggle(i)}
            activeOpacity={0.7}
            accessibilityRole="checkbox"
            accessibilityState={{ checked: on }}
            style={{
              flexDirection: 'row', alignItems: 'flex-start', gap: 10,
              padding: 10, marginBottom: 6, borderRadius: 12, borderWidth: 1,
              borderColor: on ? c.primary : c.inputBorder,
              backgroundColor: on ? c.chipBg : 'transparent',
            }}
          >
            <View style={{
              width: 20, height: 20, borderRadius: 6, borderWidth: 2, marginTop: 1,
              borderColor: on ? c.primary : c.textFaint, backgroundColor: on ? c.primary : 'transparent',
              alignItems: 'center', justifyContent: 'center',
            }}>
              {on && <Text style={{ color: c.onColor, fontSize: 12, fontWeight: '800' }}>✓</Text>}
            </View>
            <View style={{ flex: 1 }}>
              <View style={{ flexDirection: 'row', gap: 8 }}>
                <Text style={{ flex: 1, color: c.text, fontWeight: '600', fontSize: 13 }} numberOfLines={1}>{t.merchant}</Text>
                <Text style={{ color: t.type === 'CREDIT' ? c.success : c.text, fontWeight: '700', fontSize: 13 }}>
                  {t.type === 'CREDIT' ? '+' : '-'}{inr(t.amount)}
                </Text>
              </View>
              <Text style={{ color: c.textFaint, fontSize: 11, marginTop: 2 }}>{day(t.date)}</Text>
              <Text style={{ color: c.textMuted, fontSize: 11, marginTop: 3 }}>⚠️ {reasonText(r)}</Text>
            </View>
          </TouchableOpacity>
        );
      })}

      <TouchableOpacity
        onPress={() => onAdd(rows.filter((_, i) => picked.has(i)))}
        disabled={picked.size === 0 || adding}
        style={{
          marginTop: 6, borderRadius: 100, paddingVertical: 12, alignItems: 'center',
          backgroundColor: c.primary, opacity: picked.size === 0 || adding ? 0.5 : 1,
        }}
      >
        {adding
          ? <ActivityIndicator color={c.onColor} />
          : <Text style={{ color: c.onColor, fontWeight: '700', fontSize: 14 }}>
              {picked.size === 0 ? 'Tick rows to add them' : `Add ${picked.size} selected anyway`}
            </Text>}
      </TouchableOpacity>
    </View>
  );
}
