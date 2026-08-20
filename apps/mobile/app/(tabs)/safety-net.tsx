import { useMemo, useState } from 'react';
import {
  View, Text, ScrollView, TouchableOpacity, TextInput, StyleSheet, RefreshControl,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTheme } from '@/context/ThemeContext';
import type { Theme } from '@/lib/theme';
import {
  useSafetyNet, useEmergencyFund, useEssentialOverrides, useTrimmed,
  formatINR, formatMonths,
} from '@/lib/safetyNet';
import FirstWeekChecklist from '@/components/FirstWeekChecklist';

export default function SafetyNetScreen() {
  const { theme: c } = useTheme();
  const styles = useMemo(() => makeStyles(c), [c]);

  const sn = useSafetyNet();
  const { setFund } = useEmergencyFund();
  const { setEssential } = useEssentialOverrides();
  const { trimmed, toggleTrim } = useTrimmed();
  const trimmedSet = new Set(trimmed);

  const [editingFund, setEditingFund] = useState(false);
  const [draft, setDraft] = useState('');

  function startEdit() {
    setDraft(String(Math.round(sn.fund || sn.suggestedFund || 0)));
    setEditingFund(true);
  }
  async function saveFund() {
    const n = Number(draft.replace(/[^0-9.]/g, ''));
    await setFund(isFinite(n) && n > 0 ? n : null);
    setEditingFund(false);
  }
  async function useEstimate() {
    await setFund(null);
    setEditingFund(false);
  }

  const months = sn.survivalMonths;
  const color = months == null ? c.textFaint : months >= 6 ? c.success : months >= 3 ? c.warning : c.danger;
  const pct = months == null ? 0 : Math.min(100, (months / 6) * 100);
  const verdict =
    months == null ? 'Add your fund + a little spending history to see this'
      : months >= 6 ? 'You’re well cushioned — 6+ months of essentials covered.'
        : months >= 3 ? 'A decent buffer. Aim for 6 months to feel safe.'
          : 'This is thin. Building even one more month makes a real difference.';

  const trimActive = trimmed.length > 0;
  const commitments = sn.emiMonthly + sn.essentialRecurringMonthly;

  return (
    <SafeAreaView style={styles.safe} edges={['bottom']}>
      <ScrollView
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
        refreshControl={<RefreshControl refreshing={sn.refreshing} onRefresh={sn.refetch} />}
      >
        <Text style={styles.intro}>
          If your income stopped today, how long could you keep the lights on? This is your runway —
          and how to stretch it.
        </Text>

        {sn.error && (
          <View style={styles.errorCard}>
            <Text style={styles.errorText}>Couldn’t load your numbers.</Text>
            <TouchableOpacity onPress={sn.refetch}><Text style={styles.errorRetry}>Retry</Text></TouchableOpacity>
          </View>
        )}

        {/* ── Runway hero ── */}
        <View style={styles.hero}>
          <Text style={styles.heroLabel}>Runway on essentials</Text>
          <Text style={[styles.heroMonths, { color }]}>{formatMonths(months)}</Text>
          <View style={styles.track}>
            <View style={[styles.fill, { width: `${pct}%`, backgroundColor: color }]} />
          </View>
          <Text style={[styles.heroVerdict, { color }]}>{verdict}</Text>
          {sn.currentMonths != null && (
            <Text style={styles.heroContrast}>
              Keeping everything as you spend now: {formatMonths(sn.currentMonths)}
            </Text>
          )}
        </View>

        {/* ── Emergency fund ── */}
        <View style={styles.card}>
          <View style={styles.cardHead}>
            <Text style={styles.cardTitle}>💰  Emergency fund</Text>
            {!editingFund && (
              <TouchableOpacity onPress={startEdit}><Text style={styles.action}>Edit</Text></TouchableOpacity>
            )}
          </View>

          {editingFund ? (
            <>
              <TextInput
                style={styles.input}
                value={draft}
                onChangeText={setDraft}
                keyboardType="numeric"
                placeholder="What could you actually live on?"
                placeholderTextColor={c.textFaint}
                autoFocus
              />
              <View style={styles.editRow}>
                <TouchableOpacity style={styles.saveBtn} onPress={saveFund} activeOpacity={0.85}>
                  <Text style={styles.saveBtnText}>Save</Text>
                </TouchableOpacity>
                <TouchableOpacity style={styles.ghostBtn} onPress={useEstimate} activeOpacity={0.7}>
                  <Text style={styles.ghostBtnText}>Use estimate ({formatINR(sn.suggestedFund)})</Text>
                </TouchableOpacity>
              </View>
            </>
          ) : (
            <>
              <Text style={styles.fundAmount}>{formatINR(sn.fund)}</Text>
              <Text style={styles.fundTag}>{sn.fundIsCustom ? 'Your number' : 'Smart estimate'}</Text>
              <Text style={styles.fundBreak}>
                Cash in hand {formatINR(sn.cashInHand)}  ·  Liquid investments {formatINR(sn.liquidInvestments)}
              </Text>
            </>
          )}
          <Text style={styles.note}>
            The app can’t see your bank balances — only you know what you could truly live on. Set that number
            here; it stays on your device.
          </Text>
        </View>

        {/* ── Where the money goes ── */}
        {sn.hasData && (
          <View style={styles.card}>
            <View style={styles.cardHead}>
              <Text style={styles.cardTitle}>📊  Where your money goes</Text>
              <Text style={styles.cardHint}>avg / mo · {sn.monthsAveraged} mo</Text>
            </View>

            <View style={styles.splitRow}>
              <View style={styles.splitCell}>
                <Text style={[styles.splitAmt, { color: c.text }]}>{formatINR(sn.essentialMonthly)}</Text>
                <Text style={styles.splitLabel}>Essential</Text>
              </View>
              <View style={styles.splitDivider} />
              <View style={styles.splitCell}>
                <Text style={[styles.splitAmt, { color: c.textMuted }]}>{formatINR(sn.optionalMonthly)}</Text>
                <Text style={styles.splitLabel}>Optional</Text>
              </View>
            </View>

            <Text style={styles.subhint}>Tap a category to change whether it’s essential.</Text>

            {sn.categories.map(cat => (
              <TouchableOpacity
                key={cat.name}
                style={styles.catRow}
                activeOpacity={0.6}
                onPress={() => setEssential(cat.name, !cat.essential)}
              >
                <Text style={styles.catIcon}>{cat.icon}</Text>
                <Text style={styles.catName} numberOfLines={1}>{cat.name}</Text>
                <Text style={styles.catAmt}>{formatINR(cat.avgMonthly)}</Text>
                <View style={[styles.tag, cat.essential ? styles.tagEssential : styles.tagOptional]}>
                  <Text style={[styles.tagText, { color: cat.essential ? c.successDeep : c.textMuted }]}>
                    {cat.essential ? 'Essential' : 'Optional'}
                  </Text>
                </View>
              </TouchableOpacity>
            ))}

            {sn.uncategorizedMonthly > 0 && (
              <View style={styles.catRow}>
                <Text style={styles.catIcon}>❓</Text>
                <Text style={styles.catName} numberOfLines={1}>Uncategorised</Text>
                <Text style={styles.catAmt}>{formatINR(sn.uncategorizedMonthly)}</Text>
                <View style={[styles.tag, styles.tagEssential]}>
                  <Text style={[styles.tagText, { color: c.successDeep }]}>Counted</Text>
                </View>
              </View>
            )}
          </View>
        )}

        {/* ── Trim to extend ── */}
        {sn.trimItems.length > 0 && (
          <View style={styles.card}>
            <Text style={styles.cardTitle}>✂️  Trim to extend your runway</Text>
            <Text style={styles.subhint}>
              Tick what you’d actually cut. It’s a what-if — nothing is changed for real.
            </Text>

            {trimActive && (
              <View style={styles.trimBanner}>
                <Text style={styles.trimBannerText}>
                  Cutting these → <Text style={{ color: c.success, fontWeight: '800' }}>{formatMonths(sn.trimmedMonths)}</Text>
                  {sn.currentMonths != null && <Text style={styles.trimWas}>  (was {formatMonths(sn.currentMonths)})</Text>}
                </Text>
              </View>
            )}

            {sn.trimItems.map(item => {
              const cut = trimmedSet.has(item.id);
              return (
                <TouchableOpacity
                  key={item.id}
                  style={styles.trimRow}
                  activeOpacity={0.6}
                  onPress={() => toggleTrim(item.id)}
                  accessibilityRole="checkbox"
                  accessibilityState={{ checked: cut }}
                >
                  <View style={[styles.checkbox, cut && { backgroundColor: c.success, borderColor: c.success }]}>
                    {cut && <Text style={styles.tick}>✓</Text>}
                  </View>
                  <Text style={styles.catIcon}>{item.icon}</Text>
                  <Text style={[styles.catName, cut && styles.cutName]} numberOfLines={1}>{item.label}</Text>
                  <Text style={[styles.catAmt, cut && styles.cutName]}>{formatINR(item.monthly)}/mo</Text>
                </TouchableOpacity>
              );
            })}
          </View>
        )}

        {/* ── Fixed commitments ── */}
        {commitments > 0 && (
          <View style={styles.card}>
            <Text style={styles.cardTitle}>🔒  Fixed monthly commitments</Text>
            {sn.emiMonthly > 0 && (
              <View style={styles.commitRow}>
                <Text style={styles.commitLabel}>Loan EMIs</Text>
                <Text style={styles.commitAmt}>{formatINR(sn.emiMonthly)}</Text>
              </View>
            )}
            {sn.essentialRecurringMonthly > 0 && (
              <View style={styles.commitRow}>
                <Text style={styles.commitLabel}>Essential bills & subscriptions</Text>
                <Text style={styles.commitAmt}>{formatINR(sn.essentialRecurringMonthly)}</Text>
              </View>
            )}
            <View style={[styles.commitRow, styles.commitTotal]}>
              <Text style={styles.commitTotalLabel}>Must cover each month</Text>
              <Text style={styles.commitTotalAmt}>{formatINR(commitments)}</Text>
            </View>
            <Text style={styles.note}>
              These are already part of your spending above — shown so you know the minimum you can’t skip.
            </Text>
          </View>
        )}

        {/* First-week action plan — what to actually do, in order */}
        <FirstWeekChecklist />

        <Text style={styles.disclaimer}>
          A guide, not a guarantee. Runway = your emergency fund ÷ average essential spend. Keep your
          transactions up to date for the sharpest picture.
        </Text>
      </ScrollView>
    </SafeAreaView>
  );
}

const makeStyles = (c: Theme) => StyleSheet.create({
  safe: { flex: 1, backgroundColor: c.bg },
  content: { padding: 16, gap: 12, paddingBottom: 40 },
  intro: { fontSize: 13, color: c.textMuted, lineHeight: 19 },

  errorCard: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    backgroundColor: c.card, borderRadius: 12, padding: 14, borderWidth: 1, borderColor: c.danger,
  },
  errorText: { color: c.text, fontSize: 13 },
  errorRetry: { color: c.primary, fontWeight: '700', fontSize: 13 },

  // Hero
  hero: {
    backgroundColor: c.card, borderRadius: 16, padding: 18, borderWidth: 1, borderColor: c.cardBorder, gap: 10,
  },
  heroLabel: { fontSize: 13, color: c.textMuted, fontWeight: '600' },
  heroMonths: { fontSize: 44, fontWeight: '800', letterSpacing: -0.5 },
  heroVerdict: { fontSize: 13.5, fontWeight: '700', lineHeight: 19 },
  heroContrast: { fontSize: 12.5, color: c.textFaint },

  track: { height: 10, backgroundColor: c.track, borderRadius: 99, overflow: 'hidden' },
  fill: { height: '100%', borderRadius: 99 },

  // Cards
  card: { backgroundColor: c.card, borderRadius: 16, padding: 16, borderWidth: 1, borderColor: c.cardBorder, gap: 10 },
  cardHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  cardTitle: { fontSize: 14.5, fontWeight: '700', color: c.text },
  cardHint: { fontSize: 11.5, color: c.textFaint },
  action: { fontSize: 13, fontWeight: '700', color: c.primary },
  subhint: { fontSize: 12, color: c.textFaint, lineHeight: 17 },
  note: { fontSize: 11.5, color: c.textFaint, lineHeight: 16, fontStyle: 'italic' },

  // Fund
  fundAmount: { fontSize: 30, fontWeight: '800', color: c.text },
  fundTag: { fontSize: 12, color: c.primary, fontWeight: '700', marginTop: -4 },
  fundBreak: { fontSize: 12.5, color: c.textMuted },
  input: {
    backgroundColor: c.inputBg, borderWidth: 1, borderColor: c.inputBorder, borderRadius: 12,
    padding: 12, fontSize: 18, fontWeight: '700', color: c.text,
  },
  editRow: { flexDirection: 'row', gap: 10, alignItems: 'center', flexWrap: 'wrap' },
  saveBtn: { backgroundColor: c.primary, borderRadius: 10, paddingVertical: 10, paddingHorizontal: 22 },
  saveBtnText: { color: c.onColor, fontWeight: '800', fontSize: 14 },
  ghostBtn: { paddingVertical: 10, flexShrink: 1 },
  ghostBtnText: { color: c.textMuted, fontWeight: '600', fontSize: 12.5 },

  // Essential/optional split
  splitRow: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: c.chipBg, borderRadius: 12, borderWidth: 1, borderColor: c.chipBorder, paddingVertical: 12,
  },
  splitCell: { flex: 1, alignItems: 'center', gap: 2 },
  splitDivider: { width: 1, alignSelf: 'stretch', backgroundColor: c.cardBorder },
  splitAmt: { fontSize: 17, fontWeight: '800' },
  splitLabel: { fontSize: 11.5, color: c.textMuted, fontWeight: '600' },

  catRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 7 },
  catIcon: { fontSize: 16 },
  catName: { flex: 1, fontSize: 14, color: c.text, fontWeight: '500' },
  catAmt: { fontSize: 13, color: c.textMuted, fontWeight: '600' },
  cutName: { color: c.textFaint, textDecorationLine: 'line-through' },

  tag: { borderRadius: 99, paddingHorizontal: 9, paddingVertical: 3, borderWidth: 1, minWidth: 64, alignItems: 'center' },
  tagEssential: { backgroundColor: 'rgba(34,197,94,0.12)', borderColor: 'rgba(34,197,94,0.35)' },
  tagOptional: { backgroundColor: c.chipBg, borderColor: c.chipBorder },
  tagText: { fontSize: 11, fontWeight: '700' },

  // Trim
  trimBanner: { backgroundColor: 'rgba(34,197,94,0.10)', borderRadius: 10, padding: 10 },
  trimBannerText: { fontSize: 13, color: c.text, fontWeight: '600' },
  trimWas: { fontSize: 12, color: c.textFaint, fontWeight: '500' },
  trimRow: { flexDirection: 'row', alignItems: 'center', gap: 11, paddingVertical: 7 },
  checkbox: {
    width: 24, height: 24, borderRadius: 12, borderWidth: 2, borderColor: c.inputBorder,
    alignItems: 'center', justifyContent: 'center',
  },
  tick: { color: c.onColor, fontSize: 13, fontWeight: '900', lineHeight: 15 },

  // Fixed commitments
  commitRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 4 },
  commitLabel: { fontSize: 13.5, color: c.textMuted },
  commitAmt: { fontSize: 13.5, color: c.text, fontWeight: '600' },
  commitTotal: { borderTopWidth: 1, borderTopColor: c.cardBorder, paddingTop: 9, marginTop: 2 },
  commitTotalLabel: { fontSize: 14, color: c.text, fontWeight: '700' },
  commitTotalAmt: { fontSize: 15, color: c.text, fontWeight: '800' },

  disclaimer: { fontSize: 11, color: c.textFaint, lineHeight: 16, fontStyle: 'italic', marginTop: 4 },
});
