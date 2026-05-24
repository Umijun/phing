import type { Note, NoteCursor } from '../store/noteStore';

const esc = (s: string) => s.replace(/\\/g, '\\\\').replace(/"/g, '\\"');

const fmGet = (fm: string, key: string): string => {
  const m = fm.match(new RegExp(`^${key}:\\s*(.+)$`, 'm'));
  return m?.[1]?.trim().replace(/^"|"$/g, '') ?? '';
};

const fmList = (fm: string, key: string): string[] => {
  const m = fm.match(new RegExp(`^${key}:\\s*\\[(.*)\\]`, 'm'));
  const inner = m?.[1] ?? '';
  if (!inner.trim()) return [];
  return inner.split(',').map((s) => s.trim().replace(/^"|"$/g, '')).filter(Boolean);
};

const parseCursor = (fm: string): NoteCursor | undefined => {
  const anchor = fmGet(fm, 'cursor_anchor');
  const head = fmGet(fm, 'cursor_head');
  if (!anchor) return undefined;
  const a = Number(anchor);
  const h = head ? Number(head) : a;
  if (Number.isNaN(a) || Number.isNaN(h)) return undefined;
  return { anchor: a, head: h };
};

/** Strip legacy H1 / italic description from body markdown (pre-unification notes). */
export function stripLegacyBody(md: string): string {
  const lines = md.split('\n');
  let i = 0;
  if (lines[i]?.startsWith('# ')) i++;
  while (i < lines.length && lines[i]?.trim() === '') i++;
  if (lines[i]?.match(/^\*[^*].+[^*]\*$/)) i++;
  while (i < lines.length && lines[i]?.trim() === '') i++;
  return lines.slice(i).join('\n');
}

export function encodeNote(note: Note): string {
  const lines = [
    '---',
    `id: ${note.id}`,
    `title: "${esc(note.title)}"`,
    `tags: [${note.tags.map((t) => `"${esc(t)}"`).join(', ')}]`,
    `folder: "${esc(note.folder)}"`,
    `emoji: "${esc(note.emoji ?? '')}"`,
    `description: "${esc(note.description ?? '')}"`,
    `created: ${note.createdAt}`,
    `updated: ${note.updatedAt}`,
  ];

  if (note.cursor) {
    lines.push(`cursor_anchor: ${note.cursor.anchor}`);
    lines.push(`cursor_head: ${note.cursor.head}`);
  }

  lines.push('---', '', note.content);
  return lines.join('\n');
}

export function decodeNote(raw: string, fallbackId: string): Note | null {
  try {
    if (!raw.startsWith('---')) return null;
    const end = raw.indexOf('\n---', 3);
    if (end === -1) return null;
    const fm = raw.slice(4, end);
    let content = raw.slice(end + 5).trimStart();
    content = stripLegacyBody(content);

    const id = fmGet(fm, 'id') || fallbackId;
    const emoji = fmGet(fm, 'emoji');
    const description = fmGet(fm, 'description');

    return {
      id,
      title: fmGet(fm, 'title') || 'Untitled',
      content,
      tags: fmList(fm, 'tags'),
      folder: fmGet(fm, 'folder'),
      emoji: emoji || undefined,
      description: description || undefined,
      cursor: parseCursor(fm),
      createdAt: fmGet(fm, 'created') || new Date().toISOString(),
      updatedAt: fmGet(fm, 'updated') || new Date().toISOString(),
    };
  } catch {
    return null;
  }
}
