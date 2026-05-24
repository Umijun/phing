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
  panelsCollapsed: boolean;
  backlinksOpen: boolean;
  lang: 'en' | 'th';
  syncState: SyncState;
  isLoadingVault: boolean;
  dirtyNoteIds: Set<string>;

  updateProfile: (patch: Partial<Profile>) => void;
  selectNote: (id: string | null) => Promise<void>;
  setActivePocket: (id: string) => void;
  toggleDark: () => void;
  toggleZen: () => void;
  toggleAcademic: () => void;
  togglePanels: () => void;
  toggleBacklinks: () => void;
  toggleLang: () => void;
  createFolder: (name: string) => Pocket;
  deleteFolder: (id: string) => void;

  loadVault: (path: string) => Promise<void>;
  openVaultPicker: () => Promise<string | null>;
  patchNote: (id: string, patch: Partial<Note> & { content?: string }) => void;
  scheduleFlush: (id: string) => void;
  flushNote: (id: string) => Promise<void>;
  flushActiveNote: () => Promise<void>;
  /** Reload a note from its on-disk file, replacing the in-memory version. */
  reloadNote: (noteId: string) => Promise<void>;

  /** @deprecated Use patchNote */
  updateNoteContent: (id: string, content: string) => void;
  createNote: (folder?: string, title?: string) => Promise<Note>;
  deleteNote: (id: string) => Promise<void>;
  moveNote: (noteId: string, pocketId: string) => Promise<void>;
}

const SAMPLE_NOTES: Note[] = [
  {
    id: '1',
    title: 'Welcome to Phing',
    emoji: '✦',
    folder: '',
    description: 'A quiet corner for thinking',
    content:
      '## Getting Started\n\nPhing is a local-first note-taking app. Your notes live on your own machine as plain Markdown files.\n\n---\n\n## Features\n\n- **Wiki links** — type `[[` to link between notes\n- **Pockets** — organise notes into folders\n- **Mind Map Board** — visualise connections between ideas\n\n### Keyboard Shortcuts\n\n- `⌘K` — command palette\n- `⌘⇧Z` — zen mode\n- `⌘⇧M` — toggle mind map board',
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
const FLUSH_DELAY_MS = 500;

function getVaultPath(): string | null {
  return useVaultStore.getState().vaultPath;
}

function applyNotePatch(notes: Note[], id: string, patch: Partial<Note>): Note[] {
  return notes.map((n) =>
    n.id === id ? { ...n, ...patch, updatedAt: patch.updatedAt ?? new Date().toISOString() } : n,
  );
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
  panelsCollapsed: false,
  backlinksOpen: true,
  lang: 'en',
  syncState: INITIAL_SYNC_STATE,
  isLoadingVault: false,
  dirtyNoteIds: new Set(),

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

  loadVault: async (path) => {
    if (!isTauri()) return;
    set({ isLoadingVault: true, syncState: INITIAL_SYNC_STATE });
    try {
      const notes = await vaultService.scanVault(path);
      set({
        notes,
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
      return {
        notes: applyNotePatch(s.notes, id, patch),
        dirtyNoteIds: dirty,
        syncState: { ...s.syncState, status: 'dirty' },
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

          set((s) => {
            const dirty = new Set(s.dirtyNoteIds);
            dirty.delete(id);
            return {
              notes: applyNotePatch(s.notes, id, { filePath: rel }),
              dirtyNoteIds: dirty,
              syncState: {
                status: 'synced',
                lastSyncedAt: new Date().toISOString(),
                errorMessage: null,
              },
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

  reloadNote: async (noteId) => {
    const vaultPath = getVaultPath();
    if (!vaultPath || !isTauri()) return;

    const note = get().notes.find((n) => n.id === noteId);
    if (!note?.filePath) return;

    try {
      const fresh = await vaultService.readNote(vaultPath, note.filePath);
      if (!fresh) return;

      set((s) => ({
        notes: s.notes.map((n) =>
          n.id === noteId
            ? { ...fresh, id: noteId, filePath: note.filePath }
            : n,
        ),
        dirtyNoteIds: new Set([...s.dirtyNoteIds].filter((d) => d !== noteId)),
        syncState: {
          status: 'synced',
          lastSyncedAt: new Date().toISOString(),
          errorMessage: null,
        },
      }));
    } catch (e) {
      console.error('[phing] reloadNote failed', e);
    }
  },

  updateNoteContent: (id, content) => {
    get().patchNote(id, { content });
  },

  createNote: async (folder = '', title = 'Untitled') => {
    const note: Note = {
      id: crypto.randomUUID(),
      title,
      content: '',
      tags: [],
      folder,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    const vaultPath = getVaultPath();
    if (vaultPath && isTauri()) {
      try {
        const abs = vaultService.absoluteNotePath(vaultPath, note);
        vaultWatcher.suppressNext(abs);
        const rel = await vaultService.atomicWriteNote(vaultPath, note);
        note.filePath = rel;
      } catch (e) {
        console.error('[phing] createNote write failed', e);
      }
    }

    set((s) => ({ notes: [note, ...s.notes], selectedNoteId: note.id }));
    return note;
  },

  deleteNote: async (id) => {
    const note = get().notes.find((n) => n.id === id);
    const vaultPath = getVaultPath();
    if (vaultPath && note?.filePath && isTauri()) {
      try {
        await vaultService.deleteNoteFile(vaultPath, note.filePath);
      } catch (e) {
        console.error('[phing] deleteNote failed', e);
      }
    }
    set((s) => {
      const remaining = s.notes.filter((n) => n.id !== id);
      const idx = s.notes.findIndex((n) => n.id === id);
      let nextId = s.selectedNoteId;
      if (s.selectedNoteId === id) {
        nextId = remaining[Math.min(idx, remaining.length - 1)]?.id ?? null;
      }
      return { notes: remaining, selectedNoteId: nextId };
    });
  },

  moveNote: async (noteId, pocketId) => {
    const note = get().notes.find((n) => n.id === noteId);
    if (!note) return;
    const prevPath = note.filePath;
    get().patchNote(noteId, { folder: pocketId });
    const vaultPath = getVaultPath();
    if (vaultPath && isTauri()) {
      const updated = get().notes.find((n) => n.id === noteId);
      if (updated) {
        try {
          const abs = vaultService.absoluteNotePath(vaultPath, updated);
          vaultWatcher.suppressNext(abs);
          const rel = await vaultService.atomicWriteNote(vaultPath, updated, prevPath);
          set((s) => ({
            notes: applyNotePatch(s.notes, noteId, { filePath: rel }),
          }));
        } catch (e) {
          console.error('[phing] moveNote failed', e);
        }
      }
    }
  },
}));
