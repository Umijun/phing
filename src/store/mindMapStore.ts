/**
 * mindMapStore.ts
 * Zustand store for the Mind Map feature.
 *
 * Mind maps are now first-class documents (MindMapDoc), not pocket-scoped
 * boards.  Each map has its own file, title, and folder (pocket) assignment —
 * exactly like Notes.
 *
 * Every tree mutation schedules a debounced write to the vault via
 * mindMapService.  The store also exposes CRUD operations for managing the
 * list of maps.
 *
 * British English spelling maintained throughout.
 */

import { create } from 'zustand';
import {
  type MindMapNode,
  genMindId,
  findNode,
  findParent,
  treeAddChild,
  treeAddSiblingAfter,
  treeUpdateLabel,
  treeUpdateNote,
  treeDelete,
} from '../lib/mindmap';
import { useVaultStore } from './vaultStore';
import { isTauri } from '../lib/tauri';
import {
  type MindMapDoc,
  saveMindMapDoc,
  loadAllMindMapDocs,
  deleteMindMapDoc,
} from '../services/mindMapService';

// Re-export so consumers only need to import from the store
export type { MindMapDoc };

// ─── Helpers ──────────────────────────────────────────────────────────────────

const mkNode = (label = 'New node'): MindMapNode => ({
  id: genMindId(),
  label,
  children: [],
});

const makeRoot = (label = 'Mind Map'): MindMapNode => ({
  id: genMindId(),
  label,
  children: [],
});

function makeDoc(title = 'Mind Map', folder = ''): MindMapDoc {
  const now = new Date().toISOString();
  return {
    id:        crypto.randomUUID(),
    title,
    folder,
    tree:      makeRoot(title),
    createdAt: now,
    updatedAt: now,
  };
}

// ── Debounced auto-save ────────────────────────────────────────────────────────

const saveTimers = new Map<string, ReturnType<typeof setTimeout>>();
const FLUSH_DELAY_MS = 900;

function getVaultPath(): string | null {
  return useVaultStore.getState().vaultPath;
}

/** Schedules a debounced write of the given MindMapDoc to disk. */
function scheduleSave(doc: MindMapDoc): void {
  const vaultPath = getVaultPath();
  if (!vaultPath || !isTauri()) return;

  const existing = saveTimers.get(doc.id);
  if (existing) clearTimeout(existing);

  saveTimers.set(
    doc.id,
    setTimeout(() => {
      saveTimers.delete(doc.id);
      void saveMindMapDoc(vaultPath, doc).catch((e) =>
        console.error('[phing] mind map auto-save failed', e),
      );
    }, FLUSH_DELAY_MS),
  );
}

// ─── Store interface ──────────────────────────────────────────────────────────

export interface MindMapStore {
  /** All mind map documents (loaded from vault). */
  mindMaps: MindMapDoc[];
  /** Id of the currently-open mind map, or null if none is selected. */
  selectedMindMapId: string | null;

  selectedId:  string | null;
  editingId:   string | null;
  notePopupId: string | null;

  // ── Active-tree accessor ─────────────────────────────────────────────────
  activeTree: () => MindMapNode;

  // ── Vault persistence ────────────────────────────────────────────────────
  loadFromVault:          (vaultPath: string)    => Promise<void>;
  /** Called when a pocket is deleted — moves its maps to the root folder. */
  moveMindMapsFromPocket: (pocketId: string)     => void;

  // ── Document management ──────────────────────────────────────────────────
  createMindMap:  (folder?: string, title?: string) => Promise<MindMapDoc>;
  deleteMindMap:  (id: string)                       => Promise<void>;
  renameMindMap:  (id: string, title: string)        => void;
  moveMindMap:    (id: string, pocketId: string)     => void;
  selectMindMap:  (id: string | null)                => void;

  // ── Selection / editing ──────────────────────────────────────────────────
  setSelected:  (id: string | null) => void;
  setEditing:   (id: string | null) => void;
  startEditing: (id: string)        => void;
  commitEdit:   (id: string, label: string) => void;

  // ── Note popup ───────────────────────────────────────────────────────────
  openNote:   (nodeId: string) => void;
  closeNote:  ()               => void;
  updateNote: (nodeId: string, content: string) => void;

  // ── Tree mutations ───────────────────────────────────────────────────────
  addChild:       (parentId: string) => string;
  addSibling:     (nodeId: string)   => string;
  deleteSelected: ()                 => void;
  resetBoard:     (label?: string)   => void;

  // ── Navigation helpers ───────────────────────────────────────────────────
  parentId:      (nodeId: string) => string | null;
  firstChildId:  (nodeId: string) => string | null;
  prevSiblingId: (nodeId: string) => string | null;
  nextSiblingId: (nodeId: string) => string | null;
}

// ─── Initial placeholder doc ──────────────────────────────────────────────────
// Shown in the UI before any vault is opened, so the Board view is never empty.

const initialDoc = makeDoc('Mind Map', '');

// ─── Helpers for tree mutations ───────────────────────────────────────────────

function patchSelectedTree(
  mindMaps: MindMapDoc[],
  selectedMindMapId: string | null,
  transform: (tree: MindMapNode) => MindMapNode,
): MindMapDoc[] {
  if (!selectedMindMapId) return mindMaps;
  return mindMaps.map((doc) =>
    doc.id === selectedMindMapId
      ? { ...doc, tree: transform(doc.tree), updatedAt: new Date().toISOString() }
      : doc,
  );
}

// ─── Store ────────────────────────────────────────────────────────────────────

export const useMindMapStore = create<MindMapStore>((set, get) => ({
  mindMaps:          [initialDoc],
  selectedMindMapId: initialDoc.id,
  selectedId:        initialDoc.tree.id,
  editingId:         null,
  notePopupId:       null,

  // ── Active-tree accessor ──────────────────────────────────────────────────

  activeTree: () => {
    const { mindMaps, selectedMindMapId } = get();
    return mindMaps.find((d) => d.id === selectedMindMapId)?.tree ?? makeRoot();
  },

  // ── Vault persistence ─────────────────────────────────────────────────────

  loadFromVault: async (vaultPath) => {
    try {
      const loaded = await loadAllMindMapDocs(vaultPath);
      if (!loaded.length) return; // vault is empty — keep placeholder

      set((s) => {
        // Keep docs that were created in-session but not yet saved (new maps
        // whose ids don't appear in the loaded list). Prefer disk versions.
        const diskIds = new Set(loaded.map((d) => d.id));
        const inMemoryOnly = s.mindMaps.filter(
          (d) => !diskIds.has(d.id) && d.id !== initialDoc.id,
        );
        const merged = [...loaded, ...inMemoryOnly];

        return {
          mindMaps:          merged,
          selectedMindMapId: merged[0]?.id ?? null,
          selectedId:        merged[0]?.tree.id ?? null,
        };
      });
    } catch (e) {
      console.error('[phing] loadFromVault (mind maps) failed', e);
    }
  },

  moveMindMapsFromPocket: (pocketId) => {
    set((s) => ({
      mindMaps: s.mindMaps.map((doc) =>
        doc.folder === pocketId ? { ...doc, folder: '' } : doc,
      ),
    }));
  },

  // ── Document management ───────────────────────────────────────────────────

  createMindMap: async (folder = '', title = 'Mind Map') => {
    const doc = makeDoc(title, folder);
    set((s) => ({
      mindMaps:          [doc, ...s.mindMaps],
      selectedMindMapId: doc.id,
      selectedId:        doc.tree.id,
      editingId:         null,
      notePopupId:       null,
    }));
    const vaultPath = getVaultPath();
    if (vaultPath && isTauri()) {
      await saveMindMapDoc(vaultPath, doc).catch((e) =>
        console.error('[phing] createMindMap save failed', e),
      );
    }
    return doc;
  },

  deleteMindMap: async (id) => {
    const vaultPath = getVaultPath();
    if (vaultPath && isTauri()) {
      await deleteMindMapDoc(vaultPath, id).catch((e) =>
        console.error('[phing] deleteMindMap failed', e),
      );
    }
    set((s) => {
      const remaining = s.mindMaps.filter((d) => d.id !== id);

      // If other maps remain, select the first one (or keep the current
      // selection if it wasn't the deleted map).
      if (remaining.length > 0) {
        const next =
          s.selectedMindMapId === id
            ? remaining[0].id
            : (s.selectedMindMapId ?? remaining[0].id);
        return {
          mindMaps:          remaining,
          selectedMindMapId: next,
          selectedId:        remaining.find((d) => d.id === next)?.tree.id ?? null,
        };
      }

      // Last map deleted — create a fresh placeholder and immediately
      // select it.  Without this, selectedMindMapId would be null and
      // activeTree() would call makeRoot() on every selector invocation,
      // creating a new object each time and triggering an infinite
      // re-render loop that destroys the component tree.
      const fresh = makeDoc();
      return {
        mindMaps:          [fresh],
        selectedMindMapId: fresh.id,
        selectedId:        fresh.tree.id,
      };
    });
  },

  renameMindMap: (id, title) => {
    set((s) => ({
      mindMaps: s.mindMaps.map((doc) =>
        doc.id === id
          ? { ...doc, title: title.trim() || 'Mind Map', updatedAt: new Date().toISOString() }
          : doc,
      ),
    }));
    const doc = get().mindMaps.find((d) => d.id === id);
    if (doc) scheduleSave(doc);
  },

  moveMindMap: (id, pocketId) => {
    set((s) => ({
      mindMaps: s.mindMaps.map((doc) =>
        doc.id === id
          ? { ...doc, folder: pocketId, updatedAt: new Date().toISOString() }
          : doc,
      ),
    }));
    const doc = get().mindMaps.find((d) => d.id === id);
    if (doc) scheduleSave(doc);
  },

  selectMindMap: (id) => {
    set((s) => {
      const doc = s.mindMaps.find((d) => d.id === id);
      return {
        selectedMindMapId: id,
        selectedId:        doc?.tree.id ?? null,
        editingId:         null,
        notePopupId:       null,
      };
    });
  },

  // ── Selection / editing ───────────────────────────────────────────────────

  setSelected:  (id) => set({ selectedId: id }),
  setEditing:   (id) => set({ editingId: id }),
  startEditing: (id) => set({ selectedId: id, editingId: id }),

  commitEdit: (id, label) => {
    const trimmed              = label.trim() || 'New node';
    const { selectedMindMapId } = get();

    set((s) => ({
      mindMaps: patchSelectedTree(s.mindMaps, selectedMindMapId, (tree) =>
        treeUpdateLabel(tree, id, trimmed),
      ),
      editingId: null,
    }));

    const doc = get().mindMaps.find((d) => d.id === selectedMindMapId);
    if (doc) scheduleSave(doc);
  },

  // ── Note popup ────────────────────────────────────────────────────────────

  openNote:  (nodeId) => set({ notePopupId: nodeId }),
  closeNote: ()       => set({ notePopupId: null }),

  updateNote: (nodeId, content) => {
    const { selectedMindMapId } = get();
    set((s) => ({
      mindMaps: patchSelectedTree(s.mindMaps, selectedMindMapId, (tree) =>
        treeUpdateNote(tree, nodeId, content),
      ),
    }));
    const doc = get().mindMaps.find((d) => d.id === selectedMindMapId);
    if (doc) scheduleSave(doc);
  },

  // ── Mutations ─────────────────────────────────────────────────────────────

  addChild: (parentId) => {
    const node                 = mkNode();
    const { selectedMindMapId } = get();

    set((s) => ({
      mindMaps: patchSelectedTree(s.mindMaps, selectedMindMapId, (tree) =>
        treeAddChild(tree, parentId, node),
      ),
      selectedId: node.id,
      editingId:  node.id,
    }));

    const doc = get().mindMaps.find((d) => d.id === selectedMindMapId);
    if (doc) scheduleSave(doc);
    return node.id;
  },

  addSibling: (nodeId) => {
    const { selectedMindMapId } = get();
    const tree = get().activeTree();
    const parent = findParent(tree, nodeId);
    if (!parent) return get().addChild(nodeId); // root → add child instead

    const node = mkNode();

    set((s) => ({
      mindMaps: patchSelectedTree(s.mindMaps, selectedMindMapId, (t) =>
        treeAddSiblingAfter(t, nodeId, node),
      ),
      selectedId: node.id,
      editingId:  node.id,
    }));

    const doc = get().mindMaps.find((d) => d.id === selectedMindMapId);
    if (doc) scheduleSave(doc);
    return node.id;
  },

  deleteSelected: () => {
    const { selectedId, selectedMindMapId } = get();
    const tree = get().activeTree();
    if (!selectedId || selectedId === tree.id) return;

    const parent = findParent(tree, selectedId);

    set((s) => ({
      mindMaps: patchSelectedTree(s.mindMaps, selectedMindMapId, (t) =>
        treeDelete(t, selectedId),
      ),
      selectedId: parent?.id ?? tree.id,
      editingId:  null,
    }));

    const doc = get().mindMaps.find((d) => d.id === selectedMindMapId);
    if (doc) scheduleSave(doc);
  },

  resetBoard: (label) => {
    const { selectedMindMapId } = get();
    const root = makeRoot(label ?? 'Mind Map');

    set((s) => ({
      mindMaps: s.mindMaps.map((doc) =>
        doc.id === selectedMindMapId
          ? { ...doc, tree: root, updatedAt: new Date().toISOString() }
          : doc,
      ),
      selectedId: root.id,
      editingId:  null,
    }));

    const doc = get().mindMaps.find((d) => d.id === selectedMindMapId);
    if (doc) scheduleSave(doc);
  },

  // ── Navigation ────────────────────────────────────────────────────────────

  parentId: (nodeId) => {
    const tree = get().activeTree();
    return findParent(tree, nodeId)?.id ?? null;
  },

  firstChildId: (nodeId) => {
    const tree = get().activeTree();
    return findNode(tree, nodeId)?.children[0]?.id ?? null;
  },

  prevSiblingId: (nodeId) => {
    const tree   = get().activeTree();
    const parent = findParent(tree, nodeId);
    if (!parent) return null;
    const idx = parent.children.findIndex((c) => c.id === nodeId);
    return idx > 0 ? parent.children[idx - 1].id : null;
  },

  nextSiblingId: (nodeId) => {
    const tree   = get().activeTree();
    const parent = findParent(tree, nodeId);
    if (!parent) return null;
    const idx = parent.children.findIndex((c) => c.id === nodeId);
    return idx < parent.children.length - 1 ? parent.children[idx + 1].id : null;
  },
}));
