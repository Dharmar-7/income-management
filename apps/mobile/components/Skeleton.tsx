import { useEffect, useMemo, useRef } from 'react';
import { Animated, StyleSheet, View, type ViewStyle, type DimensionValue } from 'react-native';
import { useTheme } from '@/context/ThemeContext';
import type { Theme } from '@/lib/theme';

// A softly pulsing placeholder block. Use it to show the SHAPE of content while
// it loads, instead of a blank screen or a bare spinner. Compose a few together
// (see SkeletonCard) to mimic a real card's layout.

export function Skeleton({
  width = '100%', height = 14, radius = 8, style,
}: { width?: DimensionValue; height?: number; radius?: number; style?: ViewStyle }) {
  const { theme: c } = useTheme();
  const pulse = useRef(new Animated.Value(0.5)).current;

  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { toValue: 1, duration: 650, useNativeDriver: true }),
        Animated.timing(pulse, { toValue: 0.5, duration: 650, useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [pulse]);

  return (
    <Animated.View
      style={[
        { width, height, borderRadius: radius, backgroundColor: c.track, opacity: pulse },
        style,
      ]}
    />
  );
}

/** A card-shaped skeleton: a title line, two body lines and a short footer line.
 *  Render a handful in a list to preview list content while it loads. */
export function SkeletonCard() {
  const { theme: c } = useTheme();
  const styles = useMemo(() => makeStyles(c), [c]);
  return (
    <View style={styles.card}>
      <Skeleton width="45%" height={11} radius={6} />
      <Skeleton width="90%" height={15} radius={6} style={{ marginTop: 10 }} />
      <Skeleton width="70%" height={15} radius={6} style={{ marginTop: 6 }} />
      <Skeleton width="35%" height={11} radius={6} style={{ marginTop: 12 }} />
    </View>
  );
}

/** Convenience: a vertical stack of SkeletonCards with the same padding a list uses. */
export function SkeletonList({ count = 5 }: { count?: number }) {
  const { theme: c } = useTheme();
  const styles = useMemo(() => makeStyles(c), [c]);
  return (
    <View style={styles.list}>
      {Array.from({ length: count }, (_, i) => <SkeletonCard key={i} />)}
    </View>
  );
}

const makeStyles = (c: Theme) => StyleSheet.create({
  list: { padding: 16, gap: 10 },
  card: {
    backgroundColor: c.card,
    borderRadius: 16,
    padding: 16,
    borderWidth: 1,
    borderColor: c.cardBorder,
  },
});
