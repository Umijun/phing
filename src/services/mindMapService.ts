/**
 * mindMapService.ts
 * Handles reading and writing individual Mind Map document files within the vault.
 *
 * Each mind map is stored as a JSON file under:
 *   {vault}/.phing/mindmaps/{uuid}.json
 *
 * File format (MindMapDoc):
 *   { id, title, folder, createdAt, updatedAt, tree: MindMapNode }
 *
 * Legacy files (bare MindMapNode objects from the prior pocket-board format)
 * are detected and migrated automatically on load.
 *
 * British English spelling maintained throughout.
 */

import {
  mkdir,
  readDir,
  readTextFile,
  rename,
  writeTextFile,
  remove,
} from '@tauri-apps/plugin-fs';
import type { MindMapNode } from '../lib/mindmap';

// ── Public document type ───────────────────────────────────────────────────────

export interface MindMapDoc {
  id: string;
  title: string;
  /** Pocket id the map belongs to.  '' = "All Notes" / uncategorised. */
  folder: string;
  tree: MindMapNode;
  createdAt: string;
  updatedAt: string;
}

// ── Path helpers ───────────────────────────────────────────────────────────────

const join = (...parts: string[]): string =>
  parts.filter(Boolean).join('/').replace(/\/+/g, '/');

/** Subfolder inside the vault that stores all mind-map JSON files. */
const MM_DIR = '.phing/mindmaps';

/** Absolute path to the mindmaps directory inside the vault. */
const mmDir = (vaultPath: string): string => join(vaultPath, MM_DIR);

/** Absolute path to a single mind-map document file. */
const docPath = (vaultPath: string, docId: string): string =>
  join(mmDir(vaultPath), `${docId}.json`);

// ── Helpers ────────────────────────────────────────────────────────────────────

/** Returns true if the parsed object looks like a legacy bare MindMapNode
 *  (produced by the previous pocket-board architecture). */
function isLegacyNode(raw: unknown): raw is MindMapNode {
  return (
    typeof raw === 'object' &&
    raw !== null &&
    typeof (raw as Record<string, unknown>).id === 'string' &&
    typeof (raw as Record<string, unknown>).label === 'string' &&
    Array.isArray((raw as Record<string, unknown>).children) &&
    !('tree' in (raw as Record<string, unknown>))
  );
}

/** Wraps a legacy bare MindMapNode in a MindMapDoc envelope. */
function wrapLegacyNode(node: MindMapNode, fileId: string): MindMapDoc {
  const now = new Date().toISOString();
  return {
    id:        fileId,
    title:     node.label || 'Mind Map',
    folder:    fileId === '_global' ? '' : fileId, // legacy id was the pocket id
    tree:      node,
    createdAt: now,
    updatedAt: now,
  };
}

// ── Public API ─────────────────────────────────────────────────────────────────

/**
 * Persists a single MindMapDoc to disk.
 * Creates the `.phing/mindmaps/` directory if it does not yet exist.
 */
export async function saveMindMapDoc(
  vaultPath: string,
  doc: MindMapDoc,
): Promise<void> {
  const dir = mmDir(vaultPath);
  // mkdir is idempotent when recursive: true — no exists() check needed, and
  // avoids the Tauri ACL scope issue that blocks the `exists` command on hidden
  // directories such as `.phing/mindmaps`.
  await mkdir(dir, { recursive: true });
  const updated: MindMapDoc = { ...doc, updatedAt: new Date().toISOString() };
  const finalPath = docPath(vaultPath, doc.id);
  const tmpPath   = `${finalPath}.tmp`;
  // Write to a temp file first, then atomically rename over the final path.
  // Mirrors the pattern used by noteStore so a crash mid-write never
  // leaves a truncated or partially-written JSON file.
  await writeTextFile(tmpPath, JSON.stringify(updated, null, 2));
  await rename(tmpPath, finalPath);
}

/**
 * Reads every `.json` file from the mindmaps directory and returns an array of
 * MindMapDoc objects.  Malformed or unrecognised files are silently skipped so
 * a single corrupt file cannot block application startup.
 *
 * Legacy files that are bare MindMapNode objects (from the prior
 * pocket-board format) are automatically wrapped in a MindMapDoc envelope.
 */
export async function loadAllMindMapDocs(
  vaultPath: string,
): Promise<MindMapDoc[]> {
  const dir = mmDir(vaultPath);
  // If the directory doesn't exist yet, readDir will throw — treat that as
  // "no maps stored" rather than a hard error.  Avoids exists() which is
  // blocked by the Tauri ACL scope for hidden directories.
  let entries: Awaited<ReturnType<typeof readDir>>;
  try {
    entries = await readDir(dir);
  } catch {
    return [];
  }

  const docs: MindMapDoc[] = [];

  for (const entry of entries) {
    if (!entry.isFile || !entry.name.toLowerCase().endsWith('.json')) continue;
    const fileId = entry.name.replace(/\.json$/i, '');

    try {
      const raw    = await readTextFile(join(dir, entry.name));
      const parsed = JSON.parse(raw) as unknown;

      if (isLegacyNode(parsed)) {
        // Migrate: wrap legacy pocket-board node as a MindMapDoc
        docs.push(wrapLegacyNode(parsed, fileId));
        continue;
      }

      // Validate new-format doc — must have id + title + tree
      const d = parsed as Partial<MindMapDoc>;
      if (
        typeof d.id !== 'string' ||
        typeof d.title !== 'string' ||
        typeof d.tree !== 'object' ||
        d.tree === null
      ) {
        console.warn('[phing] mindMapService: skipping invalid file', entry.name);
        continue;
      }

      docs.push(parsed as MindMapDoc);
    } catch {
      console.warn('[phing] mindMapService: skipping malformed file', entry.name);
    }
  }

  return docs.sort(
    (a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime(),
  );
}

/**
 * Removes the JSON file for a mind map document.
 * Safe to call even if the file does not exist.
 */
export async function deleteMindMapDoc(
  vaultPath: string,
  docId: string,
): Promise<void> {
  const path = docPath(vaultPath, docId);
  // Attempt removal directly; swallow the error when the file is already gone.
  try {
    await remove(path);
  } catch {
    // Not found — nothing to do.
  }
}
