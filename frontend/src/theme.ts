export const T = {
  bg:        '#080b11',
  bgGrad:    'radial-gradient(1200px 600px at 80% -10%, #121826 0%, #0a0e15 45%, #080b11 100%)',
  surface:   '#0f141d',
  surface2:  '#141a25',
  surfaceHi: '#1b2330',
  sidebar:   'linear-gradient(180deg, #0d121b 0%, #0a0e15 100%)',

  border:    'rgba(255,255,255,0.07)',
  borderHi:  'rgba(255,255,255,0.13)',
  borderSoft:'rgba(255,255,255,0.045)',

  text:      '#eaeff6',
  textMid:   '#a8b2c1',
  textDim:   '#6c7787',
  textFaint: '#4b5462',

  accent:    'var(--accent)',
  accentDim: 'var(--accent-dim)',
  accentGlow:'var(--accent-glow)',
  pos:       '#3ddc97',
  posDim:    'rgba(61,220,151,0.12)',
  neg:       '#ff6f7d',
  negDim:    'rgba(255,111,125,0.12)',
  warn:      '#f6c45a',
  warnDim:   'rgba(246,196,90,0.12)',

  sans:      "'Plus Jakarta Sans', system-ui, sans-serif",
  mono:      "'IBM Plex Mono', monospace",

  shadow:    '0 1px 2px rgba(0,0,0,0.5), 0 16px 40px -20px rgba(0,0,0,0.8)',
  shadowSm:  '0 1px 2px rgba(0,0,0,0.4)',
  insetTop:  'inset 0 1px 0 rgba(255,255,255,0.05)',

  radius:    14,
  radiusSm:  9,
} as const;

export const GROUP_COLORS: Record<string, string> = {
  'Housing':       '#5b9dff',
  'Food & Dining': '#3ddc97',
  'Transport':     '#f6c45a',
  'Entertainment': '#c084fc',
  'Health':        '#ff7a85',
  'Savings':       '#38d6e8',
};

export const ACCENTS = {
  mint:   { c: '#3ddc97', dim: 'rgba(61,220,151,0.13)',  glow: 'rgba(61,220,151,0.35)' },
  indigo: { c: '#7c8cff', dim: 'rgba(124,140,255,0.14)', glow: 'rgba(124,140,255,0.38)' },
  cyan:   { c: '#34d6e8', dim: 'rgba(52,214,232,0.13)',  glow: 'rgba(52,214,232,0.35)' },
  amber:  { c: '#f6b04a', dim: 'rgba(246,176,74,0.14)',  glow: 'rgba(246,176,74,0.38)' },
  rose:   { c: '#fb7199', dim: 'rgba(251,113,153,0.14)', glow: 'rgba(251,113,153,0.38)' },
} as const;

export type AccentKey = keyof typeof ACCENTS;

export function applyAccent(key: AccentKey) {
  const a = ACCENTS[key] ?? ACCENTS.mint;
  const r = document.documentElement;
  r.style.setProperty('--accent', a.c);
  r.style.setProperty('--accent-dim', a.dim);
  r.style.setProperty('--accent-glow', a.glow);
}
