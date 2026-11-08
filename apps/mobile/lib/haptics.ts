// Tiny haptics helper. Wraps expo-haptics so a single import gives every screen
// the same short, tasteful vibrations for taps, confirmations and warnings.
//
// Loaded through require() inside a try/catch so the app still runs if the native
// module is unavailable (e.g. web, or an old build before expo-haptics shipped) —
// every call simply becomes a no-op instead of throwing. All calls are
// fire-and-forget: we never await, and swallow rejections on unsupported devices.

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let Haptics: any = null;
try {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  Haptics = require('expo-haptics');
} catch {
  Haptics = null;
}

const run = (fn: () => Promise<unknown> | undefined) => {
  try {
    fn()?.catch?.(() => {});
  } catch {
    /* no-op on unsupported platforms */
  }
};

/** A light tick — for selecting a chip, toggling a filter, switching a tab. */
export const hSelect = () => run(() => Haptics?.selectionAsync());

/** A soft bump — for a primary tap like ticking a habit or saving a bookmark. */
export const hLight = () =>
  run(() => Haptics?.impactAsync?.(Haptics?.ImpactFeedbackStyle?.Light));

/** A firmer bump — for a heavier action like completing a set or deleting. */
export const hMedium = () =>
  run(() => Haptics?.impactAsync?.(Haptics?.ImpactFeedbackStyle?.Medium));

/** Success buzz — the action landed (marked paid, all habits done). */
export const hSuccess = () =>
  run(() => Haptics?.notificationAsync?.(Haptics?.NotificationFeedbackType?.Success));

/** Warning buzz — a soft "heads up" (budget crossed, over-budget). */
export const hWarn = () =>
  run(() => Haptics?.notificationAsync?.(Haptics?.NotificationFeedbackType?.Warning));

/** Error buzz — something failed. */
export const hError = () =>
  run(() => Haptics?.notificationAsync?.(Haptics?.NotificationFeedbackType?.Error));
