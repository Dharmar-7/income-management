import { useState } from 'react';
import {
  View, Text, TouchableOpacity, Modal, Pressable,
  StyleSheet,
} from 'react-native';
import { BlurView } from 'expo-blur';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { BottomTabBarProps } from '@react-navigation/bottom-tabs';
import VeloraGem from '@/components/VeloraGem';
import { useTheme } from '@/context/ThemeContext';

const MAIN = ['index', 'transactions', 'budgets', 'savings'] as const;
type MainRoute = (typeof MAIN)[number];

const ICONS: Record<MainRoute, string> = {
  index: '🏠',
  transactions: '💳',
  budgets: '🎯',
  savings: '💰',
};

const LABELS: Record<MainRoute, string> = {
  index: 'Home',
  transactions: 'Txns',
  budgets: 'Budgets',
  savings: 'Savings',
};

const MORE_ITEMS = [
  { label: 'Habits',      icon: '🔥', route: 'habits'      },
  { label: 'Notes',       icon: '📝', route: 'notes'       },
  { label: 'Reports',     icon: '📊', route: 'reports'     },
  { label: 'Import',      icon: '📥', route: 'import'      },
  { label: 'Settings',    icon: '⚙️', route: 'settings'    },
  { label: 'Recurring',   icon: '🔄', route: 'recurring'   },
  { label: 'Loans',       icon: '🏦', route: 'loans'       },
  { label: 'Settlements', icon: '🤝', route: 'settlements' },
  { label: 'Calendar',    icon: '📅', route: 'calendar'    },
  { label: 'Documents',   icon: '🗂️', route: 'documents'   },
];

export default function GlowStripTabBar({ state, navigation }: BottomTabBarProps) {
  const [open, setOpen] = useState(false);
  const { scheme } = useTheme();
  const dark = scheme === 'dark';
  const insets = useSafeAreaInsets();

  const active = state.routes[state.index]?.name;

  function jumpTo(name: string) {
    const target = state.routes.find(r => r.name === name);
    if (!target) return;
    const ev = navigation.emit({ type: 'tabPress', target: target.key, canPreventDefault: true });
    if (!ev.defaultPrevented) {
      navigation.dispatch({ type: 'JUMP_TO', payload: { name } });
    }
  }

  const gemActive = !MAIN.includes(active as MainRoute);
  const bottom = Math.max(insets.bottom, 0) + 14;

  return (
    <>
      {/* ── more popup ── */}
      <Modal visible={open} transparent animationType="fade" onRequestClose={() => setOpen(false)}>
        <Pressable style={s.overlay} onPress={() => setOpen(false)}>
          <View style={[s.popup, { bottom: bottom + 80 }, dark ? s.popupDark : s.popupLight]}>
            <View style={s.pgrid}>
              {MORE_ITEMS.map((item, idx) => (
                <TouchableOpacity
                  key={item.label}
                  style={[
                    s.pitem,
                    dark ? s.pitemDark : s.pitemLight,
                    // Last item alone in a row → stretch full width
                    MORE_ITEMS.length % 3 === 1 && idx === MORE_ITEMS.length - 1 && s.pitemFull,
                  ]}
                  onPress={() => {
                    setOpen(false);
                    if (item.route) jumpTo(item.route);
                  }}
                >
                  <Text style={s.picon}>{item.icon}</Text>
                  <Text style={[s.plabel, { color: dark ? 'rgba(255,255,255,0.85)' : '#374151' }]}>
                    {item.label}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
          </View>
        </Pressable>
      </Modal>

      {/* ── floating strip ── */}
      <View style={[s.wrap, { bottom }]} pointerEvents="box-none">
        <BlurView
          intensity={dark ? 85 : 90}
          tint={dark ? 'dark' : 'light'}
          style={[s.strip, { borderColor: dark ? 'rgba(255,255,255,0.12)' : 'rgba(0,0,0,0.14)' }]}
        >
          <TabItem icon={ICONS.index}        label={LABELS.index}        active={active === 'index'}        dark={dark} onPress={() => jumpTo('index')} />
          <TabItem icon={ICONS.transactions} label={LABELS.transactions} active={active === 'transactions'} dark={dark} onPress={() => jumpTo('transactions')} />

          {/* Crystal gem — centre tab */}
          <TouchableOpacity style={s.ti} onPress={() => setOpen(o => !o)} activeOpacity={0.7}>
            <View style={s.ic}>
              {(gemActive || open) && <View style={s.arc} pointerEvents="none" />}
              <View style={(gemActive || open) ? s.iconGrow : undefined}>
                <VeloraGem size={20} />
              </View>
            </View>
            <View style={[s.dot, (gemActive || open) && s.dotActive]} />
            <Text style={[s.tabLabel, { color: (gemActive || open) ? '#6366f1' : dark ? 'rgba(255,255,255,0.75)' : '#52525b' }]}>
              More
            </Text>
          </TouchableOpacity>

          <TabItem icon={ICONS.budgets}  label={LABELS.budgets}  active={active === 'budgets'}  dark={dark} onPress={() => jumpTo('budgets')} />
          <TabItem icon={ICONS.savings}  label={LABELS.savings}  active={active === 'savings'}  dark={dark} onPress={() => jumpTo('savings')} />
        </BlurView>
      </View>
    </>
  );
}

function TabItem({
  icon, label, active, dark, onPress,
}: { icon: string; label: string; active: boolean; dark: boolean; onPress: () => void }) {
  return (
    <TouchableOpacity style={s.ti} onPress={onPress} activeOpacity={0.7}>
      <View style={s.ic}>
        {active && <View style={s.arc} pointerEvents="none" />}
        <Text style={[s.emoji, active && s.iconGrow]}>{icon}</Text>
      </View>
      <View style={[s.dot, active && s.dotActive]} />
      <Text style={[s.tabLabel, { color: active ? '#6366f1' : dark ? 'rgba(255,255,255,0.75)' : '#52525b' }]}>
        {label}
      </Text>
    </TouchableOpacity>
  );
}

const s = StyleSheet.create({
  wrap: {
    position: 'absolute',
    left: 16, right: 16,
  },
  strip: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-around',
    borderRadius: 50,
    borderWidth: 1,
    paddingVertical: 10,
    paddingHorizontal: 12,
    overflow: 'hidden',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.4,
    shadowRadius: 12,
    elevation: 12,
  },
  ti: {
    alignItems: 'center',
    gap: 3,
    minWidth: 54,
  },
  ic: {
    // Fixed icon box keeps the touch target/layout identical across states.
    // NO overflow:hidden / borderRadius here — the active marker is the arc that
    // floats just ABOVE this box, and overflow:hidden would clip it away.
    width: 50, height: 32,
    alignItems: 'center',
    justifyContent: 'center',
  },
  // Active marker: a thin indigo arc curving over the icon. A View with only its
  // top border + big top-corner radii renders as a curved line — the "curve"
  // look. Conditionally MOUNTED so toggling it never shifts layout.
  //
  // CRUCIAL: no shadow / no elevation. On Android, elevation on an otherwise
  // transparent view is painted as a rectangular grey smudge behind it — THAT
  // was the "rectangle" that kept appearing. A flat colored curve has no such
  // artifact, so the indicator stays a clean arc on every tab.
  arc: {
    position: 'absolute',
    top: -3,
    alignSelf: 'center',
    width: 26,
    height: 9,
    borderTopWidth: 3,
    borderTopLeftRadius: 13,
    borderTopRightRadius: 13,
    borderTopColor: '#6366f1',
  },
  iconGrow: { transform: [{ scale: 1.12 }] },
  emoji: { fontSize: 18 },
  dot: {
    width: 4, height: 4,
    borderRadius: 2,
    backgroundColor: 'transparent',
  },
  dotActive: {
    backgroundColor: '#6366f1',
    shadowColor: '#6366f1',
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.75,
    shadowRadius: 3,
    elevation: 4,
  },
  tabLabel: {
    fontSize: 9,
    fontWeight: '600',
    letterSpacing: 0.2,
  },

  /* popup */
  overlay: {
    flex: 1,
    justifyContent: 'flex-end',
    paddingHorizontal: 16,
  },
  popup: {
    position: 'absolute',
    left: 16, right: 16,
    borderRadius: 18,
    padding: 10,
    borderWidth: 1,
  },
  popupDark: {
    backgroundColor: 'rgba(7,7,20,0.97)',
    borderColor: 'rgba(255,255,255,0.09)',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.55,
    shadowRadius: 16,
    elevation: 16,
  },
  popupLight: {
    backgroundColor: 'rgba(255,255,255,0.97)',
    borderColor: 'rgba(0,0,0,0.08)',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.1,
    shadowRadius: 16,
    elevation: 16,
  },
  pgrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
  },
  pitem: {
    width: '31%',
    alignItems: 'center',
    gap: 4,
    paddingVertical: 12,
    borderRadius: 12,
    borderWidth: 1,
  },
  pitemDark:  { backgroundColor: 'rgba(255,255,255,0.04)', borderColor: 'rgba(255,255,255,0.07)' },
  pitemLight: { backgroundColor: 'rgba(99,102,241,0.06)',  borderColor: 'rgba(99,102,241,0.12)'  },
  pitemFull:  { width: '100%' },
  picon:  { fontSize: 22 },
  plabel: { fontSize: 11, fontWeight: '700' },
});
