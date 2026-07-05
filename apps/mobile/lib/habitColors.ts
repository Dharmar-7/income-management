// Accent colors a habit can be tagged with. `base` is the solid dot / fill;
// `soft` tints the filled check-in cells. Keys are stored on the Habit row.
export type HabitColorKey = 'indigo' | 'green' | 'orange' | 'teal' | 'violet' | 'danger';

export const HABIT_COLORS: Record<HabitColorKey, { base: string; soft: string }> = {
  indigo: { base: '#6366f1', soft: 'rgba(99,102,241,0.18)' },
  green:  { base: '#22c55e', soft: 'rgba(34,197,94,0.18)' },
  orange: { base: '#f97316', soft: 'rgba(249,115,22,0.18)' },
  teal:   { base: '#14b8a6', soft: 'rgba(20,184,166,0.18)' },
  violet: { base: '#7c3aed', soft: 'rgba(124,58,237,0.18)' },
  danger: { base: '#ef4444', soft: 'rgba(239,68,68,0.18)' },
};

export function habitColor(key: string): { base: string; soft: string } {
  return HABIT_COLORS[(key as HabitColorKey)] ?? HABIT_COLORS.indigo;
}
