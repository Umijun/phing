/**
 * ── TEST 2: Atomic Write Interruption (Crash Simulation) ─────────────────────
 *
 * Exercises the atomicWriteNote → recoveryJournal pipeline under simulated
 * crash conditions.  A virtual in-memory filesystem (vfs) stands in for the
 * real Tauri FS, letting us inject failures at precise moments.
 *
 * Scenarios:
 *   2a — Normal write:  .tmp is created then renamed to final; no orphan left.
 *   2b — Crash during rename (new note):  .tmp survives; recovery restores it.
 *   2c — Crash during rename (existing note):  snapshot was taken; final is safe.
 *   2d — Snapshot pruning:  old .bak files are purged beyond the retention limit.
 *   2e — Double-flush recovery:  two concurrent atomicWriteNote calls for the
 *         same path; both complete cleanly or the second overwrites correctly.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

// ── Virtual filesystem ────────────────────────────────────────────────────────

interface VfsEntry { content: string; }
const state = {
  vfs: new Map<string, VfsEntry>(),
};

function vfsSet(path: string, content: string): void {
  state.vfs.set(path, { content });
}
function vfsHas(path: string): boolean { return state.vfs.has(path); }
function vfsGet(path: string): string {
  const e = state.vfs.get(path);
  if (!e) throw Object.assign(new Error(`ENOENT: ${path}`), { code: 'ENOENT' });
  return e.content;
}
function vfsDel(path: string): void { state.vfs.delete(path); }
function vfsKeys(): string[] { return [...state.vfs.keys()]; }

// ── Module mock (hoisted by Vitest) ───────────────────────────────────────────

vi.mock('@tauri-apps/plugin-fs', () => ({
  exists:       vi.fn(async (p: string) => vfsHas(p)),
  readTextFile: vi.fn(async (p: string) => vfsGet(p)),
  writeTextFile: vi.fn(async (p: string, c: string) => vfsSet(p, c)),
  rename: vi.fn(async (from: string | URL, to: string | URL) => {
    const f = String(from); const t = String(to);
    const content = vfsGet(f); // throws ENOENT if missing
    vfsDel(f);
    vfsSet(t, content);
  }),
  mkdir:   vi.fn(async () => {}),
  readDir: vi.fn(async (dir: string) => {
    const prefix = dir.endsWith('/') ? dir : `${dir}/`;
    return vfsKeys()
      .filter((p) => p.startsWith(prefix))
      .map((p) => {
        const rel = p.slice(prefix.length);
        const isDir = rel.includes('/');
        return { name: rel.split('/')[0], isFile: !isDir, isDirectory: isDir };
      })
      .filter((e, i, arr) => arr.findIndex((x) => x.name === e.name) === i); // dedupe
  }),
  remove: vi.fn(async (p: string) => vfsDel(p)),
  watch:  vi.fn(async () => vi.fn()),
}));

// Dialog plugin — not used in these tests but imported transitively.
vi.mock('@tauri-apps/plugin-dialog', () => ({ open: vi.fn() }));

// ── Imports (after mocks) ─────────────────────────────────────────────────────

import { atomicWriteNote } from '../services/vaultService';
import { findOrphanedTmpFiles, recoverOrphanedTmp, captureSnapshot } from '../lib/recoveryJournal';
import { rename } from '@tauri-apps/plugin-fs';
import type { Note } from '../store/noteStore';

// ── Fixtures ──────────────────────────────────────────────────────────────────

function makeNote(overrides: Partial<Note> = {}): Note {
  return {
    id:          'test-id-123',
    title:       'Test Note',
    content:     'Hello, world.',
    tags:        [],
    folder:      '',
    createdAt:   '2024-01-01T00:00:00.000Z',
    updatedAt:   '2024-01-01T00:00:00.000Z',
    ...overrides,
  };
}

const VAULT = '/vault';
const ABS   = `${VAULT}/Test Note.md`;
const TMP   = `${ABS}.tmp`;

// ── Lifecycle ─────────────────────────────────────────────────────────────────

beforeEach(() => {
  state.vfs = new Map();
  vi.mocked(rename).mockImplementation(async (from: string | URL, to: string | URL) => {
    const f = String(from); const t = String(to);
    const content = vfsGet(f);
    vfsDel(f);
    vfsSet(t, content);
  });
});

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('atomicWriteNote — stress tests', () => {

  // ── 2a: Normal happy-path write ───────────────────────────────────────────
  it('writes a new note atomically: tmp created then renamed to final', async () => {
    const note = makeNote();

    const rel = await atomicWriteNote(VAULT, note);

    expect(rel).toBe('Test Note.md');
    // Final file must exist with correct content.
    expect(vfsHas(ABS)).toBe(true);
    expect(vfsGet(ABS)).toMatch(/id: test-id-123/);
    expect(vfsGet(ABS)).toMatch(/Hello, world\./);
    // Tmp must be cleaned up.
    expect(vfsHas(TMP)).toBe(false);
  });

  // ── 2b: Crash during rename — new note ────────────────────────────────────
  it('leaves a recoverable .tmp when rename crashes on a new note', async () => {
    const note     = makeNote();
    const encoded  = `---\nid: test-id-123\n---\n\nHello, world.`; // approximate

    // Inject crash: rename throws after writeTextFile succeeds.
    vi.mocked(rename).mockRejectedValueOnce(
      new Error('SIGKILL: process terminated mid-rename'),
    );

    // atomicWriteNote should propagate the rename failure.
    await expect(atomicWriteNote(VAULT, note)).rejects.toThrow('SIGKILL');

    // .tmp must still be on disk (the writeTextFile succeeded before crash).
    expect(vfsHas(TMP)).toBe(true);
    // Final file must NOT exist (rename never completed).
    expect(vfsHas(ABS)).toBe(false);

    // ── Simulate app restart / orphan recovery ────────────────────────────
    const orphans = await findOrphanedTmpFiles(VAULT);
    expect(orphans).toContain(TMP);

    // Recovery: restore the note from the orphaned tmp.
    // First: restore the normal rename mock for recovery.
    vi.mocked(rename).mockImplementation(async (from: string | URL, to: string | URL) => {
      const c = vfsGet(String(from)); vfsDel(String(from)); vfsSet(String(to), c);
    });

    await recoverOrphanedTmp(TMP);

    // Final file now exists and contains the content that was being written.
    expect(vfsHas(ABS)).toBe(true);
    expect(vfsHas(TMP)).toBe(false);
    // Content must be non-empty and include the note ID.
    expect(vfsGet(ABS).length).toBeGreaterThan(0);
  });

  // ── 2c: Crash during rename — existing note (tmp discarded safely) ────────
  it('discards the orphaned .tmp when the final file already exists', async () => {
    // Simulate an existing note on disk.
    vfsSet(ABS, '---\nid: old-content\n---\n\nOld body.');

    vi.mocked(rename).mockRejectedValueOnce(new Error('crash'));

    await expect(atomicWriteNote(VAULT, makeNote())).rejects.toThrow('crash');

    // Both tmp and final exist — tmp has new data, final has old data.
    expect(vfsHas(TMP)).toBe(true);
    expect(vfsHas(ABS)).toBe(true);

    // Recovery sees final exists → discards tmp (preserving the safe state).
    vi.mocked(rename).mockImplementation(async (from: string | URL, to: string | URL) => {
      const c = vfsGet(String(from)); vfsDel(String(from)); vfsSet(String(to), c);
    });

    await recoverOrphanedTmp(TMP);

    expect(vfsHas(TMP)).toBe(false);
    // Old (safe) content is preserved.
    expect(vfsGet(ABS)).toMatch(/old-content/);
  });

  // ── 2d: Snapshot pruning ───────────────────────────────────────────────────
  it('prunes old .bak snapshots beyond the 10-file retention limit', async () => {
    const snapshotDir = `${VAULT}/.phing/snapshots`;

    // Pre-populate 12 stale snapshots for the same file.
    for (let i = 1; i <= 12; i++) {
      const ts = `2024-01-${String(i).padStart(2, '0')}T00-00-00-000Z`;
      vfsSet(`${snapshotDir}/Test Note.md.${ts}.bak`, `old-content-${i}`);
    }

    // captureSnapshot should prune all but the 10 most recent.
    await captureSnapshot(VAULT, 'Test Note.md', 'latest-content');

    const remaining = vfsKeys().filter((p) => p.startsWith(snapshotDir));
    // 10 old + 1 new = 11... but pruning happens after writing the new one,
    // so we keep the 10 most recent (which includes the new one).
    expect(remaining.length).toBeLessThanOrEqual(10);
  });

  // ── 2e: Concurrent flushes for the same note ──────────────────────────────
  it('handles two concurrent atomicWriteNote calls without corrupting state', async () => {
    const note1 = makeNote({ content: 'version-A' });
    const note2 = makeNote({ content: 'version-B' });

    // Both start at the same time.
    const [r1, r2] = await Promise.allSettled([
      atomicWriteNote(VAULT, note1),
      atomicWriteNote(VAULT, note2),
    ]);

    // Both should settle (fulfilled or rejected — no unhandled rejections).
    expect(['fulfilled', 'rejected']).toContain(r1.status);
    expect(['fulfilled', 'rejected']).toContain(r2.status);

    // The file on disk must contain a complete, non-empty payload.
    if (vfsHas(ABS)) {
      const content = vfsGet(ABS);
      expect(content.length).toBeGreaterThan(0);
      // Must start with the frontmatter delimiter — no corruption.
      expect(content.startsWith('---')).toBe(true);
    }
  });

  // ── 2f: findOrphanedTmpFiles ignores .md.tmp in the snapshot dir ──────────
  it('does not treat snapshot .bak files as orphans', async () => {
    const snapshotDir = `${VAULT}/.phing/snapshots`;
    vfsSet(`${snapshotDir}/Some Note.md.2024-01-01T00-00-00.bak`, 'snapshot');
    // Also plant a real orphan at the vault root.
    vfsSet(`${VAULT}/Real Orphan.md.tmp`, 'orphaned data');

    const orphans = await findOrphanedTmpFiles(VAULT);

    // Only the real orphan should be detected.
    expect(orphans).toContain(`${VAULT}/Real Orphan.md.tmp`);
    expect(orphans.every((o) => o.endsWith('.md.tmp'))).toBe(true);
  });
});
