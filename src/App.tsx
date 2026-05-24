import React, { useState, useEffect, useCallback, useRef } from 'react';
import './styles/theme.css';
import { useNoteStore } from './store/noteStore';
import { useVaultStore } from './store/vaultStore';
import { useMindMapStore } from './store/mindMapStore';
import { isTauri } from './lib/tauri';
import { encodeNote } from './lib/frontmatter';
import { vaultWatcher, contentHash } from './lib/fileWatcher';
import { findOrphanedTmpFiles, recoverOrphanedTmp } from './lib/recoveryJournal';
import Sidebar from './components/Sidebar';
import NoteList from './components/NoteList';
import Editor from './components/Editor';
import CommandPalette from './components/CommandPalette';
import MindMapBoard from './components/MindMapBoard';
import Onboarding from './components/Onboarding';
import ConflictDialogue, { type ConflictInfo } from './components/ConflictDialogue';
import DragGhost from './components/DragGhost';

// ── Onboarding guard ───────────────────────────────────────────────────────────
// Show onboarding if no vault has been configured AND the profile still uses the
// default placeholder name. Once the user completes (or skips) we persist a flag
// so the screen never resurfaces.
const ONBOARDING_KEY = 'phing_onboarding_done';

function needsOnboarding(): boolean {
  if (typeof localStorage === 'undefined') return false;
  if (localStorage.getItem(ONBOARDING_KEY)) return false;
  // Also skip if a vault is already configured (returning user on new build)
  if (localStorage.getItem('phing_vault_path')) return false;
  return true;
}

export type AppView = 'notes' | 'board';

const App = () => {
  const {
    isDark,
    panelsCollapsed,
    togglePanels,
    toggleZen,
    toggleAcademic,
    toggleBacklinks,
    createNote,
    loadVault,
    isLoadingVault,
    selectedNoteId,
    deleteNote,
    reloadNote,
    flushNote,
  } = useNoteStore();
  const vaultPath = useVaultStore((s) => s.vaultPath);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [view, setView] = useState<AppView>('notes');
  const [onboarding, setOnboarding] = useState(needsOnboarding);
  const [conflict, setConflict] = useState<ConflictInfo | null>(null);

  const completeOnboarding = () => {
    localStorage.setItem(ONBOARDING_KEY, '1');
    setOnboarding(false);
  };

  // ── Conflict resolution handlers ───────────────────────────────────────────
  const handleConflictReload = useCallback((noteId: string) => {
    void reloadNote(noteId);
    setConflict(null);
  }, [reloadNote]);

  const handleConflictKeepLocal = useCallback((noteId: string) => {
    // Force a flush of the local version to overwrite the on-disk change.
    void flushNote(noteId);
    setConflict(null);
  }, [flushNote]);

  const handleConflictDismiss = useCallback(() => {
    setConflict(null);
  }, []);

  const pendingDeleteRef = useRef<string | null>(null);

  const loadMindMaps = useMindMapStore((s) => s.loadFromVault);

  useEffect(() => {
    if (!isTauri() || !vaultPath) return;
    // Load notes and mind maps from vault in parallel
    void loadVault(vaultPath);
    void loadMindMaps(vaultPath);
  }, [vaultPath, loadVault, loadMindMaps]);

  // ── Orphan recovery on vault open ──────────────────────────────────────────
  // Scan for `.md.tmp` files left by a previous crash mid-atomic-write and
  // attempt to finalise or discard them before loading the vault.
  useEffect(() => {
    if (!isTauri() || !vaultPath) return;
    void (async () => {
      try {
        const orphans = await findOrphanedTmpFiles(vaultPath);
        for (const tmpPath of orphans) {
          await recoverOrphanedTmp(tmpPath);
        }
        if (orphans.length > 0) {
          console.info(`[phing] Recovered ${orphans.length} orphaned .tmp file(s).`);
        }
      } catch (e) {
        console.warn('[phing] Orphan recovery scan failed', e);
      }
    })();
  }, [vaultPath]);

  // ── External file watcher ──────────────────────────────────────────────────
  // Monitors the vault for changes made by external processes (other editors,
  // sync daemons, etc.) and surfaces a conflict dialogue when a discrepancy
  // between in-memory state and the on-disk file is detected.
  useEffect(() => {
    if (!isTauri() || !vaultPath) return;

    void vaultWatcher.start(vaultPath, async (event) => {
      // Deletions are handled on next vault load — ignore here.
      if (event.kind === 'remove') return;

      const { notes } = useNoteStore.getState();

      // Find the in-memory note that corresponds to the changed file.
      const note = notes.find((n) => {
        if (!n.filePath) return false;
        const abs = [vaultPath, n.filePath].join('/').replace(/\/+/g, '/');
        return abs === event.absPath;
      });
      if (!note) return;

      // Compare hashes to confirm the disk version genuinely differs from
      // what Phing has in memory.  Identical hashes mean we wrote the file
      // ourselves (the suppress window just expired) — no action needed.
      try {
        const { readTextFile } = await import('@tauri-apps/plugin-fs');
        const diskContent = await readTextFile(event.absPath);
        const diskHash = contentHash(diskContent);
        const memHash = contentHash(encodeNote(note));

        if (diskHash !== memHash) {
          setConflict({
            noteId:    note.id,
            noteTitle: note.title,
            absPath:   event.absPath,
          });
        }
      } catch {
        // If the file is unreadable, silently ignore.
      }
    });

    return () => { void vaultWatcher.stop(); };
  }, [vaultPath]);

  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      const meta = e.metaKey || e.ctrlKey;
      if (!meta) return;

      if (e.key === 'k') {
        e.preventDefault();
        setPaletteOpen((v) => !v);
        return;
      }
      if (e.key === 'm' && e.shiftKey) {
        e.preventDefault();
        setView((v) => (v === 'board' ? 'notes' : 'board'));
        return;
      }
      if (view === 'board') return; // board handles its own shortcuts

      if (e.key === 'n' && !e.shiftKey) {
        e.preventDefault();
        void createNote();
        return;
      }
      if (e.key === 'z' && e.shiftKey) {
        e.preventDefault();
        toggleZen();
        return;
      }
      if (e.key === 'a' && e.shiftKey) {
        e.preventDefault();
        toggleAcademic();
        return;
      }
      if (e.key === 's' && e.shiftKey) {
        e.preventDefault();
        togglePanels();
        return;
      }
      if (e.key === 'b' && e.shiftKey) {
        e.preventDefault();
        toggleBacklinks();
        return;
      }
      if (e.key === 'Backspace' && selectedNoteId) {
        e.preventDefault();
        if (pendingDeleteRef.current === selectedNoteId) {
          void deleteNote(selectedNoteId);
          pendingDeleteRef.current = null;
        } else {
          pendingDeleteRef.current = selectedNoteId;
          setTimeout(() => {
            if (pendingDeleteRef.current === selectedNoteId) {
              pendingDeleteRef.current = null;
            }
          }, 3000);
        }
      }
    },
    [view, createNote, toggleZen, toggleAcademic, togglePanels, toggleBacklinks, selectedNoteId, deleteNote],
  );

  useEffect(() => {
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handleKeyDown]);

  // ── First-time onboarding ──────────────────────────────────────────────────
  if (onboarding) {
    return (
      <div className={isDark ? 'dark' : ''}>
        <Onboarding onComplete={completeOnboarding} />
      </div>
    );
  }

  if (isLoadingVault) {
    return (
      <div
        className={isDark ? 'dark' : ''}
        style={{
          display: 'flex',
          height: '100vh',
          alignItems: 'center',
          justifyContent: 'center',
          color: 'var(--muted)',
          fontFamily: 'var(--font-serif)',
          fontStyle: 'italic',
        }}
      >
        Opening vault…
      </div>
    );
  }

  return (
    <div
      className={isDark ? 'dark' : ''}
      style={{
        display: 'flex',
        height: '100vh',
        width: '100vw',
        overflow: 'hidden',
        background: 'var(--bg)',
      }}
    >
      {/* Sidebar — always visible */}
      <div
        style={{
          width: panelsCollapsed ? 0 : 200,
          minWidth: panelsCollapsed ? 0 : 200,
          overflow: 'hidden',
          flexShrink: 0,
          minHeight: 0,
          transition: 'width 0.35s cubic-bezier(0.4,0,0.2,1), min-width 0.35s cubic-bezier(0.4,0,0.2,1)',
        }}
      >
        <Sidebar view={view} onViewChange={setView} />
      </div>

      {/* Notes view */}
      {view === 'notes' && (
        <>
          <div
            style={{
              width: panelsCollapsed ? 0 : 260,
              minWidth: panelsCollapsed ? 0 : 260,
              overflow: 'hidden',
              flexShrink: 0,
              minHeight: 0,
              borderRight: panelsCollapsed ? 'none' : '0.5px solid var(--border)',
              transition: 'width 0.35s cubic-bezier(0.4,0,0.2,1), min-width 0.35s cubic-bezier(0.4,0,0.2,1)',
            }}
          >
            <NoteList />
          </div>
          <div
            style={{ flex: 1, overflow: 'hidden', minWidth: 0, minHeight: 0, display: 'flex', flexDirection: 'column' }}
          >
            <Editor onOpenPalette={() => setPaletteOpen(true)} />
          </div>
        </>
      )}

      {/* Board view — full width after sidebar */}
      {view === 'board' && (
        <div style={{ flex: 1, overflow: 'hidden', minWidth: 0, minHeight: 0 }}>
          <MindMapBoard />
        </div>
      )}

      <CommandPalette open={paletteOpen} onClose={() => setPaletteOpen(false)} />

      <ConflictDialogue
        conflict={conflict}
        onReload={handleConflictReload}
        onKeepLocal={handleConflictKeepLocal}
        onDismiss={handleConflictDismiss}
      />

      {/* Drag ghost — portal-rendered above all panels, pointer-events: none */}
      <DragGhost />
    </div>
  );
};

export default App;
