import { useMemo } from 'react';
import {
  Modal, View, Text, TouchableOpacity, ScrollView, StyleSheet,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '@/context/ThemeContext';
import type { Theme } from '@/lib/theme';

export interface TxMatch {
  id: string;
  merchant: string;
  amount: number;
  date: string;
  type: string;
}

interface Props {
  visible: boolean;
  title: string;
  subtitle?: string;
  matches: TxMatch[];
  onPick: (transactionId: string | null) => void; // null = "record separately / create new"
  onClose: () => void;
}

function formatINR(n: number) {
  return new Intl.NumberFormat('en-IN', {
    style: 'currency', currency: 'INR', maximumFractionDigits: 0,
  }).format(n);
}

function shortDate(iso: string) {
  return new Date(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
}

// Shown when a payment could map to more than one bank transaction — the user
// picks which real transaction it is (so it's not double-counted), or chooses
// to record it separately.
export default function LinkTransactionSheet({ visible, title, subtitle, matches, onPick, onClose }: Props) {
  const { theme: c } = useTheme();
  const styles = useMemo(() => makeStyles(c), [c]);
  const insets = useSafeAreaInsets();

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <View style={styles.modalRoot}>
        <TouchableOpacity style={styles.backdrop} activeOpacity={1} onPress={onClose} />
        <View style={[styles.sheet, { paddingBottom: Math.max(insets.bottom, 24) }]}>
          <View style={styles.handle} />
          <View style={styles.header}>
            <View style={{ flex: 1 }}>
              <Text style={styles.title}>{title}</Text>
              {subtitle ? <Text style={styles.subtitle}>{subtitle}</Text> : null}
            </View>
            <TouchableOpacity onPress={onClose}><Text style={styles.closeBtn}>✕</Text></TouchableOpacity>
          </View>

          <Text style={styles.help}>
            We found matching bank transactions. Pick the one this is, so it isn't counted twice.
          </Text>

          <ScrollView style={{ maxHeight: 320 }} showsVerticalScrollIndicator={false}>
            {matches.map(m => (
              <TouchableOpacity key={m.id} style={styles.row} activeOpacity={0.7} onPress={() => onPick(m.id)}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.merchant} numberOfLines={1}>{m.merchant}</Text>
                  <Text style={styles.meta}>{shortDate(m.date)} · {m.type}</Text>
                </View>
                <Text style={styles.amount}>{formatINR(m.amount)}</Text>
                <Text style={styles.linkIcon}>🔗</Text>
              </TouchableOpacity>
            ))}
          </ScrollView>

          <TouchableOpacity style={styles.noneBtn} onPress={() => onPick(null)}>
            <Text style={styles.noneText}>None of these — record separately</Text>
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
}

const makeStyles = (c: Theme) => StyleSheet.create({
  modalRoot: { flex: 1 },
  backdrop: { flex: 1, backgroundColor: c.overlay },
  sheet: {
    backgroundColor: c.card,
    borderTopLeftRadius: 24, borderTopRightRadius: 24,
    paddingHorizontal: 20, paddingTop: 12,
  },
  handle: { width: 40, height: 4, backgroundColor: c.inputBorder, borderRadius: 2, alignSelf: 'center', marginBottom: 16 },
  header: { flexDirection: 'row', alignItems: 'center', marginBottom: 6 },
  title: { fontSize: 18, fontWeight: '700', color: c.text },
  subtitle: { fontSize: 12, color: c.textMuted, marginTop: 2 },
  closeBtn: { fontSize: 18, color: c.textFaint, padding: 4 },
  help: { fontSize: 12, color: c.textFaint, marginBottom: 12 },

  row: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    backgroundColor: c.chipBg, borderRadius: 12, padding: 12, marginBottom: 8,
    borderWidth: 1, borderColor: c.cardBorder,
  },
  merchant: { fontSize: 14, fontWeight: '600', color: c.text },
  meta: { fontSize: 11, color: c.textFaint, marginTop: 1 },
  amount: { fontSize: 14, fontWeight: '700', color: c.text },
  linkIcon: { fontSize: 15 },

  noneBtn: {
    borderRadius: 12, paddingVertical: 14, alignItems: 'center', marginTop: 6,
    borderWidth: 1, borderColor: c.inputBorder,
  },
  noneText: { fontSize: 14, fontWeight: '600', color: c.textMuted },
});
