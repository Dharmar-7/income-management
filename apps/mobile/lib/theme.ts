// Velora mobile theme tokens. One palette per scheme; components read the active
// palette via useTheme() (see context/ThemeContext). Semantic surface/text tokens
// flip between light & dark; brand + status colours stay constant across schemes.

export interface Theme {
  scheme: 'light' | 'dark';

  // surfaces
  bg: string;          // screen background
  card: string;        // cards, sheets, inputs base
  elevated: string;    // raised surface (popovers, active rows)
  cardBorder: string;  // hairline borders on cards
  inputBg: string;
  inputBorder: string;
  border: string;      // general-purpose border (alias of inputBorder)
  chipBg: string;
  chipBorder: string;
  track: string;       // progress tracks / skeletons
  overlay: string;     // modal backdrop scrim
  headerBg: string;
  contrast: string;    // a high-contrast block (e.g. month badge)
  contrastText: string;

  // text
  text: string;        // primary
  textMuted: string;   // secondary
  textFaint: string;   // tertiary / placeholders
  onColor: string;     // text/icon on top of a brand-coloured fill

  // brand + status (constant across schemes)
  primary: string;
  primaryDeep: string;
  violet: string;
  success: string;
  successDeep: string;
  danger: string;
  warning: string;
  orange: string;
  teal: string;
}

const brand = {
  onColor: '#ffffff',
  primary: '#6366f1',
  primaryDeep: '#4f46e5',
  violet: '#7c3aed',
  success: '#22c55e',
  successDeep: '#16a34a',
  danger: '#ef4444',
  warning: '#eab308',
  orange: '#f97316',
  teal: '#14b8a6',
};

export const lightTheme: Theme = {
  scheme: 'light',
  bg: '#f9fafb',
  card: '#ffffff',
  elevated: '#ffffff',
  cardBorder: '#f3f4f6',
  inputBg: '#ffffff',
  inputBorder: '#e5e7eb',
  border: '#e5e7eb',
  chipBg: '#f9fafb',
  chipBorder: '#e5e7eb',
  track: '#f3f4f6',
  overlay: 'rgba(0,0,0,0.4)',
  headerBg: '#ffffff',
  contrast: '#111827',
  contrastText: '#ffffff',
  text: '#111827',
  textMuted: '#6b7280',
  textFaint: '#9ca3af',
  ...brand,
};

export const darkTheme: Theme = {
  scheme: 'dark',
  bg: '#0a0a14',
  card: '#171922',
  elevated: '#1f222e',
  cardBorder: 'rgba(255,255,255,0.08)',
  inputBg: '#1b1d28',
  inputBorder: 'rgba(255,255,255,0.14)',
  border: 'rgba(255,255,255,0.14)',
  chipBg: 'rgba(255,255,255,0.05)',
  chipBorder: 'rgba(255,255,255,0.12)',
  track: 'rgba(255,255,255,0.10)',
  overlay: 'rgba(0,0,0,0.6)',
  headerBg: '#0a0a14',
  contrast: '#1f222e',
  contrastText: '#f1f5f9',
  text: '#f1f5f9',
  textMuted: '#a3b0c2',   // was #94a3b8 — lifted for readable secondary text on dark cards
  textFaint: '#8996a8',   // was #64748b — old value failed contrast for small tertiary text
  ...brand,
};

export const themeFor = (scheme: 'light' | 'dark'): Theme =>
  scheme === 'dark' ? darkTheme : lightTheme;
