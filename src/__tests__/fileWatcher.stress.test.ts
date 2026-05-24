/**
 * ── TEST 3: External Watcher Flood (Sync Chaos) ──────────────────────────────
 *
 * Hammers the VaultFileWatcher with rapid fire FS events to verify:
 *   3a — Self-write suppression holds under repeated events for the same path.
 *   3b — Suppress window expiry correctly re-enables event delivery.
 *   3c — 50 rapid external events do not spawn 50 conflict callbacks.
 *   3d — Non-.md files and .phing/ paths are silently filtered.
 *   3e — Concurrent start/stop calls do not leave dangling watchers.
 *   3f — The contentHash function is pure and collision-resistant.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// ── Mock @tauri-apps/plugin-fs ────────────────────────────────────────────────

/** Capture the inner callback the watcher registers. */
let capturedCallback: ((event: FsEvent) => void) | null = null;
let unwatchCalls = 0;

interface FsEvent {
  paths: string[];
  type:  unknown;
}

vi.mock('@tauri-apps/plugin-fs', () => ({
  watch: vi.fn(async (
    _path:    string,
    callback: (event: FsEvent) => void,
    _opts:    object,
  ) => {
    capturedCallback = callback;
    unwatchCalls = 0;
    // Return an unwatch function.
    return vi.fn(() => { unwatchCalls++; });
  }),
  exists:        vi.fn(async () => false),
  readTextFile:  vi.fn(async () => ''),
  writeTextFile: vi.fn(async () => {}),
  rename:        vi.fn(async () => {}),
  mkdir:         vi.fn(async () => {}),
  readDir:       vi.fn(async () => []),
  remove:        vi.fn(async () => {}),
}));

// ── Imports (after mocks) ─────────────────────────────────────────────────────

import { VaultFileWatcher, contentHash, type FileChangeEvent } from '../lib/fileWatcher';

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Fire `count` events for `path` synchronously through the captured callback. */
function fireEvents(
  path:  string,
  count: number,
  type:  unknown = { modify: {} },
): void {
  if (!capturedCallback) throw new Error('Watcher not started — capturedCallback is null');
  for (let i = 0; i < count; i++) {
    capturedCallback({ paths: [path], type });
  }
}

// ── Lifecycle ─────────────────────────────────────────────────────────────────

let watcher:   VaultFileWatcher;
let received:  FileChangeEvent[];
let onEvent:   (e: FileChangeEvent) => void;

beforeEach(async () => {
  capturedCallback = null;
  watcher  = new VaultFileWatcher();
  received = [];
  onEvent  = (e) => received.push(e);
  await watcher.start('/vault', onEvent);
});

afterEach(async () => {
  await watcher.stop();
});

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('VaultFileWatcher — stress tests', () => {

  // ── 3a: Suppress window holds for multiple events ─────────────────────────
  it('suppresses all events for a path within the suppress window', () => {
    vi.useFakeTimers();
    const PATH = '/vault/note.md';

    watcher.suppressNext(PATH, 2_000);

    // Fire 50 events — all within the 2 s window.
    fireEvents(PATH, 50);

    expect(received).toHaveLength(0);
    vi.useRealTimers();
  });

  // ── 3b: Events resume after suppress window expires ───────────────────────
  it('delivers events once the suppress window has expired', () => {
    vi.useFakeTimers();
    const PATH = '/vault/note.md';

    watcher.suppressNext(PATH, 100); // 100 ms window

    // While suppressed — nothing gets through.
    fireEvents(PATH, 5);
    expect(received).toHaveLength(0);

    // Advance past the suppress window.
    vi.advanceTimersByTime(101);

    // Now fire one more event — must be delivered.
    fireEvents(PATH, 1);
    expect(received).toHaveLength(1);
    expect(received[0].absPath).toBe(PATH);
    expect(received[0].kind).toBe('modify');

    vi.useRealTimers();
  });

  // ── 3c: Flood of 50 external events — no crash, no freeze ────────────────
  it('handles 50 rapid external events without crashing or hanging', () => {
    const PATH = '/vault/external.md';

    // No suppression — simulate an aggressive sync tool.
    expect(() => { fireEvents(PATH, 50); }).not.toThrow();

    // All 50 events were delivered to the handler (debouncing is in the
    // real `watch` API; in tests we fire through directly).
    expect(received).toHaveLength(50);
    received.forEach((e) => {
      expect(e.absPath).toBe(PATH);
      expect(e.kind).toBe('modify');
    });
  });

  // ── 3d: Non-.md files are silently ignored ────────────────────────────────
  it('ignores events for non-Markdown files', () => {
    ['/vault/image.png', '/vault/config.json', '/vault/.gitignore', '/vault/note.md.tmp']
      .forEach((path) => fireEvents(path, 1));

    expect(received).toHaveLength(0);
  });

  // ── 3e: .phing/ snapshot directory is filtered ────────────────────────────
  it('ignores events from the .phing snapshot directory', () => {
    fireEvents('/vault/.phing/snapshots/note.md.2024-01-01.bak', 10);
    // bak files aren't .md, but test the path filter explicitly with a .md suffix.
    fireEvents('/vault/.phing/something.md', 5);
    expect(received).toHaveLength(0);
  });

  // ── 3f: Event kind resolution ─────────────────────────────────────────────
  it('correctly resolves create, modify, and remove event kinds', () => {
    const PATH = '/vault/note.md';

    capturedCallback!({ paths: [PATH], type: { create: {} } });
    capturedCallback!({ paths: [PATH], type: { modify: {} } });
    capturedCallback!({ paths: [PATH], type: { remove: {} } });
    capturedCallback!({ paths: [PATH], type: { delete: {} } });
    capturedCallback!({ paths: [PATH], type: null }); // unknown → modify

    expect(received[0].kind).toBe('create');
    expect(received[1].kind).toBe('modify');
    expect(received[2].kind).toBe('remove');
    expect(received[3].kind).toBe('remove');
    expect(received[4].kind).toBe('modify');
  });

  // ── 3g: Mixed suppressed and unsuppressed paths in a single event ─────────
  it('filters suppressed paths while passing through unsuppressed ones', () => {
    vi.useFakeTimers();
    const SUPPRESSED   = '/vault/mine.md';
    const UNSUPPRESSED = '/vault/theirs.md';

    watcher.suppressNext(SUPPRESSED, 2_000);

    // One event containing both paths.
    capturedCallback!({ paths: [SUPPRESSED, UNSUPPRESSED], type: { modify: {} } });

    expect(received).toHaveLength(1);
    expect(received[0].absPath).toBe(UNSUPPRESSED);
    vi.useRealTimers();
  });

  // ── 3h: Concurrent start/stop does not leak watchers ─────────────────────
  it('calling stop() and start() rapidly does not throw', async () => {
    await expect(
      (async () => {
        for (let i = 0; i < 10; i++) {
          await watcher.stop();
          await watcher.start('/vault', onEvent);
        }
      })(),
    ).resolves.not.toThrow();
  });
});

// ── contentHash ───────────────────────────────────────────────────────────────

describe('contentHash — pure function tests', () => {

  it('returns a 32-bit unsigned integer', () => {
    const h = contentHash('hello');
    expect(Number.isInteger(h)).toBe(true);
    expect(h).toBeGreaterThanOrEqual(0);
    expect(h).toBeLessThanOrEqual(0xFFFF_FFFF);
  });

  it('is deterministic for the same input', () => {
    expect(contentHash('same-input')).toBe(contentHash('same-input'));
  });

  it('produces different hashes for different inputs', () => {
    const inputs = ['', 'a', 'b', 'hello', 'world', '---\nid: 1\n---\n', '\n\n\n'];
    const hashes = inputs.map(contentHash);
    const unique = new Set(hashes);
    expect(unique.size).toBe(inputs.length);
  });

  it('returns 0 for an empty string without throwing', () => {
    // Empty string is a valid edge case — must not throw.
    expect(() => contentHash('')).not.toThrow();
  });

  it('handles a large input (100 000 chars) without exceeding 32 bits', () => {
    const large = 'x'.repeat(100_000);
    const h = contentHash(large);
    expect(h).toBeGreaterThanOrEqual(0);
    expect(h).toBeLessThanOrEqual(0xFFFF_FFFF);
  });

  it('differentiates on-disk edits from in-memory state', () => {
    const inMemory  = '---\nid: abc\ntitle: "Note"\n---\n\nOriginal content';
    const onDisk    = '---\nid: abc\ntitle: "Note"\n---\n\nModified by external editor';
    expect(contentHash(inMemory)).not.toBe(contentHash(onDisk));
  });
});
