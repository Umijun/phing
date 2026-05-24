/**
 * recoveryJournal.ts
 *
 * Crash-safety layer for Phing's note storage.
 *
 * Three responsibilities:
 *
 * 1. Snapshot capture — before every overwrite, the previous disk content is
 *    archived to `<vault>/.phing/snapshots/` as a timestamped `.bak` file.
 *    Old snapshots beyond the retention limit are pruned automatically.
 *
 * 2. Orphan recovery — on startup the vault is scanned for `.md.tmp` files
 *    left behind by a crash mid-atomic-write.  Each orphan is either renamed
 *    to its intended final path (if the final file is missing) or deleted
 *    (if the rename already completed before the crash).
 *
 * 3. Safe read — reads a note file with a `.tmp` sibling fallback so a
 *    partially-recovered vault can still be opened.
 *
 * All public functions are non-throwing — failures are silently ignored so
 * they never block the main write path.
 */

import {
  exists,
  mkdir,
  readDir,
  readTextFile,
  remove,
  rename,
  writeTextFile,
} from '@tauri-apps/plugin-fs';

const SNAPSHOT_DIR = '.phing/snapshots';
const MAX_SNAPSHOTS_PER_FILE = 10;

function joinPath(...parts: string[]): string {
  return parts.filter(Boolean).join('/').replace(/\/+/g, '/');
}

// ── Snapshot capture ──────────────────────────────────────────────────────────

/**
 * Archives `content` (the current disk content of `relPath`) to the snapshot
 * store before it is overwritten.  Safe to call even when the file does not
 * yet exist on disk — the snapshot simply will not be written.
 */
export async function captureSnapshot(
  vaultPath: string,
  relPath: string,
  content: string,
): Promise<void> {
  try {
    const snapshotDir = joinPath(vaultPath, SNAPSHOT_DIR);
    if (!(await exists(snapshotDir))) {
      await mkdir(snapshotDir, { recursive: true });
    }

    // Flatten the relative path to a safe single-level filename.
    const safeName = relPath.replace(/\//g, '__');
    const ts = new Date().toISOString().replace(/[:.]/g, '-');
    const snapshotPath = joinPath(snapshotDir, `${safeName}.${ts}.bak`);

    await writeTextFile(snapshotPath, content);
    await pruneSnapshots(snapshotDir, `${safeName}.`);
  } catch {
    // Non-fatal — snapshot failure must never block a save.
  }
}

async function pruneSnapshots(snapshotDir: string, prefix: string): Promise<void> {
  try {
    const entries = await readDir(snapshotDir);
    // ISO timestamps are lexicographically ordered — sort descending = newest first.
    const matching = entries
      .filter((e) => e.isFile && e.name.startsWith(prefix))
      .map((e) => e.name)
      .sort()
      .reverse();

    for (const old of matching.slice(MAX_SNAPSHOTS_PER_FILE)) {
      await remove(joinPath(snapshotDir, old)).catch(() => { /* ignore */ });
    }
  } catch {
    // Non-fatal.
  }
}

// ── Orphan recovery ───────────────────────────────────────────────────────────

/**
 * Walks the vault recursively and returns absolute paths of any `.md.tmp`
 * files left behind by a previous crash mid-atomic-write.
 */
export async function findOrphanedTmpFiles(vaultPath: string): Promise<string[]> {
  const orphans: string[] = [];
  await collectTmpFiles(vaultPath, orphans);
  return orphans;
}

async function collectTmpFiles(dir: string, out: string[]): Promise<void> {
  let entries;
  try {
    entries = await readDir(dir);
  } catch {
    return;
  }

  for (const entry of entries) {
    const abs = joinPath(dir, entry.name);
    if (entry.isDirectory) {
      await collectTmpFiles(abs, out);
    } else if (entry.isFile && entry.name.endsWith('.md.tmp')) {
      out.push(abs);
    }
  }
}

/**
 * Recovers a single orphaned `.md.tmp` file.
 *
 * - If the intended final `.md` path does not exist, the `.tmp` is renamed
 *   to finalise the interrupted atomic write.
 * - If the final path already exists (the rename completed before the crash),
 *   the stale `.tmp` is simply removed.
 */
export async function recoverOrphanedTmp(tmpPath: string): Promise<void> {
  const finalPath = tmpPath.replace(/\.tmp$/, '');
  try {
    if (!(await exists(finalPath))) {
      await rename(tmpPath, finalPath);
    } else {
      await remove(tmpPath).catch(() => { /* ignore */ });
    }
  } catch {
    await remove(tmpPath).catch(() => { /* ignore */ });
  }
}

// ── Safe read ─────────────────────────────────────────────────────────────────

/**
 * Reads `absPath` with a graceful fallback to its `.tmp` sibling.
 * Returns `null` if both reads fail.
 */
export async function safeReadNote(absPath: string): Promise<string | null> {
  try {
    return await readTextFile(absPath);
  } catch {
    const tmpPath = `${absPath}.tmp`;
    if (await exists(tmpPath)) {
      try {
        return await readTextFile(tmpPath);
      } catch {
        return null;
      }
    }
    return null;
  }
}
