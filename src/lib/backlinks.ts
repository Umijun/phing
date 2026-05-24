import type { Note } from '../store/noteStore';

export function findBacklinks(notes: Note[], current: Note): Note[] {
  const title = current.title.trim();
  if (!title) return [];
  const needle = `[[${title}]]`;
  return notes.filter(
    (n) => n.id !== current.id && n.content.includes(needle),
  );
}
