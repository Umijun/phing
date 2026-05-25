import type { Pocket } from '../store/noteStore';

const POCKETS_KEY = 'phing_pockets';

/**
 * Round-robin palette for new Pockets.  Values are CSS custom property
 * references so they automatically adapt to the Midnight Snow dark theme —
 * the browser resolves them against the live :root / .dark variable set.
 */
export const POCKET_COLORS = [
  'var(--pocket-color-1)',
  'var(--pocket-color-2)',
  'var(--pocket-color-3)',
  'var(--pocket-color-4)',
  'var(--pocket-color-5)',
  'var(--pocket-color-6)',
  'var(--pocket-color-7)',
  'var(--pocket-color-8)',
];

export const DEFAULT_POCKETS: Pocket[] = [
  { id: 'journal',  name: 'Journal',  color: 'var(--pocket-color-1)', emoji: '📔' },
  { id: 'research', name: 'Research', color: 'var(--pocket-color-2)', emoji: '🔬' },
  { id: 'projects', name: 'Projects', color: 'var(--pocket-color-3)', emoji: '🗂️' },
];

/**
 * Produces a CSS color expression for use in box-shadow.
 *
 * • For pocket-color variables (`var(--pocket-color-N)`) it emits
 *   `rgba(var(--pocket-color-N-rgb), alpha)` so the glow adapts to
 *   dark mode without any JavaScript involvement.
 *
 * • For legacy hex colors stored in old vaults it falls back to
 *   `color-mix(in srgb, <hex> <pct>%, transparent)`, which keeps the
 *   correct hue without needing to concatenate hex-alpha digits.
 */
export function pocketGlow(color: string, alpha: number): string {
  if (color.startsWith('var(--pocket-color-')) {
    // 'var(--pocket-color-1)' → 'var(--pocket-color-1-rgb)'
    const rgbVar = color.slice(0, -1) + '-rgb)';
    return `rgba(${rgbVar}, ${alpha})`;
  }
  // Hex / named colour fallback — color-mix handles opacity cleanly
  return `color-mix(in srgb, ${color} ${Math.round(alpha * 100)}%, transparent)`;
}

export function loadPockets(): Pocket[] {
  try {
    const raw = localStorage.getItem(POCKETS_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Pocket[];
      if (Array.isArray(parsed) && parsed.length) return parsed;
    }
  } catch {
    /* ignore */
  }
  return [...DEFAULT_POCKETS];
}

export function persistPockets(pockets: Pocket[]) {
  localStorage.setItem(POCKETS_KEY, JSON.stringify(pockets));
}

export function slugifyFolder(name: string): string {
  const slug = name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
  return slug || crypto.randomUUID();
}
