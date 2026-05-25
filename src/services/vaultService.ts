import {
  exists,
  mkdir,
  readDir,
  readTextFile,
  remove,
  rename,
  writeTextFile,
} from '@tauri-apps/plugin-fs';
import { invoke } from '@tauri-apps/api/core';
import { open } from '@tauri-apps/plugin-dialog';
import { decodeNote, encodeNote } from '../lib/frontmatter';
import { captureSnapshot } from '../lib/recoveryJournal';
import { fromRaw, type FileNode } from '../lib/fileTree';
import type { Note } from '../store/noteStore';

// Normalise all backslashes to forward slashes before joining so that vault
// paths returned by Tauri's file dialog on Windows (e.g. C:\Users\Alice\vault)
// don't produce mixed-separator strings that confuse trash::delete / the FS API.
const joinPath = (...parts: string[]) =>
  parts
    .filter(Boolean)
    .join('/')
    .replace(/\\/g, '/')
    .replace(/\/+/g, '/');

/** Obsidian-style filename from note title. */
export function noteFileName(title: string): string {
  const base = (title.trim() || 'Untitled').replace(/[/\\:*?"<>|]/g, '');
  return `${base}.md`;
}

/** Relative path inside the vault: `{folder}/Title.md` or `Title.md`. */
export function noteRelativePath(note: Pick<Note, 'title' | 'folder'>): string {
  const file = noteFileName(note.title);
  const folder = note.folder?.trim();
  return folder ? joinPath(folder, file) : file;
}

export function absoluteNotePath(vaultPath: string, note: Pick<Note, 'title' | 'folder'>): string {
  return joinPath(vaultPath, noteRelativePath(note));
}

function folderFromRelativePath(rel: string): string {
  const parts = rel.split('/');
  if (parts.length <= 1) return '';
  return parts.slice(0, -1).join('/');
}

function titleFromRelativePath(rel: string): string {
  const name = rel.split('/').pop() ?? 'Untitled';
  return name.replace(/\.md$/i, '') || 'Untitled';
}

function legacyNoteFromFile(raw: string, rel: string, fallbackId: string): Note {
  const now = new Date().toISOString();
  let content = raw.trimStart();
  let title = titleFromRelativePath(rel);

  if (content.startsWith('---')) {
    const decoded = decodeNote(raw, fallbackId);
    if (decoded) {
      return { ...decoded, filePath: rel, folder: decoded.folder || folderFromRelativePath(rel) };
    }
  }

  if (content.startsWith('# ')) {
    const first = content.split('\n')[0];
    title = first.slice(2).trim() || title;
    content = content
      .split('\n')
      .slice(1)
      .join('\n')
      .replace(/^\s*\n/, '');
  }

  return {
    id: fallbackId,
    title,
    content,
    tags: [],
    folder: folderFromRelativePath(rel),
    createdAt: now,
    updatedAt: now,
    filePath: rel,
  };
}

async function collectMdFiles(dir: string): Promise<string[]> {
  const out: string[] = [];
  let entries;
  try {
    entries = await readDir(dir);
  } catch {
    return out;
  }

  for (const entry of entries) {
    const path = joinPath(dir, entry.name);
    if (entry.isDirectory) {
      out.push(...(await collectMdFiles(path)));
    } else if (entry.isFile && entry.name.toLowerCase().endsWith('.md')) {
      out.push(path);
    }
  }
  return out;
}

export async function pickVaultDirectory(): Promise<string | null> {
  const selected = await open({
    directory: true,
    multiple: false,
    title: 'Open Phing Vault',
  });
  if (!selected || Array.isArray(selected)) return null;
  return selected;
}

export async function scanVault(vaultPath: string): Promise<Note[]> {
  const files = await collectMdFiles(vaultPath);
  const notes: Note[] = [];

  for (const filePath of files) {
    const rel =
      filePath.startsWith(vaultPath) ? filePath.slice(vaultPath.length).replace(/^\//, '') : filePath;

    const raw = await readTextFile(filePath);
    const fallbackId = crypto.randomUUID();
    const decoded = decodeNote(raw, fallbackId);
    const note = decoded
      ? {
          ...decoded,
          filePath: rel,
          folder: decoded.folder || folderFromRelativePath(rel),
        }
      : legacyNoteFromFile(raw, rel, fallbackId);

    notes.push(note);
  }

  return notes.sort(
    (a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime(),
  );
}

export async function writeNote(
  vaultPath: string,
  note: Note,
  previousRelativePath?: string,
): Promise<string> {
  const rel = noteRelativePath(note);
  const abs = absoluteNotePath(vaultPath, note);
  const parent = abs.split('/').slice(0, -1).join('/');

  if (parent && !(await exists(parent))) {
    await mkdir(parent, { recursive: true });
  }

  if (previousRelativePath && previousRelativePath !== rel) {
    const oldAbs = joinPath(vaultPath, previousRelativePath);
    if (await exists(oldAbs)) {
      if (await exists(abs)) await invoke('trash_file', { path: abs });
      await rename(oldAbs, abs);
    }
  }

  await writeTextFile(abs, encodeNote({ ...note, updatedAt: new Date().toISOString() }));
  return rel;
}

/**
 * Writes a note to disk atomically: content is first written to a `.tmp`
 * sibling, then renamed over the final path.  On POSIX systems (macOS, Linux)
 * the rename is atomic — a crash can only leave the old version or the new
 * one, never a partial write.  On Windows the rename is not guaranteed atomic
 * but still substantially safer than a direct overwrite.
 *
 * Before overwriting, the current disk content is snapshotted to the recovery
 * journal so it can be restored manually if needed.
 *
 * If `previousRelativePath` differs from the computed new path (i.e. the note
 * was renamed or moved), the old file is first renamed to the new location
 * before the atomic content write proceeds.
 */
export async function atomicWriteNote(
  vaultPath: string,
  note: Note,
  previousRelativePath?: string,
): Promise<string> {
  const rel = noteRelativePath(note);
  const abs = absoluteNotePath(vaultPath, note);
  // Use a per-call unique suffix so concurrent writes (e.g. 10 rapid "+ New Note"
  // clicks all landing on "Untitled.md") never overwrite each other's temp file
  // before the rename step, which would silently corrupt one note's content.
  const tmp = `${abs}.${crypto.randomUUID().slice(0, 8)}.tmp`;
  const parent = abs.split('/').slice(0, -1).join('/');

  if (parent && !(await exists(parent))) {
    await mkdir(parent, { recursive: true });
  }

  // ── Handle file rename (title or folder change) ──────────────────────────
  if (previousRelativePath && previousRelativePath !== rel) {
    const oldAbs = joinPath(vaultPath, previousRelativePath);
    if (await exists(oldAbs)) {
      // If a note already exists at the destination, move it to Trash rather
      // than hard-deleting it — consistent with the explicit delete behaviour
      // and recoverable if the collision was unintentional.
      if (await exists(abs)) await invoke('trash_file', { path: abs });
      await rename(oldAbs, abs);
    }
  }

  // ── Snapshot existing disk content before overwriting ────────────────────
  if (await exists(abs)) {
    try {
      const existing = await readTextFile(abs);
      await captureSnapshot(vaultPath, rel, existing);
    } catch {
      // Non-fatal — snapshot failure must not block the save.
    }
  }

  // ── Atomic write: .tmp → final ───────────────────────────────────────────
  const encoded = encodeNote({ ...note, updatedAt: new Date().toISOString() });
  await writeTextFile(tmp, encoded);
  await rename(tmp, abs);

  return rel;
}

/**
 * Reads a single note from disk by its vault-relative path.
 * Returns `null` if the file does not exist or cannot be decoded.
 */
export async function readNote(vaultPath: string, relPath: string): Promise<Note | null> {
  const abs = joinPath(vaultPath, relPath);
  try {
    const raw = await readTextFile(abs);
    const fallbackId = crypto.randomUUID();
    const decoded = decodeNote(raw, fallbackId);
    return decoded
      ? { ...decoded, filePath: relPath, folder: decoded.folder || folderFromRelativePath(relPath) }
      : legacyNoteFromFile(raw, relPath, fallbackId);
  } catch {
    return null;
  }
}

// ─── Vault tree ───────────────────────────────────────────────────────────────

/**
 * Call the Rust `scan_vault_tree` command and convert the raw camelCase
 * response into a typed `FileNode` tree.
 */
export async function scanVaultTree(vaultPath: string): Promise<FileNode> {
  const raw = await invoke<unknown>('scan_vault_tree', { vaultPath });
  return fromRaw(raw);
}

/**
 * Rename or move a file-system item (file or directory) via the Rust
 * `rename_path` command.  The Tauri `fs` plugin's `rename` only covers files;
 * this wraps the Rust `std::fs::rename` which handles directories too.
 */
export async function renameFsPath(from: string, to: string): Promise<void> {
  await invoke<void>('rename_path', { from, to });
}

/**
 * Create a directory (and any missing ancestors) using the Tauri fs plugin.
 */
export async function createDirectory(path: string): Promise<void> {
  await mkdir(path, { recursive: true });
}

/**
 * Move a note file to the system Trash rather than permanently deleting it.
 *
 * Using the OS trash means the user can recover an accidentally-deleted note
 * from Finder / Explorer / the desktop file-manager until they empty the
 * Trash themselves.  The `trash_file` Tauri command wraps the `trash` Rust
 * crate which handles macOS, Windows, and Linux (XDG) natively.
 */
export async function deleteNoteFile(vaultPath: string, relativePath: string): Promise<void> {
  const abs = joinPath(vaultPath, relativePath);
  if (await exists(abs)) {
    await invoke('trash_file', { path: abs });
  }
}
