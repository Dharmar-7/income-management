import { useMemo, useState } from 'react';
import {
  View, Text, TextInput, ScrollView, TouchableOpacity, StyleSheet,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTheme } from '@/context/ThemeContext';
import type { Theme } from '@/lib/theme';
import {
  METRICS, SECTORS, evaluateStock,
  type Sector, type Rating, type MetricCategory,
} from '@/lib/stockEval';

const CATEGORY_ORDER: MetricCategory[] = ['Valuation', 'Profitability', 'Financial health', 'Growth'];

export default function StockCheckScreen() {
  const { theme: c } = useTheme();
  const styles = useMemo(() => makeStyles(c), [c]);

  const [name, setName] = useState('');
  const [sector, setSector] = useState<Sector>('general');
  const [inputs, setInputs] = useState<Record<string, string>>({});

  const result = useMemo(() => evaluateStock(inputs, sector), [inputs, sector]);
  const hasResult = result.scoredCount > 0;

  const ratingColor = (r: Rating) => (r === 'good' ? c.success : r === 'ok' ? c.warning : c.danger);
  const toneColor = (t: Rating | 'neutral') =>
    t === 'good' ? c.success : t === 'ok' ? c.warning : t === 'weak' ? c.danger : c.textMuted;
  const verdictColor =
    result.verdict === 'Strong' ? c.success : result.verdict === 'Mixed' ? c.warning : c.danger;

  function setField(key: string, text: string) {
    setInputs(prev => ({ ...prev, [key]: text }));
  }

  return (
    <SafeAreaView style={styles.safe} edges={['bottom']}>
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <Text style={styles.intro}>
          A health check on a stock’s fundamentals. Enter whatever numbers you have — it rates each and
          gives an overall read. It’s a guide to the numbers, not a buy/sell call.
        </Text>

        <TextInput
          style={styles.nameInput}
          placeholder="Stock name (optional)"
          placeholderTextColor={c.textFaint}
          value={name}
          onChangeText={setName}
        />

        {/* Sector — thresholds adapt so a bank's debt or an IT firm's P/E is judged fairly */}
        <Text style={styles.pickLabel}>Sector</Text>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.sectorRow}>
          {SECTORS.map(s => {
            const active = s.key === sector;
            return (
              <TouchableOpacity
                key={s.key}
                style={[styles.chip, active ? styles.chipActive : styles.chipIdle]}
                onPress={() => setSector(s.key)}
                activeOpacity={0.7}
              >
                <Text style={[styles.chipText, { color: active ? c.contrastText : c.textMuted }]}>{s.label}</Text>
              </TouchableOpacity>
            );
          })}
        </ScrollView>

        {/* Metric inputs, grouped */}
        {CATEGORY_ORDER.map(cat => (
          <View key={cat} style={styles.group}>
            <Text style={styles.groupTitle}>{cat}</Text>
            {METRICS.filter(m => m.category === cat).map(m => (
              <View key={m.key} style={styles.mRow}>
                <Text style={styles.mLabel}>{m.label}</Text>
                <View style={styles.inputWrap}>
                  <TextInput
                    style={styles.mInput}
                    value={inputs[m.key] ?? ''}
                    onChangeText={t => setField(m.key, t)}
                    keyboardType="numbers-and-punctuation"
                    placeholder="—"
                    placeholderTextColor={c.textFaint}
                  />
                  <Text style={styles.unit}>{m.unit === 'x' ? '×' : m.unit}</Text>
                </View>
              </View>
            ))}
          </View>
        ))}

        {/* Result */}
        {hasResult && result.verdict && (
          <View style={styles.result}>
            <View style={styles.scoreRow}>
              <View style={[styles.scoreCircle, { borderColor: verdictColor }]}>
                <Text style={[styles.scoreNum, { color: verdictColor }]}>{result.score}</Text>
                <Text style={styles.scoreOf}>/100</Text>
              </View>
              <View style={{ flex: 1 }}>
                <Text style={[styles.verdict, { color: verdictColor }]}>{result.verdict} fundamentals</Text>
                <Text style={styles.verdictSub}>
                  {name.trim() ? `${name.trim()} · ` : ''}based on {result.scoredCount} metric{result.scoredCount === 1 ? '' : 's'} you entered
                </Text>
              </View>
            </View>

            {/* Growth + value — "is it growing, and is that growth worth the price?" */}
            {(result.growth || result.value) && (
              <View style={styles.gvCard}>
                {result.growth && (
                  <View style={styles.gvBlock}>
                    <Text style={styles.gvKicker}>{result.growth.emoji}  GROWTH PROFILE</Text>
                    <Text style={[styles.gvLabel, { color: toneColor(result.growth.tone) }]}>{result.growth.label}</Text>
                    {result.growth.parts.length > 0 && <Text style={styles.gvSub}>{result.growth.parts.join('   ·   ')}</Text>}
                    {result.growth.quality ? <Text style={styles.gvNote}>{result.growth.quality}</Text> : null}
                  </View>
                )}
                {result.value && (
                  <View style={styles.gvBlock}>
                    <Text style={styles.gvKicker}>💰  PRICED FOR GROWTH?</Text>
                    <Text style={[styles.gvLabel, { color: toneColor(result.value.tone) }]}>{result.value.label}</Text>
                    {result.value.peg != null && (
                      <View style={styles.track}>
                        <View style={[styles.fill, { width: `${result.value.fillPct}%`, backgroundColor: toneColor(result.value.tone) }]} />
                      </View>
                    )}
                    <Text style={styles.gvNote}>{result.value.note}</Text>
                  </View>
                )}
                <Text style={styles.gvCaption}>Describes the company today — not a forecast of the share price.</Text>
              </View>
            )}

            {result.categories.filter(cat => cat.scored > 0).map(cat => (
              <View key={cat.name} style={styles.catBlock}>
                <View style={styles.catHead}>
                  <Text style={styles.catName}>{cat.name}</Text>
                  {cat.pct != null && <Text style={styles.catPct}>{cat.pct}%</Text>}
                </View>
                {cat.pct != null && (
                  <View style={styles.track}>
                    <View style={[styles.fill, { width: `${cat.pct}%`, backgroundColor: cat.pct >= 70 ? c.success : cat.pct >= 45 ? c.warning : c.danger }]} />
                  </View>
                )}
                {cat.results.map(r => (
                  <View key={r.key} style={styles.metricRow}>
                    <View style={[styles.dot, { backgroundColor: ratingColor(r.rating) }]} />
                    <Text style={styles.metricLabel}>{r.label}</Text>
                    <Text style={[styles.metricVal, { color: ratingColor(r.rating) }]}>
                      {r.value}{r.unit === 'x' ? '×' : r.unit}
                    </Text>
                    <Text style={styles.metricHint} numberOfLines={2}>{r.hint}</Text>
                  </View>
                ))}
              </View>
            ))}

            {result.naNotes.length > 0 && (
              <View style={styles.naBox}>
                {result.naNotes.map((note, i) => (
                  <Text key={i} style={styles.naText}>• {note}</Text>
                ))}
              </View>
            )}

            <Text style={styles.disclaimer}>
              Educational only — not investment advice. Ratios are rules of thumb and must be read in context
              (sector, cycle, quality of earnings). A “Strong” read isn’t a buy, and a “Weak” one isn’t a sell.
              Always do your own research.
            </Text>
          </View>
        )}

        {!hasResult && (
          <Text style={styles.emptyHint}>Fill in a few numbers above to see the health check.</Text>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const makeStyles = (c: Theme) => StyleSheet.create({
  safe: { flex: 1, backgroundColor: c.bg },
  content: { padding: 16, gap: 12, paddingBottom: 40 },
  intro: { fontSize: 13, color: c.textMuted, lineHeight: 19 },

  nameInput: {
    backgroundColor: c.inputBg, borderWidth: 1, borderColor: c.inputBorder, borderRadius: 12,
    padding: 12, fontSize: 15, color: c.text,
  },

  pickLabel: { fontSize: 12, fontWeight: '700', color: c.textFaint, letterSpacing: 0.6, textTransform: 'uppercase', marginTop: 2 },
  sectorRow: { gap: 8, paddingVertical: 2, paddingRight: 8 },
  chip: { borderRadius: 99, paddingHorizontal: 14, paddingVertical: 8, borderWidth: 1 },
  chipIdle: { backgroundColor: c.card, borderColor: c.inputBorder },
  chipActive: { backgroundColor: c.contrast, borderColor: c.contrast },
  chipText: { fontSize: 13, fontWeight: '700' },

  group: { backgroundColor: c.card, borderRadius: 16, padding: 14, borderWidth: 1, borderColor: c.cardBorder, gap: 4 },
  groupTitle: { fontSize: 13, fontWeight: '800', color: c.textMuted, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 4 },
  mRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 5 },
  mLabel: { flex: 1, fontSize: 14, color: c.text },
  inputWrap: { flexDirection: 'row', alignItems: 'center', gap: 4, width: 96 },
  mInput: {
    flex: 1, backgroundColor: c.inputBg, borderWidth: 1, borderColor: c.inputBorder, borderRadius: 10,
    paddingVertical: 8, paddingHorizontal: 10, fontSize: 15, fontWeight: '600', color: c.text, textAlign: 'right',
  },
  unit: { fontSize: 13, color: c.textFaint, width: 14 },

  result: { gap: 12, marginTop: 4 },
  scoreRow: {
    flexDirection: 'row', alignItems: 'center', gap: 16,
    backgroundColor: c.card, borderRadius: 16, padding: 16, borderWidth: 1, borderColor: c.cardBorder,
  },
  scoreCircle: { width: 82, height: 82, borderRadius: 41, borderWidth: 5, alignItems: 'center', justifyContent: 'center' },
  scoreNum: { fontSize: 28, fontWeight: '800' },
  scoreOf: { fontSize: 11, color: c.textFaint, marginTop: -2 },
  verdict: { fontSize: 18, fontWeight: '800' },
  verdictSub: { fontSize: 12.5, color: c.textMuted, marginTop: 4, lineHeight: 17 },

  gvCard: { backgroundColor: c.card, borderRadius: 16, padding: 16, borderWidth: 1, borderColor: c.cardBorder, gap: 14 },
  gvBlock: { gap: 6 },
  gvKicker: { fontSize: 11.5, fontWeight: '800', color: c.textMuted, letterSpacing: 0.6 },
  gvLabel: { fontSize: 20, fontWeight: '800' },
  gvSub: { fontSize: 13, color: c.text, fontWeight: '600' },
  gvNote: { fontSize: 12.5, color: c.textMuted, lineHeight: 17 },
  gvCaption: { fontSize: 11, color: c.textFaint, fontStyle: 'italic' },

  catBlock: { backgroundColor: c.card, borderRadius: 14, padding: 14, borderWidth: 1, borderColor: c.cardBorder, gap: 8 },
  catHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  catName: { fontSize: 13.5, fontWeight: '700', color: c.text },
  catPct: { fontSize: 13, fontWeight: '800', color: c.textMuted },
  track: { height: 6, backgroundColor: c.track, borderRadius: 99, overflow: 'hidden' },
  fill: { height: '100%', borderRadius: 99 },

  metricRow: { flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' },
  dot: { width: 8, height: 8, borderRadius: 4 },
  metricLabel: { fontSize: 13.5, color: c.text, fontWeight: '500' },
  metricVal: { fontSize: 13.5, fontWeight: '800' },
  metricHint: { flex: 1, fontSize: 12, color: c.textMuted, minWidth: 120 },

  naBox: { backgroundColor: c.chipBg, borderRadius: 12, borderWidth: 1, borderColor: c.chipBorder, padding: 12, gap: 4 },
  naText: { fontSize: 12, color: c.textMuted, lineHeight: 17 },

  disclaimer: { fontSize: 11, color: c.textFaint, lineHeight: 16, fontStyle: 'italic' },
  emptyHint: { fontSize: 13, color: c.textFaint, textAlign: 'center', marginTop: 8 },
});
