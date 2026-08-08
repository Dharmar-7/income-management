import { useMemo, useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { useTheme } from '@/context/ThemeContext';
import type { Theme } from '@/lib/theme';
import TransactionPickerSheet, { type PickerTx } from '@/components/TransactionPickerSheet';

interface Props {
  label?: string;
  value: PickerTx | null;
  onChange: (tx: PickerTx | null) => void;
  suggestAmount?: number;
  type?: string; // restrict picker to a tx type, e.g. 'DEBIT'
  pickerTitle?: string;
  pickerSubtitle?: string;
  helpText?: string;
}

function formatINR(n: number) {
  return new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).format(n);
}
function shortDate(iso: string) {
  return new Date(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: '2-digit' });
}

// A form field for linking a bank transaction. Shows a "pick" button, or the
// linked transaction as a removable chip. Opening it launches the searchable
// TransactionPickerSheet. Fully optional — the user can leave it unlinked.
export default function TransactionLinkField({
  label, value, onChange, suggestAmount, type, pickerTitle, pickerSubtitle, helpText,
}: Props) {
  const { theme: c } = useTheme();
  const styles = useMemo(() => makeStyles(c), [c]);
  const [open, setOpen] = useState(false);

  return (
    <View style={styles.field}>
      {label ? <Text style={styles.label}>{label}</Text> : null}

      {value ? (
        <View style={styles.chip}>
          <Text style={styles.linkIcon}>🔗</Text>
          <View style={{ flex: 1 }}>
            <Text style={styles.chipMerchant} numberOfLines={1}>{value.merchant}</Text>
            <Text style={styles.chipMeta}>{formatINR(value.amount)} · {shortDate(value.date)}</Text>
          </View>
          <TouchableOpacity onPress={() => onChange(null)} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
            <Text style={styles.clear}>✕</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <TouchableOpacity style={styles.pickBtn} onPress={() => setOpen(true)} activeOpacity={0.7}>
          <Text style={styles.pickText}>＋ Pick a transaction</Text>
          <Text style={styles.chevron}>▸</Text>
        </TouchableOpacity>
      )}

      {helpText ? <Text style={styles.help}>{helpText}</Text> : null}

      {open && (
        <TransactionPickerSheet
          visible
          suggestAmount={suggestAmount}
          type={type}
          title={pickerTitle}
          subtitle={pickerSubtitle}
          onClose={() => setOpen(false)}
          onPick={(tx) => { onChange(tx); setOpen(false); }}
        />
      )}
    </View>
  );
}

const makeStyles = (c: Theme) => StyleSheet.create({
  field: { marginBottom: 14 },
  label: { fontSize: 12, fontWeight: '500', color: c.textMuted, marginBottom: 6 },
  pickBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    borderWidth: 1, borderColor: c.inputBorder, borderRadius: 12,
    paddingHorizontal: 14, paddingVertical: 12, backgroundColor: c.inputBg,
  },
  pickText: { fontSize: 14, color: c.primary, fontWeight: '600' },
  chevron: { fontSize: 14, color: c.textFaint },
  chip: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    borderWidth: 1, borderColor: c.primary, borderRadius: 12,
    paddingHorizontal: 12, paddingVertical: 10, backgroundColor: c.chipBg,
  },
  linkIcon: { fontSize: 15 },
  chipMerchant: { fontSize: 14, fontWeight: '600', color: c.text },
  chipMeta: { fontSize: 11, color: c.textFaint, marginTop: 1 },
  clear: { fontSize: 15, color: c.textFaint, paddingHorizontal: 4 },
  help: { fontSize: 11, color: c.textFaint, marginTop: 6 },
});
