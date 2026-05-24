import type { Pocket } from '../store/noteStore';

const POCKETS_KEY = 'phing_pockets';

export const POCKET_COLORS = ['#E0A96D', '#B39DDB', '#8BB0C8', '#DDE6DD', '#DFE7EE', '#F1DFDB'];

export const DEFAULT_POCKETS: Pocket[] = [
  { id: 'journal', name: 'Journal', color: '#E0A96D', emoji: '📔' },
  { id: 'research', name: 'Research', color: '#B39DDB', emoji: '🔬' },
  { id: 'projects', name: 'Projects', color: '#8BB0C8', emoji: '🗂️' },
];

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
