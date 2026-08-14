// Colour tags for banks. The chosen colour is stored directly on Bank.color as
// a hex string (e.g. "#6366f1"). Banks created before the colour picker stored
// named keys (indigo/teal/…) — bankColor() still resolves those for backward
// compatibility, so old rows keep rendering correctly.

// The picker palette. Includes the six legacy key colours (so an old bank's
// colour shows as selected) plus a wider spread to choose from.
export const BANK_PALETTE: string[] = [
  '#6366f1', '#7c3aed', '#8b5cf6', '#ec4899', '#f43f5e', '#ef4444',
  '#f97316', '#f59e0b', '#eab308', '#84cc16', '#22c55e', '#10b981',
  '#14b8a6', '#06b6d4', '#0ea5e9', '#3b82f6', '#64748b', '#334155',
];

// Legacy named keys → hex, for banks created before hex storage.
const LEGACY: Record<string, string> = {
  indigo: '#6366f1', green: '#22c55e', orange: '#f97316',
  teal: '#14b8a6', violet: '#7c3aed', danger: '#ef4444',
};

function hexToRgba(hex: string, alpha: number): string {
  const h = hex.replace('#', '');
  const full = h.length === 3 ? h.split('').map(x => x + x).join('') : h;
  const n = parseInt(full, 16);
  if (!Number.isFinite(n)) return `rgba(99,102,241,${alpha})`;
  const r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
  return `rgba(${r},${g},${b},${alpha})`;
}

// Resolve a stored bank colour (hex or legacy key) to a solid `base` and a
// translucent `soft` tint for backgrounds.
export function bankColor(value?: string | null): { base: string; soft: string } {
  const raw = (value ?? '').trim();
  const base = raw.startsWith('#') ? raw : (LEGACY[raw] ?? '#6366f1');
  return { base, soft: hexToRgba(base, 0.18) };
}
