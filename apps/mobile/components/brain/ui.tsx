import { useMemo, type ReactNode } from 'react';
import { View, Text, TextInput, TouchableOpacity, StyleSheet, type ViewStyle, type StyleProp } from 'react-native';
import { useTheme } from '@/context/ThemeContext';
import type { Theme } from '@/lib/theme';
import { hSelect } from '@/lib/haptics';

// Shared building blocks for the Velora Brain panels, so all four tabs share one
// look (the app's standard card / pill / input conventions).

export function useBrainStyles() {
  const { theme: c } = useTheme();
  return { c, s: useMemo(() => makeStyles(c), [c]) };
}

export function Card({ title, right, children, style }: { title?: string; right?: ReactNode; children: ReactNode; style?: StyleProp<ViewStyle> }) {
  const { s } = useBrainStyles();
  return (
    <View style={[s.card, style]}>
      {(title || right) && (
        <View style={s.cardHead}>
          {title ? <Text style={s.cardTitle}>{title}</Text> : <View />}
          {right}
        </View>
      )}
      {children}
    </View>
  );
}

export function Muted({ children }: { children: ReactNode }) {
  const { s } = useBrainStyles();
  return <Text style={s.muted}>{children}</Text>;
}

export function Faint({ children }: { children: ReactNode }) {
  const { s } = useBrainStyles();
  return <Text style={s.faint}>{children}</Text>;
}

export function Big({ children, color }: { children: ReactNode; color?: string }) {
  const { s } = useBrainStyles();
  return <Text style={[s.big, color ? { color } : null]}>{children}</Text>;
}

export function ListRow({ label, value, sub, valueColor }: { label: string; value: string; sub?: string; valueColor?: string }) {
  const { s } = useBrainStyles();
  return (
    <View style={s.listRow}>
      <View style={{ flex: 1 }}>
        <Text style={s.listLabel} numberOfLines={1}>{label}</Text>
        {sub ? <Text style={s.listSub} numberOfLines={2}>{sub}</Text> : null}
      </View>
      <Text style={[s.listValue, valueColor ? { color: valueColor } : null]}>{value}</Text>
    </View>
  );
}

export function Pill({ label, active, onPress }: { label: string; active: boolean; onPress: () => void }) {
  const { s } = useBrainStyles();
  return (
    <TouchableOpacity onPress={() => { hSelect(); onPress(); }} activeOpacity={0.8} style={[s.pill, active && s.pillOn]}>
      <Text style={[s.pillText, active && s.pillTextOn]}>{label}</Text>
    </TouchableOpacity>
  );
}

export function FieldLabel({ children }: { children: ReactNode }) {
  const { s } = useBrainStyles();
  return <Text style={s.fieldLabel}>{children}</Text>;
}

export function PillRow({ children }: { children: ReactNode }) {
  const { s } = useBrainStyles();
  return <View style={s.pillRow}>{children}</View>;
}

/** A labelled rupee/number input. Keeps the raw text; callers parse with toNum(). */
export function NumberField({ label, value, onChange, placeholder, hint }: { label: string; value: string; onChange: (v: string) => void; placeholder?: string; hint?: string }) {
  const { s, c } = useBrainStyles();
  return (
    <View style={s.field}>
      <Text style={s.fieldLabel}>{label}</Text>
      <TextInput
        style={s.input}
        value={value}
        onChangeText={t => onChange(t.replace(/[^0-9.]/g, ''))}
        keyboardType="decimal-pad"
        placeholder={placeholder ?? '0'}
        placeholderTextColor={c.textFaint}
      />
      {hint ? <Text style={s.faint}>{hint}</Text> : null}
    </View>
  );
}

export const toNum = (v: string) => {
  const n = Number(v);
  return isFinite(n) && n > 0 ? n : 0;
};

export function PrimaryButton({ label, onPress }: { label: string; onPress: () => void }) {
  const { s } = useBrainStyles();
  return (
    <TouchableOpacity style={s.btn} onPress={onPress} activeOpacity={0.85}>
      <Text style={s.btnText}>{label}</Text>
    </TouchableOpacity>
  );
}

export function LinkButton({ label, onPress }: { label: string; onPress: () => void }) {
  const { s } = useBrainStyles();
  return (
    <TouchableOpacity onPress={onPress} activeOpacity={0.7} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
      <Text style={s.link}>{label}</Text>
    </TouchableOpacity>
  );
}

export function Empty({ emoji, text, action, onPress }: { emoji: string; text: string; action?: string; onPress?: () => void }) {
  const { s } = useBrainStyles();
  return (
    <View style={s.empty}>
      <Text style={s.emptyEmoji}>{emoji}</Text>
      <Text style={s.emptyText}>{text}</Text>
      {action && onPress ? <PrimaryButton label={action} onPress={onPress} /> : null}
    </View>
  );
}

const makeStyles = (c: Theme) => StyleSheet.create({
  card: { backgroundColor: c.card, borderRadius: 16, padding: 16, borderWidth: 1, borderColor: c.cardBorder, gap: 10 },
  cardHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  cardTitle: { fontSize: 14.5, fontWeight: '700', color: c.text, flexShrink: 1 },
  muted: { fontSize: 13, color: c.textMuted, lineHeight: 19 },
  faint: { fontSize: 11.5, color: c.textFaint, lineHeight: 16 },
  big: { fontSize: 26, fontWeight: '800', color: c.text },

  listRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 4 },
  listLabel: { fontSize: 13.5, color: c.text, fontWeight: '600' },
  listSub: { fontSize: 12, color: c.textMuted, marginTop: 1, lineHeight: 16 },
  listValue: { fontSize: 13.5, color: c.text, fontWeight: '800' },

  pillRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  pill: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: 99, borderWidth: 1, backgroundColor: c.chipBg, borderColor: c.chipBorder },
  pillOn: { backgroundColor: c.primary, borderColor: c.primary },
  pillText: { fontSize: 13, fontWeight: '700', color: c.textMuted },
  pillTextOn: { color: c.onColor },

  field: { gap: 4 },
  fieldLabel: { fontSize: 12, fontWeight: '800', color: c.textFaint, letterSpacing: 0.4, textTransform: 'uppercase' },
  input: {
    backgroundColor: c.inputBg, borderWidth: 1, borderColor: c.inputBorder, borderRadius: 12,
    paddingHorizontal: 14, paddingVertical: 10, fontSize: 15, color: c.text,
  },

  btn: { backgroundColor: c.primary, borderRadius: 12, paddingVertical: 12, paddingHorizontal: 18, alignItems: 'center' },
  btnText: { color: c.onColor, fontSize: 14, fontWeight: '800' },
  link: { fontSize: 13, fontWeight: '700', color: c.primary },

  empty: { alignItems: 'center', gap: 10, paddingVertical: 28, paddingHorizontal: 12 },
  emptyEmoji: { fontSize: 38 },
  emptyText: { fontSize: 13.5, color: c.textMuted, textAlign: 'center', lineHeight: 19 },
});
