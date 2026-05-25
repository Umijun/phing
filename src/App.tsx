import React, { useState, useEffect, useCallback, useRef } from 'react';
import './styles/theme.css';
import { useNoteStore } from './store/noteStore';
import { useNoteStore as noteStoreApi } from './store/noteStore';
import { useVaultStore } from './store/vaultStore';
import { useMindMapStore } from './store/mindMapStore';
import { useMindMapStore as mindMapStoreApi } from './store/mindMapStore';
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
import QuitDialogue from './components/QuitDialogue';
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
    isSidebarOpen,
    panelsCollapsed,
    toggleSidebar,
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

  // ── Flush helpers ─────────────────────────────────────────────────────────
  // Defined at component level so both the close-event handler and the Save &
  // Quit dialogue action can share a single stable reference.
  const flushAll = useCallback(
    () => Promise.allSettled([
      noteStoreApi.getState().flushAllPending(),
      mindMapStoreApi.getState().flushAllPending(),
    ]),
    [],
  );

  // ── Quit dialogue ──────────────────────────────────────────────────────────
  // Shown when onCloseRequested fires with pending writes so the user can
  // choose between saving, discarding, or staying.

  const [quitPending, setQuitPending] = useState(false);

  const handleSaveAndQuit = useCallback(async () => {
    setQuitPending(false);
    if (!isTauri()) return;
    const { invoke } = await import('@tauri-apps/api/core');
    // Safety bail: if flushAll hangs, exit after 5 s anyway so the user
    // is never left with an unresponsive window.
    const bail = setTimeout(() => { void invoke('confirm_quit').catch(() => undefined); }, 5_000);
    await flushAll();
    clearTimeout(bail);
    await invoke('confirm_quit').catch(() => undefined);
  }, [flushAll]);

  const handleDiscard = useCallback(async () => {
    setQuitPending(false);
    if (!isTauri()) return;
    const { invoke } = await import('@tauri-apps/api/core');
    await invoke('confirm_quit').catch(() => undefined);
  }, []);

  const handleCancelQuit = useCallback(() => setQuitPending(false), []);

  // ── Flush pending writes on quit ───────────────────────────────────────────
  // Primary: onCloseRequested intercepts the × button (and Cmd+Q on macOS
  // when the OS closes windows before terminating).  event.preventDefault()
  // holds the window open; the QuitDialogue then lets the user choose between
  // Save & Quit, Discard, or Cancel.  We always show the dialogue — skipping
  // it when hasPendingWrites() is false causes a race where the 100 ms debounce
  // has already cleared by the time the user reaches for the × button.
  //
  // Secondary: pagehide / visibilitychange are fire-and-forget backups for
  // force-quit or any path that bypasses the close event.
  useEffect(() => {
    if (!isTauri()) return;

    let unlistenClose: (() => void) | undefined;

    void (async () => {
      try {
        const { getCurrentWindow } = await import('@tauri-apps/api/window');
        const win = getCurrentWindow();

        // Always intercept the close request and hand control to the quit
        // dialogue.  The dialogue's "Save & Quit" / "Discard" buttons call
        // win.destroy() themselves, so we never need to close here directly.
        // Removing the hasPendingWrites() gate prevents the race where the
        // 100 ms debounce has already completed by the time the user presses ×.
        unlistenClose = await win.onCloseRequested((event) => {
          event.preventDefault();
          setQuitPending(true);
        });
      } catch (e) {
        console.error('[phing] Failed to register onCloseRequested:', e);
      }
    })();

    const flushFire = () => { void flushAll(); };
    const onHidden   = () => { if (document.visibilityState === 'hidden') flushFire(); };
    window.addEventListener('pagehide', flushFire);
    document.addEventListener('visibilitychange', onHidden);

    return () => {
      unlistenClose?.();
      window.removeEventListener('pagehide', flushFire);
      document.removeEventListener('visibilitychange', onHidden);
    };
  }, [flushAll]);

  // ── macOS Cmd+Q interception ───────────────────────────────────────────────
  // Rust intercepts RunEvent::ExitRequested (the app-level quit signal that
  // Cmd+Q, Dock → Quit, and NSApp terminate all produce on macOS), cancels
  // the OS exit, and emits `phing://close-requested` so the same QuitDialogue
  // that handles the × button is shown here too.
  useEffect(() => {
    if (!isTauri()) return;

    let unlisten: (() => void) | undefined;

    void (async () => {
      try {
        const { listen } = await import('@tauri-apps/api/event');
        unlisten = await listen('phing://close-requested', () => {
          setQuitPending(true);
        });
      } catch (e) {
        console.error('[phing] Failed to register phing://close-requested listener:', e);
      }
    })();

    return () => { unlisten?.(); };
  }, []);

  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      const meta = e.metaKey || e.ctrlKey;
      if (!meta) return;
      const key = e.key.toLowerCase();

      if (key === 'k') {
        e.preventDefault();
        setPaletteOpen((v) => !v);
        return;
      }
      if (key === 'm' && e.shiftKey) {
        e.preventDefault();
        setView((v) => (v === 'board' ? 'notes' : 'board'));
        return;
      }
      if (key === 's' && e.shiftKey) {
        e.preventDefault();
        toggleSidebar();
        return;
      }
      if (view === 'board') return; // board handles its own shortcuts

      if (key === 'n' && !e.shiftKey) {
        e.preventDefault();
        void createNote();
        return;
      }
      if (key === 'z' && e.shiftKey) {
        e.preventDefault();
        toggleZen();
        return;
      }
      if (key === 'a' && e.shiftKey) {
        e.preventDefault();
        toggleAcademic();
        return;
      }
      if (key === 'b' && e.shiftKey) {
        e.preventDefault();
        toggleBacklinks();
        return;
      }
      if (key === 'backspace' && selectedNoteId) {
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
    [view, createNote, toggleZen, toggleAcademic, toggleSidebar, toggleBacklinks, selectedNoteId, deleteNote],
  );

  useEffect(() => {
    window.addEventListener('keydown', handleKeyDown, { capture: true });
    return () => window.removeEventListener('keydown', handleKeyDown, { capture: true });
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
      {/* Main navigation sidebar */}
      <div
        className={`app-sidebar-shell ${isSidebarOpen ? 'app-sidebar-shell--open' : 'app-sidebar-shell--closed'}`}
      >
        <div className="app-sidebar-shell__inner">
          <Sidebar view={view} onViewChange={setView} />
        </div>
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

      <QuitDialogue
        open={quitPending}
        onSaveAndQuit={handleSaveAndQuit}
        onDiscard={handleDiscard}
        onCancel={handleCancelQuit}
      />

      {/* Drag ghost — portal-rendered above all panels, pointer-events: none */}
      <DragGhost />
    </div>
  );
};

export default App;
