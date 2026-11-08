import { useMemo, useState } from 'react';
import { View, Text, Switch, TouchableOpacity, StyleSheet } from 'react-native';
import { compareRegimes, verdictLine, EMPTY_TAX_INPUT, RULES, type RegimeResult } from '@/lib/brain/tax';
import { cashflowBasics } from '@/lib/brain/planners';
import { inr } from '@/lib/brain/core';
import type { BrainData } from '@/lib/brain/useBrainData';
import { useMoneyProfile } from '@/lib/moneyProfile';
import { useToast } from '@/context/ToastContext';
import { hSelect, hSuccess } from '@/lib/haptics';
import { Card, Muted, Faint, ListRow, NumberField, LinkButton, PrimaryButton, toNum, useBrainStyles } from './ui';

// 🧾 Tax — old vs new regime, side by side, for your income and deductions.

export default function TaxPanel({ data }: { data: BrainData }) {
  const { c, s } = useBrainStyles();
  const toast = useToast();
  const { profile, update } = useMoneyProfile();

  const [gross, setGross] = useState('');
  const [salaried, setSalaried] = useState(true);
  const [showDeductions, setShowDeductions] = useState(false);
  const [d80c, setD80c] = useState('');
  const [d80dSelf, setD80dSelf] = useState('');
  const [d80dParents, setD80dParents] = useState('');
  const [parentsSenior, setParentsSenior] = useState(false);
  const [nps, setNps] = useState('');
  const [hra, setHra] = useState('');
  const [homeLoan, setHomeLoan] = useState('');
  const [other, setOther] = useState('');

  const basics = useMemo(() => cashflowBasics(data.txs, new Date()), [data.txs]);
  const income = toNum(gross);

  const cmp = useMemo(() => income > 0 ? compareRegimes({
    ...EMPTY_TAX_INPUT,
    grossIncome: income, salaried, age: profile.age,
    sec80C: toNum(d80c), sec80dSelf: toNum(d80dSelf), sec80dParents: toNum(d80dParents), parentsSenior,
    nps80ccd1b: toNum(nps), hraExemption: toNum(hra), homeLoanInterest: toNum(homeLoan), otherDeductions: toNum(other),
  }) : null, [income, salaried, profile.age, d80c, d80dSelf, d80dParents, parentsSenior, nps, hra, homeLoan, other]);

  async function adoptRegime(regime: 'old' | 'new') {
    await update({ regime });
    hSuccess();
    toast.show(`Saved: ${regime === 'new' ? 'New' : 'Old'} regime. The Coach's calendar now follows it.`, { type: 'success' });
  }

  return (
    <View style={{ gap: 12 }}>
      <Card title={`🧾 Old vs new regime · FY ${RULES.fy}`}>
        <NumberField label="Annual income (₹)" value={gross} onChange={setGross} placeholder="e.g. 1500000" hint="Gross salary + other income before tax. Exclude capital gains." />
        {basics.avgIncome > 0 && (
          <LinkButton
            label={`Use my average income × 12 (${inr(basics.avgIncome * 12)})`}
            onPress={() => { hSelect(); setGross(String(Math.round(basics.avgIncome * 12))); }}
          />
        )}
        <View style={styles.toggle}>
          <Text style={[styles.toggleLabel, { color: c.text }]}>I'm salaried (standard deduction)</Text>
          <Switch value={salaried} onValueChange={v => { hSelect(); setSalaried(v); }} trackColor={{ true: c.primary, false: c.track }} thumbColor="#fff" />
        </View>
        {profile.age == null && <Faint>Set your age in the Investment Coach profile for senior-citizen slabs.</Faint>}

        <TouchableOpacity onPress={() => { hSelect(); setShowDeductions(v => !v); }} activeOpacity={0.7} style={styles.expand}>
          <Text style={s.link}>{showDeductions ? '− Hide' : '+ Add'} old-regime deductions (80C, 80D, HRA, home loan…)</Text>
        </TouchableOpacity>
        {showDeductions && (
          <View style={{ gap: 10 }}>
            <NumberField label="80C: ELSS, PPF, EPF, LIC, tuition" value={d80c} onChange={setD80c} hint={`Capped at ${inr(RULES.oldRegime.caps.sec80C)}.`} />
            <NumberField label="80D: health insurance (you & family)" value={d80dSelf} onChange={setD80dSelf} />
            <NumberField label="80D: health insurance (parents)" value={d80dParents} onChange={setD80dParents} />
            <View style={styles.toggle}>
              <Text style={[styles.toggleLabel, { color: c.text }]}>Parents are 60+</Text>
              <Switch value={parentsSenior} onValueChange={v => { hSelect(); setParentsSenior(v); }} trackColor={{ true: c.primary, false: c.track }} thumbColor="#fff" />
            </View>
            <NumberField label="80CCD(1B): your own NPS" value={nps} onChange={setNps} hint={`Up to ${inr(RULES.oldRegime.caps.nps80ccd1b)}.`} />
            <NumberField label="HRA exemption" value={hra} onChange={setHra} hint="The exempt part shown on your payslip / Form 16." />
            <NumberField label="Home loan interest, 24(b)" value={homeLoan} onChange={setHomeLoan} hint={`Self-occupied: up to ${inr(RULES.oldRegime.caps.homeLoan24b)}.`} />
            <NumberField label="Other deductions (80E, 80G…)" value={other} onChange={setOther} />
          </View>
        )}
      </Card>

      {cmp && (
        <>
          <Card title="Result">
            <Text style={[styles.verdict, { color: cmp.better === 'same' ? c.text : c.success }]}>
              {cmp.better === 'same' ? '⚖️' : '✅'} {verdictLine(cmp)}
            </Text>
            <View style={styles.cols}>
              <RegimeCol r={cmp.new} title="New regime" best={cmp.better === 'new'} />
              <RegimeCol r={cmp.old} title="Old regime" best={cmp.better === 'old'} />
            </View>
            {cmp.oldBreakEven != null && (
              <Muted>The old regime would only win with about {inr(cmp.oldBreakEven)} more in deductions than you've entered.</Muted>
            )}
            {cmp.better !== 'same' && profile.regime !== cmp.better && (
              <PrimaryButton label={`Set ${cmp.better === 'new' ? 'New' : 'Old'} as my regime`} onPress={() => adoptRegime(cmp.better as 'old' | 'new')} />
            )}
          </Card>

          <Card title="How it's worked out">
            {[cmp.new, cmp.old].map(r => (
              <View key={r.regime} style={{ gap: 2 }}>
                <Text style={[styles.breakTitle, { color: c.text }]}>{r.regime === 'new' ? 'New' : 'Old'} regime</Text>
                {r.deductions.map(d => <ListRow key={d.label} label={d.label} value={`− ${inr(d.amount)}`} />)}
                <ListRow label="Taxable income" value={inr(r.taxable)} />
                <ListRow label="Tax on slabs" value={inr(r.slabTax)} />
                {r.rebate > 0 && <ListRow label="Rebate 87A / marginal relief" value={`− ${inr(r.rebate)}`} valueColor={c.success} />}
                <ListRow label="Health & education cess (4%)" value={inr(r.cess)} />
                <ListRow label="Total tax" value={inr(r.total)} sub={`${r.effectiveRate.toFixed(1)}% of income`} />
              </View>
            ))}
          </Card>
        </>
      )}

      <Faint>
        Estimate using FY {RULES.fy} rules, which change with each Union Budget. Not included: surcharge (income above ₹50L){cmp?.surchargeNote ? ', which applies to you' : ''}, capital gains, and employer NPS 80CCD(2). Confirm with Form 16 or a CA before filing.
      </Faint>
    </View>
  );
}

function RegimeCol({ r, title, best }: { r: RegimeResult; title: string; best: boolean }) {
  const { c } = useBrainStyles();
  return (
    <View style={[styles.col, { borderColor: best ? c.success : c.cardBorder, backgroundColor: c.chipBg }]}>
      <Text style={[styles.colTitle, { color: c.textMuted }]}>{title}{best ? ' ⭐' : ''}</Text>
      <Text style={[styles.colTotal, { color: best ? c.success : c.text }]}>{inr(r.total)}</Text>
      <Text style={[styles.colSub, { color: c.textFaint }]}>taxable {inr(r.taxable)}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  toggle: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 },
  toggleLabel: { flex: 1, fontSize: 14 },
  expand: { paddingVertical: 2 },
  verdict: { fontSize: 15, fontWeight: '800', lineHeight: 21 },
  cols: { flexDirection: 'row', gap: 10 },
  col: { flex: 1, borderWidth: 1.5, borderRadius: 14, padding: 12, gap: 2 },
  colTitle: { fontSize: 12, fontWeight: '800', textTransform: 'uppercase', letterSpacing: 0.4 },
  colTotal: { fontSize: 20, fontWeight: '800' },
  colSub: { fontSize: 11.5 },
  breakTitle: { fontSize: 13.5, fontWeight: '800', marginTop: 4 },
});
