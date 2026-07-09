import { useEffect, useMemo, useRef, useState } from 'react';
import { Animated, Easing, View, Text, StyleSheet } from 'react-native';
import { useQuery } from '@tanstack/react-query';
import { useAuth } from '@clerk/clerk-expo';
import { apiFetch } from '@/lib/api';
import { useTheme } from '@/context/ThemeContext';
import type { Theme } from '@/lib/theme';

interface Occasion {
  id: string; title: string; isSelf: boolean; personName: string | null;
  icon: string; daysUntil: number; isToday: boolean;
}

// A continuously scrolling "running text" of upcoming occasions for the dashboard.
export default function EventsTicker() {
  const { theme: c } = useTheme();
  const styles = useMemo(() => makeStyles(c), [c]);
  const { getToken } = useAuth();

  const { data } = useQuery({
    queryKey: ['events'],
    queryFn: async () => {
      const token = await getToken();
      return apiFetch<Occasion[]>('/events', token!);
    },
    staleTime: 5 * 60 * 1000,
  });

  const text = useMemo(() => {
    const items = (data ?? []).filter(e => e.daysUntil <= 30);
    if (items.length === 0) return '';
    return items
      .map(e =>
        e.isToday
          ? `${e.icon} Today is ${e.title}${e.isSelf ? '' : e.personName ? ` (${e.personName})` : ''}!`
          : `${e.icon} ${e.daysUntil}d to ${e.title}`,
      )
      .join('        •        ');
  }, [data]);

  const tx = useRef(new Animated.Value(0)).current;
  const [w, setW] = useState(0);

  useEffect(() => {
    if (w === 0 || !text) return;
    tx.setValue(0);
    const anim = Animated.loop(
      Animated.timing(tx, {
        toValue: -w,
        duration: Math.max(6000, w * 22), // constant speed regardless of length
        easing: Easing.linear,
        useNativeDriver: true,
      }),
    );
    anim.start();
    return () => anim.stop();
  }, [w, text]);

  if (!text) return null;

  return (
    <View style={styles.bar}>
      <View style={styles.clip}>
        <Animated.View style={{ flexDirection: 'row', transform: [{ translateX: tx }] }}>
          {/* Two copies side-by-side → seamless loop (we translate by one copy's width).
              numberOfLines + flexShrink:0 force a single line at full intrinsic width —
              otherwise long content wraps inside the clip and breaks the alignment. */}
          <Text style={styles.text} numberOfLines={1} onLayout={e => setW(e.nativeEvent.layout.width)}>{text}        •        </Text>
          <Text style={styles.text} numberOfLines={1}>{text}        •        </Text>
        </Animated.View>
      </View>
    </View>
  );
}

const makeStyles = (c: Theme) => StyleSheet.create({
  bar: {
    backgroundColor: c.chipBg,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: c.chipBorder,
    paddingVertical: 8,
    overflow: 'hidden',
  },
  clip: { overflow: 'hidden', flexDirection: 'row' },
  text: { fontSize: 13, fontWeight: '600', color: c.text, flexShrink: 0 },
});
