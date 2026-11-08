import { useRef, type ReactNode } from 'react';
import { Animated, Pressable, type ViewStyle, type StyleProp } from 'react-native';
import { hSelect } from '@/lib/haptics';

// A tap target that gently scales down while pressed, so touches feel responsive
// instead of flat. A drop-in around any content; fires a light selection haptic
// on press-in by default. Uses the built-in Animated API — no extra deps.

export default function PressableScale({
  children, onPress, style, disabled, haptic = true, scaleTo = 0.96,
}: {
  children: ReactNode;
  onPress?: () => void;
  style?: StyleProp<ViewStyle>;
  disabled?: boolean;
  haptic?: boolean;
  scaleTo?: number;
}) {
  const scale = useRef(new Animated.Value(1)).current;

  const to = (v: number) =>
    Animated.spring(scale, { toValue: v, useNativeDriver: true, friction: 7, tension: 120 }).start();

  return (
    <Pressable
      onPressIn={() => { to(scaleTo); if (haptic) hSelect(); }}
      onPressOut={() => to(1)}
      onPress={onPress}
      disabled={disabled}
    >
      <Animated.View style={[style, { transform: [{ scale }] }]}>{children}</Animated.View>
    </Pressable>
  );
}
