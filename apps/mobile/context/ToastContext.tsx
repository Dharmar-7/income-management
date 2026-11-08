import {
  createContext, useCallback, useContext, useEffect, useMemo, useRef, useState,
  type ReactNode,
} from 'react';
import { Animated, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '@/context/ThemeContext';
import type { Theme } from '@/lib/theme';
import { hLight } from '@/lib/haptics';

// A single app-wide snackbar. Call useToast().show('Saved ✓') from anywhere, or
// pass an action to offer an Undo — the standard "delete, but let me take it
// back" pattern. Only one toast shows at a time; a new one replaces the old.

type ToastType = 'success' | 'error' | 'info';

interface ToastOptions {
  type?: ToastType;
  /** Label for a trailing action button, e.g. "Undo". */
  actionLabel?: string;
  /** Run when the action is tapped (also dismisses the toast). */
  onAction?: () => void;
  /** Auto-dismiss delay in ms. Defaults to 2500 (4000 when an action is present). */
  duration?: number;
}

interface ToastState extends ToastOptions {
  id: number;
  message: string;
}

interface ToastContextValue {
  show: (message: string, opts?: ToastOptions) => void;
  hide: () => void;
}

const ToastContext = createContext<ToastContextValue>({ show: () => {}, hide: () => {} });

export function ToastProvider({ children }: { children: ReactNode }) {
  const { theme: c } = useTheme();
  const insets = useSafeAreaInsets();
  const styles = useMemo(() => makeStyles(c), [c]);
  const [toast, setToast] = useState<ToastState | null>(null);
  const anim = useRef(new Animated.Value(0)).current;
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const seq = useRef(0);

  const clearTimer = () => {
    if (timer.current) { clearTimeout(timer.current); timer.current = null; }
  };

  const hide = useCallback(() => {
    clearTimer();
    Animated.timing(anim, { toValue: 0, duration: 180, useNativeDriver: true })
      .start(() => setToast(null));
  }, [anim]);

  const show = useCallback((message: string, opts: ToastOptions = {}) => {
    clearTimer();
    const id = ++seq.current;
    setToast({ id, message, ...opts });
    hLight();
    anim.setValue(0);
    Animated.spring(anim, { toValue: 1, useNativeDriver: true, friction: 8, tension: 80 }).start();
    const duration = opts.duration ?? (opts.actionLabel ? 4000 : 2500);
    timer.current = setTimeout(() => {
      // Only dismiss if this is still the toast on screen.
      setToast(prev => {
        if (prev?.id !== id) return prev;
        Animated.timing(anim, { toValue: 0, duration: 180, useNativeDriver: true })
          .start(() => setToast(p => (p?.id === id ? null : p)));
        return prev;
      });
    }, duration);
  }, [anim]);

  useEffect(() => () => clearTimer(), []);

  const value = useMemo(() => ({ show, hide }), [show, hide]);

  const dot = toast?.type === 'error' ? c.danger : toast?.type === 'info' ? c.primary : c.success;

  return (
    <ToastContext.Provider value={value}>
      {children}
      {toast && (
        <Animated.View
          pointerEvents="box-none"
          style={[
            styles.wrap,
            // Sits just above the floating tab bar.
            { bottom: Math.max(insets.bottom, 0) + 92 },
            {
              opacity: anim,
              transform: [{ translateY: anim.interpolate({ inputRange: [0, 1], outputRange: [20, 0] }) }],
            },
          ]}
        >
          <View style={styles.toast}>
            <View style={[styles.dot, { backgroundColor: dot }]} />
            <Text style={styles.text} numberOfLines={2}>{toast.message}</Text>
            {toast.actionLabel && (
              <TouchableOpacity
                onPress={() => { const fn = toast.onAction; hide(); fn?.(); }}
                hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
                style={styles.actionBtn}
                activeOpacity={0.7}
              >
                <Text style={styles.actionText}>{toast.actionLabel}</Text>
              </TouchableOpacity>
            )}
          </View>
        </Animated.View>
      )}
    </ToastContext.Provider>
  );
}

export function useToast() {
  return useContext(ToastContext);
}

const makeStyles = (c: Theme) => StyleSheet.create({
  wrap: {
    position: 'absolute',
    left: 16, right: 16,
    alignItems: 'center',
  },
  toast: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    maxWidth: 480,
    width: '100%',
    backgroundColor: c.scheme === 'dark' ? c.elevated : '#1f2937',
    borderRadius: 14,
    paddingVertical: 12,
    paddingHorizontal: 14,
    borderWidth: 1,
    borderColor: c.scheme === 'dark' ? c.cardBorder : 'rgba(255,255,255,0.08)',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.3,
    shadowRadius: 12,
    elevation: 10,
  },
  dot: { width: 8, height: 8, borderRadius: 4 },
  text: { flex: 1, color: '#f9fafb', fontSize: 13.5, fontWeight: '600', lineHeight: 18 },
  actionBtn: { paddingHorizontal: 8, paddingVertical: 2 },
  actionText: { color: '#a5b4fc', fontSize: 13.5, fontWeight: '800', letterSpacing: 0.3 },
});
