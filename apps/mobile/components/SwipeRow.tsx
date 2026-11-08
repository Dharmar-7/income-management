import { useMemo, useRef, type ReactNode } from 'react';
import {
  Animated, PanResponder, StyleSheet, Text, View, type ViewStyle, type StyleProp,
} from 'react-native';
import { useTheme } from '@/context/ThemeContext';
import type { Theme } from '@/lib/theme';
import { hMedium } from '@/lib/haptics';

// Swipe a row left to delete it — the familiar mobile gesture. Built on the
// stock PanResponder + Animated (no gesture-handler/reanimated dependency).
//
// The responder only engages on a clearly HORIZONTAL leftward drag, so it never
// fights the list's vertical scroll. Past the threshold the row slides off and
// onDelete fires; short of it, the row springs back. Pair it with an Undo toast
// so an accidental swipe is always recoverable.

const THRESHOLD = 96; // px of leftward travel that commits the delete

export default function SwipeRow({
  children, onDelete, actionLabel = 'Delete', style,
}: {
  children: ReactNode;
  onDelete: () => void;
  actionLabel?: string;
  style?: StyleProp<ViewStyle>;
}) {
  const { theme: c } = useTheme();
  const styles = useMemo(() => makeStyles(c), [c]);
  const translateX = useRef(new Animated.Value(0)).current;
  const committed = useRef(false);

  const responder = useMemo(
    () =>
      PanResponder.create({
        // Let taps through; only claim the gesture once it's a real horizontal drag.
        onMoveShouldSetPanResponder: (_e, g) =>
          g.dx < -8 && Math.abs(g.dx) > Math.abs(g.dy) * 1.5,
        onPanResponderMove: (_e, g) => {
          const dx = Math.min(0, g.dx); // left-only
          translateX.setValue(Math.max(dx, -140));
          if (!committed.current && dx <= -THRESHOLD) { committed.current = true; hMedium(); }
          if (committed.current && dx > -THRESHOLD) committed.current = false;
        },
        onPanResponderRelease: (_e, g) => {
          if (g.dx <= -THRESHOLD) {
            Animated.timing(translateX, { toValue: -500, duration: 160, useNativeDriver: true })
              .start(() => onDelete());
          } else {
            committed.current = false;
            Animated.spring(translateX, { toValue: 0, useNativeDriver: true, friction: 7 }).start();
          }
        },
        onPanResponderTerminate: () => {
          committed.current = false;
          Animated.spring(translateX, { toValue: 0, useNativeDriver: true, friction: 7 }).start();
        },
      }),
    [onDelete, translateX],
  );

  return (
    <View style={styles.wrap}>
      {/* Revealed behind the row as it slides left. */}
      <View style={styles.action} pointerEvents="none">
        <Text style={styles.actionText}>🗑  {actionLabel}</Text>
      </View>
      <Animated.View style={[style, { transform: [{ translateX }] }]} {...responder.panHandlers}>
        {children}
      </Animated.View>
    </View>
  );
}

const makeStyles = (c: Theme) => StyleSheet.create({
  wrap: { position: 'relative', justifyContent: 'center' },
  action: {
    position: 'absolute',
    right: 0, top: 0, bottom: 0, left: 0,
    backgroundColor: c.danger,
    borderRadius: 16,
    alignItems: 'flex-end',
    justifyContent: 'center',
    paddingRight: 22,
  },
  actionText: { color: '#fff', fontSize: 13, fontWeight: '800' },
});
