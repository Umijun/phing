import { create } from 'zustand';
import { stripLegacyBody } from '../lib/frontmatter';
import {
  loadPockets,
  persistPockets,
  POCKET_COLORS,
  slugifyFolder,
} from '../lib/pockets';
import { isTauri } from '../lib/tauri';
import { noteWriteQueue } from '../lib/writeQueue';
import { vaultWatcher } from '../lib/fileWatcher';
import * as vaultService from '../services/vaultService';
import {
  type FileNode,
  insertChild,
  removeNode,
  renameNodeTree,
  findByPath,
  relPath,
  absPath as makeAbsPath,
  parentAbsPath,
} from '../lib/fileTree';
import { useVaultStore } from './vaultStore';

const PROFILE_KEY = 'phing_profile';

export interface Profile {
  name: string;
  subtitle: string;
  avatarUrl?: string;
}

const loadProfile = (): Profile => {
  try {
    const raw = localStorage.getItem(PROFILE_KEY);
    if (raw) return { ...defaultProfile(), ...JSON.parse(raw) };
  } catch {
    /* ignore */
  }
  return defaultProfile();
};

const defaultProfile = (): Profile => ({
  name: 'Scholar',
  subtitle: '',
});

const persistProfile = (profile: Profile) => {
  localStorage.setItem(PROFILE_KEY, JSON.stringify(profile));
};

export interface NoteCursor {
  anchor: number;
  head: number;
}

export interface Note {
  id: string;
  title: string;
  content: string;
  tags: string[];
  folder: string;
  createdAt: string;
  updatedAt: string;
  emoji?: string;
  description?: string;
  cursor?: NoteCursor;
  filePath?: string;
  wordCount?: number;
}

export interface Pocket {
  id: string;
  name: string;
  color: string;
  emoji?: string;
  wordCount?: number;
}

/** Represents the save / sync state of the currently active note. */
export interface SyncState {
  status: 'synced' | 'saving' | 'dirty' | 'error' | 'conflict';
  lastSyncedAt: string | null;
  errorMessage: string | null;
}

const INITIAL_SYNC_STATE: SyncState = {
  status: 'synced',
  lastSyncedAt: null,
  errorMessage: null,
};

interface NoteStore {
  notes: Note[];
  pockets: Pocket[];
  profile: Profile;
  selectedNoteId: string | null;
  activePocket: string;
  isDark: boolean;
  isZen: boolean;
  isAcademic: boolean;
  isSidebarOpen: boolean;
  panelsCollapsed: boolean;
  backlinksOpen: boolean;
  lang: 'en' | 'th';
  syncState: SyncState;
  isLoadingVault: boolean;
  dirtyNoteIds: Set<string>;
  /** Vault-wide map of tag → number of notes carrying that tag. */
  tagCounts: Record<string, number>;
  /**
   * Recursive file-system tree for the open vault.  `null` when no vault is
   * loaded (sample-data / first-run mode).  Updated on `loadVault` and
   * surgically patched by create / rename / delete operations so the sidebar
   * never needs a full re-scan for routine edits.
   */
  vaultTree: FileNode | null;

  updateProfile: (patch: Partial<Profile>) => void;
  selectNote: (id: string | null) => Promise<void>;
  setActivePocket: (id: string) => void;
  toggleDark: () => void;
  toggleZen: () => void;
  toggleAcademic: () => void;
  toggleSidebar: () => void;
  togglePanels: () => void;
  toggleBacklinks: () => void;
  toggleLang: () => void;
  createFolder: (name: string) => Pocket;
  deleteFolder: (id: string) => void;
  /** Set the emoji prefix for a pocket (persisted to localStorage). */
  setPocketEmoji: (pocketId: string, emoji: string) => void;

  loadVault: (path: string) => Promise<void>;
  openVaultPicker: () => Promise<string | null>;
  patchNote: (id: string, patch: Partial<Note> & { content?: string }) => void;
  scheduleFlush: (id: string) => void;
  flushNote: (id: string) => Promise<void>;
  flushActiveNote: () => Promise<void>;
  /** Flush every note that has a pending debounce write — called on app quit. */
  flushAllPending: () => Promise<void>;
  /** True when any note has a pending debounce timer or an in-flight write. */
  hasPendingWrites: () => boolean;
  /** Reload a note from its on-disk file, replacing the in-memory version. */
  reloadNote: (noteId: string) => Promise<void>;

  /** @deprecated Use patchNote */
  updateNoteContent: (id: string, content: string) => void;
  createNote: (folder?: string, title?: string) => Promise<Note>;
  deleteNote: (id: string) => Promise<void>;
  moveNote: (noteId: string, pocketId: string) => Promise<void>;
  /** Add a tag to a note; silently ignores duplicates and empty strings. */
  addTag: (noteId: string, tag: string) => void;
  /** Remove a tag from a note by exact (already-normalised) value. */
  removeTag: (noteId: string, tag: string) => void;

  // ── Folder operations (vault-tree aware) ──────────────────────────────────
  /** Re-scan the vault tree from disk without reloading note content. */
  refreshVaultTree: () => Promise<void>;
  /**
   * Create a new sub-folder at `absParentPath / folderName`, patch the in-memory
   * tree, and set it as the active folder so new notes land there.
   */
  createSubFolder: (absParentPath: string, folderName: string) => Promise<void>;
  /**
   * Rename `absOldPath` to `newName` (sibling rename, not move).
   * Updates the tree, all affected note `folder` fields, and `filePath` strings
   * without a full vault re-scan.
   */
  /**
   * Returns `true` when the rename succeeded, `false` when it was aborted
   * (name collision, empty name, same name, or FS error).  Callers can keep
   * the rename input open on `false` so the user can choose a different name.
   */
  renameTreeFolder: (absOldPath: string, newName: string) => Promise<boolean>;
  /**
   * Move the folder at `absPath` to the system Trash and remove it from the
   * in-memory tree + note list.
   */
  deleteTreeFolder: (absPath: string) => Promise<void>;
}

const SAMPLE_NOTES: Note[] = [
  {
    id: '1',
    title: 'Welcome to Phing',
    emoji: '✦',
    folder: '',
    description: 'A quiet corner for thinking',
    content:
      '## Getting Started\n\nPhing is a local-first note-taking app. Your notes live on your own machine as plain Markdown files.\n\n---\n\n## Features\n\n- **Wiki links** — type `[[` to link between notes\n- **Pockets** — organise notes into folders\n- **Mind Map Board** — visualise connections between ideas\n\n### Keyboard Shortcuts\n\n- `⌘K` — command palette\n- `⌘⇧Z` — zen mode\n- `⌘⇧S` — toggle sidebar\n- `⌘⇧M` — toggle mind map board',
    tags: ['guide'],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  },
  {
    id: '2',
    title: 'Research Template',
    emoji: '🔬',
    folder: 'research',
    content:
      '## Question\n\nWhat are you trying to understand?\n\n## Sources\n\n- Source 1\n- Source 2\n\n## Notes\n\nYour observations here.',
    tags: ['template'],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  },
  {
    id: '3',
    title: 'Daily Journal',
    folder: 'journal',
    emoji: '📔',
    content: 'Write freely. This is your space.',
    tags: [],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  },
].map((n) => ({ ...n, content: stripLegacyBody(n.content) }));

const flushTimers = new Map<string, ReturnType<typeof setTimeout>>();
const FLUSH_DELAY_MS = 100;

/**
 * Tracks absolute paths of notes currently mid-creation (between title
 * deduplication and the atomicWriteNote call completing).  Because
 * createNote is async, two rapid clicks can both read the same notes[]
 * snapshot and both decide "Untitled.md" is available, then race to write
 * the same file.  Checking this Set makes the deduplication JS-atomic —
 * no await between the has() check and the add() call.
 */
const pendingCreatePaths = new Set<string>();

function getVaultPath(): string | null {
  return useVaultStore.getState().vaultPath;
}

function applyNotePatch(notes: Note[], id: string, patch: Partial<Note>): Note[] {
  return notes.map((n) =>
    n.id === id ? { ...n, ...patch, updatedAt: patch.updatedAt ?? new Date().toISOString() } : n,
  );
}

/**
 * Rebuild the vault-wide tag → note-count index from scratch.
 *
 * Called only when tags actually change (add/remove, vault load, note delete,
 * note reload) — never on every keystroke — so O(notes × avg-tags) is fine.
 */
function buildTagCounts(notes: Note[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const note of notes) {
    for (const tag of note.tags) {
      counts[tag] = (counts[tag] ?? 0) + 1;
    }
  }
  return counts;
}

/** Normalise a raw tag string: trim, lowercase, collapse spaces to hyphens. */
export function normaliseTag(raw: string): string {
  return raw.trim().toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-_]/g, '');
}

const initialVaultPath =
  typeof localStorage !== 'undefined' ? localStorage.getItem('phing_vault_path') : null;

/** Dev fallback only — never used when a vault path is configured. */
const useSampleData = !initialVaultPath;

export const useNoteStore = create<NoteStore>((set, get) => ({
  notes: useSampleData ? SAMPLE_NOTES : [],
  pockets: loadPockets(),
  profile: loadProfile(),
  selectedNoteId: useSampleData ? '1' : null,
  activePocket: '',
  isDark: false,
  isZen: false,
  isAcademic: false,
  isSidebarOpen: true,
  panelsCollapsed: false,
  backlinksOpen: true,
  lang: 'en',
  syncState: INITIAL_SYNC_STATE,
  isLoadingVault: false,
  dirtyNoteIds: new Set(),
  tagCounts: buildTagCounts(useSampleData ? SAMPLE_NOTES : []),
  vaultTree: null,

  updateProfile: (patch) => {
    const profile = { ...get().profile, ...patch };
    persistProfile(profile);
    set({ profile });
  },

  selectNote: async (id) => {
    await get().flushActiveNote();
    set({ selectedNoteId: id });
  },

  setActivePocket: (id) => set({ activePocket: id }),

  toggleDark: () => {
    const next = !get().isDark;
    document.documentElement.classList.toggle('dark', next);
    set({ isDark: next });
  },
  toggleZen: () => set((s) => ({ isZen: !s.isZen })),
  toggleAcademic: () => set((s) => ({ isAcademic: !s.isAcademic })),
  toggleSidebar: () => set((s) => ({ isSidebarOpen: !s.isSidebarOpen })),
  togglePanels: () => set((s) => ({ panelsCollapsed: !s.panelsCollapsed })),
  toggleBacklinks: () => set((s) => ({ backlinksOpen: !s.backlinksOpen })),
  toggleLang: () => set((s) => ({ lang: s.lang === 'en' ? 'th' : 'en' })),

  createFolder: (name) => {
    const trimmed = name.trim();
    if (!trimmed) throw new Error('Folder name required');
    let id = slugifyFolder(trimmed);
    const existing = get().pockets;
    if (existing.some((p) => p.id === id)) {
      id = `${id}-${crypto.randomUUID().slice(0, 6)}`;
    }
    const pocket: Pocket = {
      id,
      name: trimmed,
      color: POCKET_COLORS[existing.length % POCKET_COLORS.length],
      emoji: '📁',
    };
    const pockets = [...existing, pocket];
    persistPockets(pockets);
    set({ pockets, activePocket: id });
    return pocket;
  },

  deleteFolder: (id) => {
    // Mirror deleteTreeFolder's pre-emptive write cancellation.  In legacy /
    // no-vault-tree mode (vaultTree is null but isTauri may still be true),
    // any debounced or queued writes for notes inside this pocket would fire
    // after the pocket is removed and silently write the note files to the
    // vault root (because patchNote sets folder → '' before the write runs).
    const notesInPocket = get().notes.filter((n) => n.folder === id);
    for (const n of notesInPocket) {
      const timer = flushTimers.get(n.id);
      if (timer) { clearTimeout(timer); flushTimers.delete(n.id); }
      noteWriteQueue.cancel(n.id);
    }

    const pockets = get().pockets.filter((p) => p.id !== id);
    persistPockets(pockets);
    set((s) => ({
      pockets,
      activePocket: s.activePocket === id ? '' : s.activePocket,
      notes: s.notes.map((n) => (n.folder === id ? { ...n, folder: '' } : n)),
    }));
    // Move any mind maps that belonged to this pocket back to the root folder,
    // mirroring the behaviour for notes (which also move to '' on pocket delete).
    import('../store/mindMapStore').then(({ useMindMapStore }) => {
      useMindMapStore.getState().moveMindMapsFromPocket(id);
    }).catch(() => {/* ignore */});
  },

  setPocketEmoji: (pocketId, emoji) => {
    // If the pocket exists in the flat list, update + persist.
    // In vault mode the pocket metadata is shadowed by vaultTree folders, so
    // this also covers sample-data / no-vault mode where pockets[] is authoritative.
    const pockets = get().pockets.map((p) =>
      p.id === pocketId ? { ...p, emoji } : p,
    );
    persistPockets(pockets);
    set({ pockets });
  },

  loadVault: async (path) => {
    if (!isTauri()) return;
    set({ isLoadingVault: true, syncState: INITIAL_SYNC_STATE });
    try {
      // Scan notes and the directory tree in parallel — neither depends on the other.
      const [notes, vaultTree] = await Promise.all([
        vaultService.scanVault(path),
        vaultService.scanVaultTree(path).catch((e) => {
          console.warn('[phing] scanVaultTree failed (non-fatal)', e);
          return null;
        }),
      ]);
      set({
        notes,
        vaultTree,
        tagCounts: buildTagCounts(notes),
        selectedNoteId: notes[0]?.id ?? null,
        isLoadingVault: false,
        dirtyNoteIds: new Set(),
        syncState: { status: 'synced', lastSyncedAt: null, errorMessage: null },
      });
    } catch (e) {
      console.error('[phing] loadVault failed', e);
      set({
        isLoadingVault: false,
        syncState: { status: 'error', lastSyncedAt: null, errorMessage: String(e) },
      });
    }
  },

  openVaultPicker: async () => {
    if (!isTauri()) return null;
    const path = await vaultService.pickVaultDirectory();
    if (path) {
      useVaultStore.getState().setVaultPath(path);
      await get().loadVault(path);
    }
    return path;
  },

  patchNote: (id, patch) => {
    set((s) => {
      const dirty = new Set(s.dirtyNoteIds);
      dirty.add(id);
      const updatedNotes = applyNotePatch(s.notes, id, patch);
      return {
        notes: updatedNotes,
        dirtyNoteIds: dirty,
        syncState: { ...s.syncState, status: 'dirty' },
        // Only rebuild the index when tags actually changed — never on keystrokes.
        ...('tags' in patch && { tagCounts: buildTagCounts(updatedNotes) }),
      };
    });
    get().scheduleFlush(id);
  },

  scheduleFlush: (id) => {
    const existing = flushTimers.get(id);
    if (existing) clearTimeout(existing);
    flushTimers.set(
      id,
      setTimeout(() => {
        flushTimers.delete(id);
        void get().flushNote(id);
      }, FLUSH_DELAY_MS),
    );
  },

  flushNote: async (id) => {
    const vaultPath = getVaultPath();
    if (!vaultPath || !isTauri()) return;

    const note = get().notes.find((n) => n.id === id);
    if (!note) return;

    set((s) => ({
      syncState: { ...s.syncState, status: 'saving', errorMessage: null },
    }));

    try {
      await noteWriteQueue.enqueue({
        id,
        run: async () => {
          // Re-read at execution time — the queue may have coalesced multiple patches.
          const fresh = get().notes.find((n) => n.id === id);
          if (!fresh) return;

          // Suppress the FS event our own atomic rename will trigger.
          const abs = vaultService.absoluteNotePath(vaultPath, fresh);
          vaultWatcher.suppressNext(abs);

          const rel = await vaultService.atomicWriteNote(vaultPath, fresh, fresh.filePath);

          // Post-write liveness check: deleteTreeFolder may have trashed the
          // note's containing folder while atomicWriteNote was executing.  In
          // that narrow window, atomicWriteNote's mkdir() call could recreate
          // the trashed folder on disk.  We cannot undo the mkdir, but we can
          // refuse to update the store — preventing a zombie note from receiving
          // a 'synced' status and a stale filePath update.
          if (!get().notes.find((n) => n.id === id)) return;

          set((s) => {
            const dirty = new Set(s.dirtyNoteIds);
            dirty.delete(id);

            // ── Surgical vaultTree rename patch ─────────────────────────────
            // When the note's title (or folder) changed, atomicWriteNote
            // renames the file on disk and returns a new relative path.
            // Detect that by comparing the OLD filePath to the NEW `rel`.
            // If they differ, use renameNodeTree to rewrite the matching
            // node's .name and .path in one pass — no full re-scan needed.
            let newVaultTree = s.vaultTree;
            if (newVaultTree && fresh.filePath && fresh.filePath !== rel) {
              const oldAbs = makeAbsPath(vaultPath, fresh.filePath);
              const newAbs = makeAbsPath(vaultPath, rel);
              newVaultTree = renameNodeTree(newVaultTree, oldAbs, newAbs);
            }

            return {
              notes:        applyNotePatch(s.notes, id, { filePath: rel }),
              dirtyNoteIds: dirty,
              syncState: {
                status:       'synced',
                lastSyncedAt: new Date().toISOString(),
                errorMessage: null,
              },
              ...(newVaultTree !== s.vaultTree ? { vaultTree: newVaultTree } : {}),
            };
          });
        },
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Unknown write error';
      console.error('[phing] flushNote failed', err);
      set((s) => ({
        syncState: { ...s.syncState, status: 'error', errorMessage: msg },
      }));
    }
  },

  flushActiveNote: async () => {
    const { selectedNoteId, dirtyNoteIds } = get();
    if (!selectedNoteId || !dirtyNoteIds.has(selectedNoteId)) return;
    const pending = flushTimers.get(selectedNoteId);
    if (pending) {
      clearTimeout(pending);
      flushTimers.delete(selectedNoteId);
    }
    await get().flushNote(selectedNoteId);
  },

  flushAllPending: async () => {
    // Collect every note that is either waiting in the debounce queue OR marked
    // dirty but not yet queued (shouldn't normally happen, but be defensive).
    const pendingIds = new Set([
      ...flushTimers.keys(),
      ...get().dirtyNoteIds,
    ]);
    if (!pendingIds.size) return;

    // Cancel all timers first so they don't double-fire after we save.
    for (const id of pendingIds) {
      const t = flushTimers.get(id);
      if (t) { clearTimeout(t); flushTimers.delete(id); }
    }

    // Flush in parallel — one failure must not block the others.
    await Promise.allSettled(
      [...pendingIds].map((id) => get().flushNote(id)),
    );
  },

  hasPendingWrites: () => flushTimers.size > 0 || get().dirtyNoteIds.size > 0,

  reloadNote: async (noteId) => {
    const vaultPath = getVaultPath();
    if (!vaultPath || !isTauri()) return;

    const note = get().notes.find((n) => n.id === noteId);
    if (!note?.filePath) return;

    try {
      const fresh = await vaultService.readNote(vaultPath, note.filePath);
      if (!fresh) return;

      set((s) => {
        const updatedNotes = s.notes.map((n) =>
          n.id === noteId
            ? { ...fresh, id: noteId, filePath: note.filePath }
            : n,
        );
        return {
          notes: updatedNotes,
          tagCounts: buildTagCounts(updatedNotes),
          dirtyNoteIds: new Set([...s.dirtyNoteIds].filter((d) => d !== noteId)),
          syncState: {
            status: 'synced',
            lastSyncedAt: new Date().toISOString(),
            errorMessage: null,
          },
        };
      });
    } catch (e) {
      console.error('[phing] reloadNote failed', e);
    }
  },

  updateNoteContent: (id, content) => {
    get().patchNote(id, { content });
  },

  createNote: async (folder = '', title = 'Untitled') => {
    // ── Deduplicate title ────────────────────────────────────────────────────
    // Two rapid clicks both read the same notes[] snapshot and can independently
    // resolve to the same filename ("Untitled.md").  We guard with:
    //   1. A check against notes already in the store.
    //   2. A check against pendingCreatePaths — paths currently mid-creation
    //      (between this deduplication step and atomicWriteNote completing).
    // Because JavaScript is single-threaded, the has() + add() pair below is
    // atomic — no other createNote call can execute between them.
    const vaultPath = getVaultPath();
    let uniqueTitle = title;
    if (vaultPath && isTauri()) {
      let counter = 2;
      const mkPath = (t: string) => vaultService.absoluteNotePath(vaultPath, { title: t, folder });
      while (
        get().notes.some(
          (n) =>
            n.folder === folder &&
            vaultService.noteFileName(n.title) === vaultService.noteFileName(uniqueTitle),
        ) ||
        pendingCreatePaths.has(mkPath(uniqueTitle))
      ) {
        uniqueTitle = `${title} ${counter++}`;
      }
      pendingCreatePaths.add(mkPath(uniqueTitle));
    }

    const note: Note = {
      id: crypto.randomUUID(),
      title: uniqueTitle,
      content: '',
      tags: [],
      folder,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    // Compute the new vaultTree patch (if a vault is open) before the final
    // set() so that notes[], selectedNoteId, and vaultTree are all committed
    // in a single React render — prevents the NoteNode from briefly showing
    // the filename fallback ("Untitled") between two separate set() calls.
    let patchedVaultTree: import('../lib/fileTree').FileNode | null = null;

    if (vaultPath && isTauri()) {
      try {
        const abs = vaultService.absoluteNotePath(vaultPath, note);
        vaultWatcher.suppressNext(abs);
        const rel = await vaultService.atomicWriteNote(vaultPath, note);
        note.filePath = rel;

        // Surgically insert the new file node into the in-memory tree so the
        // sidebar updates without a full re-scan.
        const { vaultTree } = get();
        if (vaultTree) {
          const parentAbs = makeAbsPath(vaultPath, folder);
          const fileNode: import('../lib/fileTree').FileNode = {
            name:     vaultService.noteFileName(note.title),
            path:     abs,
            isDir:    false,
            children: [],
          };
          patchedVaultTree = insertChild(vaultTree, parentAbs, fileNode);
        }
      } catch (e) {
        console.error('[phing] createNote write failed', e);
      } finally {
        // Always release the in-flight slot so the title can be reused if the
        // write failed and the user tries again.
        pendingCreatePaths.delete(vaultService.absoluteNotePath(vaultPath, note));
      }
    }

    // Single set() — one React render atomically updates notes, selection,
    // and (when available) the vaultTree so the sidebar never flickers.
    set((s) => ({
      notes:          [note, ...s.notes],
      selectedNoteId: note.id,
      ...(patchedVaultTree ? { vaultTree: patchedVaultTree } : {}),
    }));
    return note;
  },

  deleteNote: async (id) => {
    const note = get().notes.find((n) => n.id === id);

    // ── Cancel any pending write before touching the file ────────────────────
    // Without this, a debounce timer or a queued write fires after the file is
    // deleted and silently recreates it on disk.
    const pendingTimer = flushTimers.get(id);
    if (pendingTimer) {
      clearTimeout(pendingTimer);
      flushTimers.delete(id);
    }
    noteWriteQueue.cancel(id);

    const vaultPath = getVaultPath();
    if (vaultPath && note?.filePath && isTauri()) {
      try {
        await vaultService.deleteNoteFile(vaultPath, note.filePath);

        // Remove from the in-memory tree
        const { vaultTree } = get();
        if (vaultTree) {
          const nodeAbs = makeAbsPath(vaultPath, note.filePath);
          set({ vaultTree: removeNode(vaultTree, nodeAbs) });
        }
      } catch (e) {
        // The file delete failed (e.g. permissions error, unsupported FS).
        // Do NOT remove the note from state — leaving it visible is far safer
        // than hiding it while the file stays on disk (which causes it to
        // reappear as a ghost on the next vault load).
        console.error('[phing] deleteNote failed — note kept in state', e);
        return;
      }
    }
    set((s) => {
      const remaining = s.notes.filter((n) => n.id !== id);
      const idx = s.notes.findIndex((n) => n.id === id);
      let nextId = s.selectedNoteId;
      if (s.selectedNoteId === id) {
        nextId = remaining[Math.min(idx, remaining.length - 1)]?.id ?? null;
      }
      return {
        notes: remaining,
        tagCounts: buildTagCounts(remaining),
        selectedNoteId: nextId,
      };
    });
  },

  addTag: (noteId, rawTag) => {
    const tag = normaliseTag(rawTag);
    if (!tag) return;
    const note = get().notes.find((n) => n.id === noteId);
    if (!note || note.tags.includes(tag)) return;
    get().patchNote(noteId, { tags: [...note.tags, tag] });
  },

  removeTag: (noteId, tag) => {
    const note = get().notes.find((n) => n.id === noteId);
    if (!note) return;
    get().patchNote(noteId, { tags: note.tags.filter((t) => t !== tag) });
  },

  // ── Folder operations ────────────────────────────────────────────────────────

  refreshVaultTree: async () => {
    const vaultPath = getVaultPath();
    if (!vaultPath || !isTauri()) return;
    try {
      const vaultTree = await vaultService.scanVaultTree(vaultPath);
      set({ vaultTree });
    } catch (e) {
      console.error('[phing] refreshVaultTree failed', e);
    }
  },

  createSubFolder: async (absParentPath, folderName) => {
    const vaultPath = getVaultPath();
    if (!vaultPath || !isTauri()) return;
    const name = folderName.trim().replace(/[/\\:*?"<>|]/g, '');
    if (!name) return;
    // Normalise the parent path (strip any accidental trailing slash) so the
    // concat always produces a clean absolute path and insertChild's path
    // equality check matches what Rust stored in the tree.
    const parent = absParentPath.replace(/\/$/, '');
    const newAbs = `${parent}/${name}`;
    try {
      await vaultService.createDirectory(newAbs);
      // Use the functional updater form so we read the tree that's current at
      // commit time, not the one captured before the await.  If the file
      // watcher fired a refresh during the mkdir, this prevents the new node
      // from being silently lost.
      const newRel = relPath(vaultPath, newAbs);
      set((s) => {
        if (!s.vaultTree) return { activePocket: newRel };
        const folderNode: FileNode = {
          name, path: newAbs, isDir: true, children: [],
        };
        return {
          vaultTree:    insertChild(s.vaultTree, parent, folderNode),
          activePocket: newRel,
        };
      });
    } catch (e) {
      console.error('[phing] createSubFolder failed', e);
    }
  },

  renameTreeFolder: async (absOldPath, newName) => {
    const vaultPath = getVaultPath();
    if (!vaultPath || !isTauri()) return false;
    const name      = newName.trim().replace(/[/\\:*?"<>|]/g, '');
    if (!name) return false;
    const newAbsPath = `${parentAbsPath(absOldPath)}/${name}`;
    // Same name — no-op, but not a failure: return true so the caller closes
    // the rename input normally.
    if (newAbsPath === absOldPath) return true;

    // Guard: if the in-memory tree already contains a node at the target path,
    // the destination folder exists on disk.  On Unix, rename() would silently
    // replace an empty dir; on any platform a non-empty dir causes an error.
    // Either way the user would lose data or get an opaque console error.
    // Return false so the caller keeps the rename input open for correction.
    const currentTree = get().vaultTree;
    if (currentTree && findByPath(currentTree, newAbsPath)) {
      console.warn('[phing] renameTreeFolder aborted — a folder named', name, 'already exists');
      return false;
    }

    try {
      await vaultService.renameFsPath(absOldPath, newAbsPath);

      const oldRel = relPath(vaultPath, absOldPath);
      const newRel = relPath(vaultPath, newAbsPath);

      // Patch notes, pockets, and the vault tree atomically.
      set((s) => {
        const updatedNotes = s.notes.map((n) => {
          const inFolder = n.folder === oldRel || n.folder.startsWith(oldRel + '/');
          const inPath   = n.filePath && (
            n.filePath === oldRel ||
            n.filePath.startsWith(oldRel + '/')
          );
          if (!inFolder && !inPath) return n;
          return {
            ...n,
            folder:   inFolder ? n.folder.replace(oldRel, newRel)    : n.folder,
            filePath: inPath   ? n.filePath!.replace(oldRel, newRel) : n.filePath,
          };
        });

        // Keep the pockets list in sync so PocketFilterDropdown reflects the
        // rename immediately.  A depth-0 folder's pocket ID equals its
        // vault-relative path, so swap oldRel → newRel for any matching entry.
        const updatedPockets = s.pockets.map((p) =>
          p.id === oldRel ? { ...p, id: newRel, name } : p,
        );
        const pocketsChanged = updatedPockets.some((p, i) => p.id !== s.pockets[i]?.id);
        if (pocketsChanged) persistPockets(updatedPockets);

        return {
          notes:     updatedNotes,
          pockets:   updatedPockets,
          vaultTree: s.vaultTree ? renameNodeTree(s.vaultTree, absOldPath, newAbsPath) : null,
          // If the user was viewing the renamed folder, update the active path.
          activePocket: s.activePocket === oldRel || s.activePocket.startsWith(oldRel + '/')
            ? s.activePocket.replace(oldRel, newRel)
            : s.activePocket,
        };
      });
      return true;
    } catch (e) {
      console.error('[phing] renameTreeFolder failed', e);
      return false;
    }
  },

  deleteTreeFolder: async (absPath) => {
    const vaultPath = getVaultPath();
    if (!vaultPath || !isTauri()) return;
    const folderRel = relPath(vaultPath, absPath);

    // ── Pre-emptively cancel all pending writes for notes inside this folder ──
    // Without this, a debounce timer that fires after the folder is trashed
    // calls atomicWriteNote, which calls mkdir() on the parent, silently
    // re-creating the folder on disk as an empty directory with just one file.
    const notesInFolder = get().notes.filter(
      (n) => n.folder === folderRel || n.folder.startsWith(folderRel + '/'),
    );
    for (const n of notesInFolder) {
      const timer = flushTimers.get(n.id);
      if (timer) { clearTimeout(timer); flushTimers.delete(n.id); }
      noteWriteQueue.cancel(n.id);
    }

    try {
      // Move entire folder to Trash via the existing trash_file Rust command
      const { invoke } = await import('@tauri-apps/api/core');
      await invoke('trash_file', { path: absPath });

      set((s) => {
        const remaining = s.notes.filter(
          (n) => n.folder !== folderRel && !n.folder.startsWith(folderRel + '/'),
        );
        const deletedIds = new Set(
          s.notes
            .filter((n) => n.folder === folderRel || n.folder.startsWith(folderRel + '/'))
            .map((n) => n.id),
        );
        const nextSelected = deletedIds.has(s.selectedNoteId ?? '')
          ? (remaining[0]?.id ?? null)
          : s.selectedNoteId;

        // Remove the matching pocket entry (if any) so PocketFilterDropdown
        // in the Board view immediately stops showing the deleted folder.
        // A depth-0 folder's pocket ID equals its vault-relative path.
        const updatedPockets = s.pockets.filter(
          (p) => p.id !== folderRel && !p.id.startsWith(folderRel + '/'),
        );
        if (updatedPockets.length !== s.pockets.length) {
          persistPockets(updatedPockets);
        }

        return {
          notes:          remaining,
          pockets:        updatedPockets,
          tagCounts:      buildTagCounts(remaining),
          selectedNoteId: nextSelected,
          activePocket:   s.activePocket === folderRel || s.activePocket.startsWith(folderRel + '/')
            ? ''
            : s.activePocket,
          vaultTree: s.vaultTree ? removeNode(s.vaultTree, absPath) : null,
        };
      });
    } catch (e) {
      console.error('[phing] deleteTreeFolder failed', e);
    }
  },

  moveNote: async (noteId, pocketId) => {
    const note = get().notes.find((n) => n.id === noteId);
    if (!note) return;

    // Update the note's folder in-store immediately so the UI (NoteList filter,
    // vaultTree highlight) reflects the destination pocket without waiting for
    // the disk write to complete.
    get().patchNote(noteId, { folder: pocketId });

    // patchNote schedules a 100 ms debounce flush.  Cancel it — moveNote owns
    // this write.  Crucially, we now route the write through noteWriteQueue so
    // it is serialised with any *already-inflight* flush for this note (e.g. a
    // title-rename save that fired just before the user dragged the card).
    // Previously moveNote called atomicWriteNote directly, which meant it could
    // race an inflight flushNote and produce two concurrent writes to the same
    // file — corrupting the on-disk content and leaving a stale filePath in the
    // store.
    const pendingTimer = flushTimers.get(noteId);
    if (pendingTimer) { clearTimeout(pendingTimer); flushTimers.delete(noteId); }

    const vaultPath = getVaultPath();
    if (!vaultPath || !isTauri()) return;

    try {
      await noteWriteQueue.enqueue({
        id: noteId,
        run: async () => {
          // Re-read state at execution time so we always have the freshest
          // content and the correct current filePath.  If a preceding inflight
          // save already committed a title-rename, filePath will reflect the
          // renamed path here — which is exactly the file we need to move.
          const fresh = get().notes.find((n) => n.id === noteId);
          if (!fresh) return; // note was deleted while the move was queued

          // prevFilePath = canonical on-disk location as of this moment.
          // Using fresh.filePath (not a value captured before patchNote) means
          // we always rename from wherever the file actually lives, even if a
          // preceding queue entry already moved it.
          const prevFilePath = fresh.filePath;
          const newAbs = vaultService.absoluteNotePath(vaultPath, fresh);
          vaultWatcher.suppressNext(newAbs);

          const rel = await vaultService.atomicWriteNote(vaultPath, fresh, prevFilePath);

          set((s) => {
            let newVaultTree = s.vaultTree;
            if (newVaultTree) {
              // Cross-directory move: remove the node from its current location
              // and insert it under the destination pocket.
              // renameNodeTree is intentionally NOT used here — it only rewrites
              // path strings in-place and cannot move a node between parents.
              if (prevFilePath) {
                newVaultTree = removeNode(newVaultTree, makeAbsPath(vaultPath, prevFilePath));
              }
              const nodeAbs   = makeAbsPath(vaultPath, rel);
              const parentAbs = makeAbsPath(vaultPath, pocketId);
              const fileNode: FileNode = {
                name:     vaultService.noteFileName(fresh.title),
                path:     nodeAbs,
                isDir:    false,
                children: [],
              };
              newVaultTree = insertChild(newVaultTree, parentAbs, fileNode);
            }
            return {
              notes:     applyNotePatch(s.notes, noteId, { filePath: rel }),
              vaultTree: newVaultTree,
            };
          });
        },
      });
    } catch (e) {
      console.error('[phing] moveNote failed', e);
    }
  },
}));
