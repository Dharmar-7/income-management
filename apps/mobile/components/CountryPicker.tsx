import { useMemo, useState, useEffect } from 'react';
import {
  View, Text, TextInput, FlatList, TouchableOpacity, Modal, Pressable, StyleSheet,
} from 'react-native';
import { useTheme } from '@/context/ThemeContext';
import { useToast } from '@/context/ToastContext';
import type { Theme } from '@/lib/theme';
import { COUNTRIES, MAX_COUNTRIES, type Country } from '@/lib/countries';
import { hSelect } from '@/lib/haptics';

// A searchable multi-select for the Jobs location filter. Lets you pick Remote,
// "All major markets", or up to MAX_COUNTRIES specific countries from the full
// catalogue. Emits one `where` string ('remote' | 'all' | 'jp,kr,…') on Apply.

type Mode = 'remote' | 'all' | 'countries';

function parseWhere(where: string): { mode: Mode; selected: string[] } {
  if (where === 'remote') return { mode: 'remote', selected: [] };
  if (where === 'all') return { mode: 'all', selected: [] };
  return { mode: 'countries', selected: where.split(',').filter(Boolean) };
}

export default function CountryPicker({
  visible, where, onApply, onClose,
}: { visible: boolean; where: string; onApply: (where: string) => void; onClose: () => void }) {
  const { theme: c } = useTheme();
  const styles = useMemo(() => makeStyles(c), [c]);
  const toast = useToast();

  const [mode, setMode] = useState<Mode>('remote');
  const [selected, setSelected] = useState<string[]>([]);
  const [query, setQuery] = useState('');

  // Re-seed local state each time the sheet opens, from the current `where`.
  useEffect(() => {
    if (visible) {
      const parsed = parseWhere(where);
      setMode(parsed.mode);
      setSelected(parsed.selected);
      setQuery('');
    }
  }, [visible, where]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return COUNTRIES;
    return COUNTRIES.filter(c => c.name.toLowerCase().includes(q) || c.code === q);
  }, [query]);

  function toggleCountry(code: string) {
    hSelect();
    setMode('countries');
    setSelected(prev => {
      if (prev.includes(code)) return prev.filter(x => x !== code);
      if (prev.length >= MAX_COUNTRIES) {
        toast.show(`Up to ${MAX_COUNTRIES} countries at a time`);
        return prev;
      }
      return [...prev, code];
    });
  }

  function apply() {
    const next = mode === 'remote' ? 'remote'
      : mode === 'all' ? 'all'
      : (selected.length ? selected.join(',') : 'remote');
    onApply(next);
    onClose();
  }

  const countrySelected = mode === 'countries' && selected.length > 0;

  function renderCountry({ item }: { item: Country }) {
    const on = countrySelected && selected.includes(item.code);
    return (
      <TouchableOpacity style={styles.row} activeOpacity={0.7} onPress={() => toggleCountry(item.code)}>
        <Text style={styles.flag}>{item.flag}</Text>
        <Text style={styles.rowName} numberOfLines={1}>{item.name}</Text>
        <View style={[styles.check, on && styles.checkOn]}>
          {on && <Text style={styles.checkMark}>✓</Text>}
        </View>
      </TouchableOpacity>
    );
  }

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={styles.overlay} onPress={onClose}>
        <Pressable style={styles.sheet} onPress={() => {}}>
          <View style={styles.handle} />
          <View style={styles.header}>
            <Text style={styles.title}>Location</Text>
            <Text style={styles.count}>
              {mode === 'countries' && selected.length > 0 ? `${selected.length}/${MAX_COUNTRIES} selected` : ''}
            </Text>
          </View>

          {/* Remote / All quick modes */}
          <View style={styles.modesRow}>
            <TouchableOpacity
              style={[styles.modeChip, mode === 'remote' && styles.modeChipOn]}
              onPress={() => { hSelect(); setMode('remote'); setSelected([]); }}
              activeOpacity={0.8}
            >
              <Text style={[styles.modeText, mode === 'remote' && styles.modeTextOn]}>🌍 Remote</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.modeChip, mode === 'all' && styles.modeChipOn]}
              onPress={() => { hSelect(); setMode('all'); setSelected([]); }}
              activeOpacity={0.8}
            >
              <Text style={[styles.modeText, mode === 'all' && styles.modeTextOn]}>🌐 All major markets</Text>
            </TouchableOpacity>
          </View>

          <View style={styles.searchRow}>
            <Text style={styles.searchIcon}>🔍</Text>
            <TextInput
              style={styles.searchInput}
              placeholder="Search countries…"
              placeholderTextColor={c.textFaint}
              value={query}
              onChangeText={setQuery}
              autoCapitalize="none"
              autoCorrect={false}
            />
            {query.length > 0 && (
              <TouchableOpacity onPress={() => setQuery('')} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                <Text style={styles.searchClear}>✕</Text>
              </TouchableOpacity>
            )}
          </View>

          <FlatList
            data={filtered}
            keyExtractor={c => c.code}
            renderItem={renderCountry}
            style={styles.list}
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
            ListEmptyComponent={<Text style={styles.empty}>No country matches “{query}”.</Text>}
          />

          <TouchableOpacity style={styles.applyBtn} onPress={apply} activeOpacity={0.85}>
            <Text style={styles.applyText}>
              {mode === 'countries' && selected.length > 0 ? `Show ${selected.length} ${selected.length === 1 ? 'country' : 'countries'}` : 'Apply'}
            </Text>
          </TouchableOpacity>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const makeStyles = (c: Theme) => StyleSheet.create({
  overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.45)', justifyContent: 'flex-end' },
  sheet: {
    backgroundColor: c.bg, borderTopLeftRadius: 22, borderTopRightRadius: 22,
    paddingHorizontal: 18, paddingTop: 10, paddingBottom: 18, height: '82%',
    borderTopWidth: 1, borderColor: c.cardBorder,
  },
  handle: { alignSelf: 'center', width: 40, height: 4, borderRadius: 2, backgroundColor: c.inputBorder, marginBottom: 12 },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 },
  title: { fontSize: 18, fontWeight: '800', color: c.text },
  count: { fontSize: 12, fontWeight: '700', color: c.primary },

  modesRow: { flexDirection: 'row', gap: 8, marginBottom: 10 },
  modeChip: { flex: 1, alignItems: 'center', paddingVertical: 10, borderRadius: 12, borderWidth: 1, backgroundColor: c.chipBg, borderColor: c.chipBorder },
  modeChipOn: { backgroundColor: c.primary, borderColor: c.primary },
  modeText: { fontSize: 12.5, fontWeight: '700', color: c.textMuted },
  modeTextOn: { color: c.onColor },

  searchRow: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    paddingHorizontal: 12, borderRadius: 12, borderWidth: 1,
    borderColor: c.inputBorder, backgroundColor: c.inputBg, marginBottom: 6,
  },
  searchIcon: { fontSize: 14 },
  searchInput: { flex: 1, paddingVertical: 10, fontSize: 14, color: c.text },
  searchClear: { fontSize: 13, fontWeight: '700', color: c.textFaint, paddingHorizontal: 2 },

  list: { flex: 1 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: c.cardBorder },
  flag: { fontSize: 20 },
  rowName: { flex: 1, fontSize: 14, color: c.text, fontWeight: '600' },
  check: { width: 22, height: 22, borderRadius: 11, borderWidth: 2, borderColor: c.inputBorder, alignItems: 'center', justifyContent: 'center' },
  checkOn: { backgroundColor: c.primary, borderColor: c.primary },
  checkMark: { color: c.onColor, fontSize: 12, fontWeight: '900' },
  empty: { fontSize: 13, color: c.textMuted, textAlign: 'center', paddingVertical: 24 },

  applyBtn: { backgroundColor: c.primary, borderRadius: 14, paddingVertical: 14, alignItems: 'center', marginTop: 12 },
  applyText: { color: c.onColor, fontSize: 15, fontWeight: '800' },
});
