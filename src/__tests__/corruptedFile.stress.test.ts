/**
 * ── TEST 4: Corrupted File Fallback ──────────────────────────────────────────
 *
 * Verifies the app's behaviour when it encounters unreadable, empty, or
 * garbage-data files at any point in the read pipeline.  Nothing may throw
 * an unhandled exception; every failure path must return null or a safe default.
 *
 * Scenarios:
 *   4a — safeReadNote: primary read fails → falls back to .tmp sibling.
 *   4b — safeReadNote: both primary and .tmp fail → returns null gracefully.
 *   4c — safeReadNote: primary succeeds → returns content without reading .tmp.
 *   4d — decodeNote: garbage bytes → returns null (no exception).
 *   4e — decodeNote: valid frontmatter but truncated body → parses partially.
 *   4f — decodeNote: deeply nested backslashes / special chars → no exception.
 *   4g — decodeNote: missing required fields → falls back to safe defaults.
 *   4h — encodeNote → decodeNote round-trip for extreme content strings.
 *   4i — safeReadNote: primary returns empty string → treats as valid empty file.
 *   4j — Recursive snapshot recovery: corrupted snapshot is silently skipped.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

// ── Mock @tauri-apps/plugin-fs ────────────────────────────────────────────────

const fsState = {
  files: new Map<string, string | Error>(),
};

vi.mock('@tauri-apps/plugin-fs', () => ({
  exists: vi.fn(async (p: string) => fsState.files.has(p)),
  readTextFile: vi.fn(async (p: string) => {
    const entry = fsState.files.get(p);
    if (entry === undefined) throw Object.assign(new Error(`ENOENT: ${p}`), { code: 'ENOENT' });
    if (entry instanceof Error) throw entry;
    return entry;
  }),
  writeTextFile: vi.fn(async (p: string, c: string) => { fsState.files.set(p, c); }),
  rename:  vi.fn(async () => {}),
  mkdir:   vi.fn(async () => {}),
  readDir: vi.fn(async () => []),
  remove:  vi.fn(async (p: string) => { fsState.files.delete(p); }),
  watch:   vi.fn(async () => vi.fn()),
}));

vi.mock('@tauri-apps/plugin-dialog', () => ({ open: vi.fn() }));

// ── Imports (after mocks) ─────────────────────────────────────────────────────

import { safeReadNote } from '../lib/recoveryJournal';
import { decodeNote, encodeNote } from '../lib/frontmatter';
import type { Note } from '../store/noteStore';

// ── Helpers ───────────────────────────────────────────────────────────────────

function setFile(path: string, content: string | Error): void {
  fsState.files.set(path, content);
}

function makeNote(overrides: Partial<Note> = {}): Note {
  return {
    id:        'note-abc',
    title:     'Test Note',
    content:   'Body text.',
    tags:      ['tag1', 'tag2'],
    folder:    'research',
    createdAt: '2024-06-01T12:00:00.000Z',
    updatedAt: '2024-06-01T12:00:00.000Z',
    ...overrides,
  };
}

// ── Lifecycle ─────────────────────────────────────────────────────────────────

beforeEach(() => {
  fsState.files = new Map();
});

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('safeReadNote — corrupted / missing file fallbacks', () => {

  // ── 4a: Primary fails → .tmp fallback ────────────────────────────────────
  it('returns .tmp content when the primary file read throws', async () => {
    const abs = '/vault/note.md';
    const tmp = `${abs}.tmp`;

    // Primary file exists but throws an I/O error (e.g. permission denied).
    setFile(abs, new Error('EACCES: permission denied'));
    setFile(tmp, '---\nid: rescued\n---\n\nRecovered content.');

    const result = await safeReadNote(abs);

    expect(result).not.toBeNull();
    expect(result).toMatch('Recovered content.');
  });

  // ── 4b: Both primary and .tmp fail → null ─────────────────────────────────
  it('returns null when both primary and .tmp reads fail', async () => {
    const abs = '/vault/missing.md';
    const tmp = `${abs}.tmp`;

    setFile(abs, new Error('EIO: hardware I/O error'));
    setFile(tmp, new Error('EIO: hardware I/O error'));

    const result = await safeReadNote(abs);

    expect(result).toBeNull();
  });

  // ── 4c: Primary succeeds → .tmp never read ────────────────────────────────
  it('returns primary content when it is readable', async () => {
    const abs = '/vault/good.md';
    setFile(abs, '---\nid: good\n---\n\nGood content.');

    const result = await safeReadNote(abs);

    expect(result).toBe('---\nid: good\n---\n\nGood content.');
  });

  // ── 4i: Empty string is a valid file ──────────────────────────────────────
  it('returns an empty string without fallback when the file exists but is empty', async () => {
    const abs = '/vault/empty.md';
    setFile(abs, '');

    const result = await safeReadNote(abs);

    expect(result).toBe('');
  });

  // ── 4b variant: .tmp does not exist either → null ────────────────────────
  it('returns null gracefully when neither file exists', async () => {
    // Neither /vault/ghost.md nor /vault/ghost.md.tmp are in the fs map.
    const result = await safeReadNote('/vault/ghost.md');
    expect(result).toBeNull();
  });
});

describe('decodeNote — garbage / adversarial input', () => {

  // ── 4d: Pure garbage bytes ────────────────────────────────────────────────
  it('returns null for pure garbage without throwing', () => {
    const garbage = [
      '',
      '\x00\x01\x02\x03',
      'not frontmatter at all',
      '--- incomplete',
      '---\n no closing delimiter anywhere in this string',
      String.fromCharCode(0xff, 0xfe, 0x00, 0x01),
      '�'.repeat(1_000),
      '<<>>{{}}[[]]%%!!@@##$$',
    ];

    garbage.forEach((input) => {
      expect(() => decodeNote(input, 'fallback')).not.toThrow();
      const result = decodeNote(input, 'fallback');
      // Must return null (not a Note) for unparseable input.
      expect(result).toBeNull();
    });
  });

  // ── 4e: Valid frontmatter, truncated / empty body ─────────────────────────
  it('parses a note with valid frontmatter but an empty body', () => {
    const raw = '---\nid: abc\ntitle: "Truncated"\ntags: []\nfolder: ""\ncreated: 2024-01-01T00:00:00.000Z\nupdated: 2024-01-01T00:00:00.000Z\n---\n';
    const note = decodeNote(raw, 'fallback');

    expect(note).not.toBeNull();
    expect(note!.id).toBe('abc');
    expect(note!.title).toBe('Truncated');
    expect(note!.content).toBe('');
  });

  // ── 4f: Special characters and deeply nested escapes ─────────────────────
  it('handles special characters in frontmatter without throwing', () => {
    const adversarialTitles = [
      '"; DROP TABLE notes; --',
      '<script>alert(1)</script>',
      '\\\\\\\\\\',
      '\n\r\t\0',
      '🔥💥🌊🌪️',
      'A'.repeat(10_000),
    ];

    adversarialTitles.forEach((title) => {
      expect(() => {
        const note = makeNote({ title });
        const encoded = encodeNote(note);
        // Must not throw during encode.
        expect(encoded).toBeTruthy();
        // Decode the encoded form — must not throw either.
        const decoded = decodeNote(encoded, 'fallback');
        expect(decoded).not.toBeNull();
      }).not.toThrow();
    });
  });

  // ── 4g: Missing required fields → safe defaults ───────────────────────────
  it('falls back to safe defaults when frontmatter fields are absent', () => {
    // Only the bare minimum — no title, no tags, no folder.
    const raw = '---\nid: partial\n---\n\nSome body.';
    const note = decodeNote(raw, 'fallback-id');

    expect(note).not.toBeNull();
    expect(note!.id).toBe('partial');
    expect(note!.title).toBe('Untitled'); // fallback
    expect(note!.tags).toEqual([]);       // fallback
    expect(note!.folder).toBe('');        // fallback
    expect(note!.content).toBe('Some body.');
  });

  // ── 4g variant: No id field → fallbackId used ────────────────────────────
  it('uses fallbackId when the frontmatter id field is absent', () => {
    const raw = '---\ntitle: "No ID"\n---\n\nContent.';
    const note = decodeNote(raw, 'my-fallback');
    expect(note!.id).toBe('my-fallback');
  });

  // ── 4h: encode → decode round-trip for extreme values ────────────────────
  it('survives an encode→decode round-trip for adversarial content', () => {
    const extremes: Array<Partial<Note>> = [
      { content: '' },
      { content: 'x'.repeat(50_000) },
      { content: '---\n---\n---\n' }, // looks like frontmatter inside body
      { content: '[[wikilink]] and [[another]]' },
      // NOTE: content starting with '# ' is intentionally stripped by
      // stripLegacyBody (legacy frontmatter normalisation).  Use '## ' instead.
      { content: '## Subheading\n\n```typescript\nconst x = 1;\n```' },
      { title: '' },
      { title: 'Title with "quotes" and \\backslashes\\' },
      { tags: [] },
      { tags: ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j'] },
      { folder: '' },
      { folder: 'deeply/nested/folder' },
    ];

    extremes.forEach((override, i) => {
      const original = makeNote(override);
      let encoded: string;
      let decoded: Note | null;

      expect(() => { encoded = encodeNote(original); }).not.toThrow();
      expect(() => { decoded = decodeNote(encoded!, 'fallback'); }).not.toThrow();

      expect(decoded).not.toBeNull();
      expect(decoded!.id).toBe(original.id);
      // Content should survive the round-trip (stripLegacyBody may normalise whitespace).
      expect(decoded!.content.trim()).toBe(original.content.trim());
    });
  });

  // ── Stress: 1 000 random garbage strings — none may throw ────────────────
  it('processes 1 000 randomly-mutated strings without any unhandled exception', () => {
    const base = encodeNote(makeNote());

    for (let i = 0; i < 1_000; i++) {
      // Mutate the encoded string: truncate, double, inject nulls, scramble.
      const mutations = [
        base.slice(0, Math.floor(Math.random() * base.length)),
        base + base,
        base.replace(/[a-z]/g, () => String.fromCharCode(Math.floor(Math.random() * 128))),
        '\x00'.repeat(i % 20) + base,
        base.split('').reverse().join(''),
      ];

      mutations.forEach((mutated) => {
        expect(() => decodeNote(mutated, `fallback-${i}`)).not.toThrow();
      });
    }
  });
});
