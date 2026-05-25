import React, { memo, useEffect, useMemo, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useNoteStore, Note, Pocket } from '../store/noteStore';
import { stripMarkdown } from '../lib/stripMarkdown';
import { formatNoteDate } from '../lib/formatTime';
import { ghostX, ghostY, useNoteDrag } from '../lib/noteDrag';

const TAG_PALETTE = [
  { bg: '#F6E3CB', fg: '#9A6B3A' },
  { bg: '#F1DFDB', fg: '#9A5F55' },
  { bg: '#DDE6DD', fg: '#5E7860' },
  { bg: '#DFE7EE', fg: '#5B7388' },
  { bg: '#E8E0EA', fg: '#7A6585' },
  { bg: '#ECE5D8', fg: '#8A7651' },
];

const NoteList = () => {
  const notes          = useNoteStore((s) => s.notes);
  const pockets        = useNoteStore((s) => s.pockets);
  const activePocket   = useNoteStore((s) => s.activePocket);
  const selectedNoteId = useNoteStore((s) => s.selectedNoteId);
  const isDark         = useNoteStore((s) => s.isDark);
  const createNote     = useNoteStore((s) => s.createNote);

  const filtered = useMemo(
    () =>
      notes.filter((n: Note) =>
        // '' = All Notes (no filter)
        // exact match = notes directly in this folder
        // prefix match = notes in any sub-folder of this folder
        activePocket === '' ||
        n.folder === activePocket ||
        n.folder.startsWith(activePocket + '/'),
      ),
    [notes, activePocket],
  );
  const pocket = useMemo(
    () => pockets.find((p: Pocket) => p.id === activePocket),
    [pockets, activePocket],
  );

  return (
    <div style={{ width: '100%', height: '100%', display: 'flex', flexDirection: 'column', minHeight: 0 }}>
      {/* Header */}
      <div style={{ padding: '18px 18px 10px', flexShrink: 0 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
          <div>
            <div style={{ fontSize: 17, fontWeight: 700, color: 'var(--strong)', marginBottom: 2 }}>
              {activePocket === '' ? 'All Notes' : (pocket?.name ?? 'Notes')}
            </div>
            <div style={{ fontSize: 10, color: 'var(--muted)' }}>
              {filtered.length} notes · sorted by warmth
            </div>
          </div>
          <button
            onClick={() => void createNote(activePocket)}
            style={{
              fontSize: 9,
              padding: '4px 10px',
              borderRadius: 8,
              fontWeight: 700,
              border: 'none',
              color: 'var(--primary)',
              background: 'var(--primary-s)',
              cursor: 'pointer',
              letterSpacing: '0.5px',
              fontFamily: 'var(--font-ui)',
            }}
          >
            + NEW
          </button>
        </div>
      </div>

      {/* List */}
      <div
        style={{
          flex: 1,
          overflowY: 'auto',
          minHeight: 0,
          padding: '4px 10px 24px',
          display: 'flex',
          flexDirection: 'column',
          gap: 8,
        }}
      >
        {filtered.length === 0 && (
          <div style={{ padding: 32, textAlign: 'center', color: 'var(--muted)', fontSize: 13 }}>
            Quiet in here...
          </div>
        )}
        {/* AnimatePresence with initial=false so cards only animate when removed, not on mount */}
        <AnimatePresence initial={false}>
          {filtered.map((note: Note) => (
            <NoteCard
              key={note.id}
              note={note}
              active={note.id === selectedNoteId}
              isDark={isDark}
            />
          ))}
        </AnimatePresence>
      </div>
    </div>
  );
};

// ── NoteCard ───────────────────────────────────────────────────────────────────

// Defined at module scope so the object reference is stable across renders.
// Inline variant objects would be recreated every render and cause framer-motion
// to re-evaluate transitions unnecessarily.
const NOTE_CARD_VARIANTS = {
  idle:     { scale: 1,    opacity: 1,    transition: { type: 'spring' as const, stiffness: 500, damping: 32 } },
  dragging: { scale: 0.96, opacity: 0.45, transition: { type: 'spring' as const, stiffness: 500, damping: 32 } },
};

/** Memoised — only re-renders when note data, active state, or dark mode changes. */
const NoteCard = memo(({
  note,
  active,
  isDark,
}: {
  note:   Note;
  active: boolean;
  isDark: boolean;
}) => {
  const selectNote    = useNoteStore((s) => s.selectNote);
  const deleteNote    = useNoteStore((s) => s.deleteNote);
  const moveNote      = useNoteStore((s) => s.moveNote);
  const setActivePocket = useNoteStore((s) => s.setActivePocket);

  const { setDragging, setHoveredPocket } = useNoteDrag.getState();

  const [confirmDelete, setConfirmDelete] = useState(false);
  const [isDragging,    setIsDragging]    = useState(false);
  const confirmDeleteTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Cancel the confirm-delete auto-reset timer on unmount so it can't call
  // setConfirmDelete on an already-unmounted component (e.g. when the note
  // is deleted by deleteTreeFolder while the double-click guard is pending).
  useEffect(() => () => {
    if (confirmDeleteTimer.current !== null) clearTimeout(confirmDeleteTimer.current);
  }, []);

  // Guard against rapid successive pointerdowns registering duplicate window
  // listeners.  Cleared in the pointerup / pointercancel cleanup path.
  const isListeningRef = useRef(false);

  // Holds a reference to the active drag's cleanup function so that if this
  // NoteCard unmounts while a drag is in progress (e.g. the user switches to
  // the Board view mid-drag), the three window listeners are removed and the
  // shared drag state in useNoteDrag is reset.  Without this, the listeners
  // would accumulate on window for the lifetime of the page and the drag ghost
  // / pocket-highlight would remain visible indefinitely.
  const dragCleanupRef = useRef<(() => void) | null>(null);

  useEffect(() => () => {
    dragCleanupRef.current?.();
    // Reset shared Zustand drag state unconditionally — covers the case where
    // the cleanup fires while a drag is active (setDragging is a store action,
    // not a React setState, so calling it after unmount is safe).
    const { setDragging, setHoveredPocket } = useNoteDrag.getState();
    setDragging(null);
    setHoveredPocket(null);
  }, []);

  const snip = useMemo(() => stripMarkdown(note.content), [note.content]);
  const ago  = useMemo(() => formatNoteDate(note.updatedAt),  [note.updatedAt]);

  // ── Pointer-based drag ─────────────────────────────────────────────────────
  //
  // We use pointer events rather than HTML5 drag-and-drop because:
  //   1. HTML5 drag + framer-motion have a React type conflict on onDragStart.
  //   2. Pointer events work reliably across Tauri WebView / WebKit.
  //   3. We want full control over the custom ghost appearance.
  //
  // Strategy:
  //   • onPointerDown  — start listening; initialise ghost position.
  //   • pointermove    — once the threshold is crossed, activate the drag:
  //                      update ghost position and check which pocket element
  //                      (identified by data-pocket-id) is under the cursor.
  //   • pointerup      — commit the move if over a valid target; clean up.

  const handlePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    // Ignore clicks on the delete button.
    if ((e.target as Element).closest('.note-card-delete')) return;
    // Only primary pointer (left-click / single touch).
    if (e.button !== 0 && e.pointerType === 'mouse') return;
    // Guard: skip if window listeners are already attached (rapid double-tap).
    if (isListeningRef.current) return;

    // Suppress the browser's default pointerdown behaviour — most importantly
    // the text-selection machinery that fires before any movement threshold is
    // crossed.  Without this, holding the mouse down briefly highlights text
    // even when the user only intends to click or drag the card.
    e.preventDefault();

    isListeningRef.current = true;

    const startX = e.clientX;
    const startY = e.clientY;
    let dragging = false; // whether the drag threshold has been crossed

    // Seed ghost at pointer position so it appears right under the finger.
    ghostX.set(startX);
    ghostY.set(startY);

    const onMove = (ev: PointerEvent) => {
      ghostX.set(ev.clientX);
      ghostY.set(ev.clientY);

      if (!dragging) {
        const dist = Math.hypot(ev.clientX - startX, ev.clientY - startY);
        if (dist < 8) return; // movement threshold — prevents accidental drags
        // Threshold crossed — activate drag.
        dragging = true;
        setIsDragging(true);
        setDragging({ kind: 'note', noteId: note.id, title: note.title, emoji: note.emoji, folder: note.folder });
      }

      // Identify the pocket element under the cursor.
      // The ghost has pointer-events: none so it is invisible to elementsFromPoint.
      const elements = document.elementsFromPoint(ev.clientX, ev.clientY);
      const pocketEl = elements.find((el) => el.hasAttribute('data-pocket-id'));
      const pocketId = pocketEl ? pocketEl.getAttribute('data-pocket-id') : null;
      setHoveredPocket(pocketId);
    };

    const cleanup = () => {
      window.removeEventListener('pointermove',   onMove);
      window.removeEventListener('pointerup',     onUp);
      window.removeEventListener('pointercancel', onCancel);
      isListeningRef.current  = false;
      dragCleanupRef.current  = null; // prevent double-call from the unmount effect
    };

    // Store the cleanup fn so the unmount useEffect can call it if the
    // component is removed before pointerup / pointercancel fires.
    dragCleanupRef.current = cleanup;

    const onUp = () => {
      cleanup();

      if (dragging) {
        setIsDragging(false);

        // Read live state to avoid stale closures.
        const { hoveredPocketId } = useNoteDrag.getState();

        if (hoveredPocketId !== null && note.folder !== hoveredPocketId) {
          // Drop on a valid target — move the note and navigate there.
          void moveNote(note.id, hoveredPocketId);
          setActivePocket(hoveredPocketId);
        }

        // Always reset drag state after release.
        setDragging(null);
        setHoveredPocket(null);
      } else {
        // Threshold never crossed → treat as a tap / click.
        void selectNote(note.id);
      }
    };

    // pointercancel fires when the browser takes over (e.g. scroll gesture).
    // It must clean up drag state but MUST NOT trigger note selection.
    const onCancel = () => {
      cleanup();

      if (dragging) {
        setIsDragging(false);
        setDragging(null);
        setHoveredPocket(null);
      }
      // No selectNote call — the interaction was cancelled, not completed.
    };

    window.addEventListener('pointermove',   onMove);
    window.addEventListener('pointerup',     onUp);
    window.addEventListener('pointercancel', onCancel);
  };

  const handleDelete = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (confirmDelete) {
      if (confirmDeleteTimer.current !== null) {
        clearTimeout(confirmDeleteTimer.current);
        confirmDeleteTimer.current = null;
      }
      void deleteNote(note.id);
      setConfirmDelete(false);
    } else {
      setConfirmDelete(true);
      confirmDeleteTimer.current = setTimeout(() => {
        confirmDeleteTimer.current = null;
        setConfirmDelete(false);
      }, 3000);
    }
  };

  return (
    <motion.div
      // ── Exit: card "sinks" toward the sidebar then the slot collapses ─────
      // Phase 1 (0 → 200 ms): fade + shrink + slide left into the pocket.
      // Phase 2 (100 → 340 ms): height/padding collapse to close the gap.
      // The 100 ms overlap makes the height implosion feel responsive while
      // the opacity/scale still have time to finish gracefully.
      exit={{
        opacity:       0,
        scale:         0.88,
        x:             -20,
        height:        0,
        marginBottom:  0,
        paddingTop:    0,
        paddingBottom: 0,
        transition: {
          opacity:       { duration: 0.20, ease: 'easeOut'       as const },
          scale:         { duration: 0.20, ease: 'easeOut'       as const },
          x:             { duration: 0.20, ease: 'easeOut'       as const },
          height:        { duration: 0.24, delay: 0.10, ease: [0.4, 0, 0.2, 1] },
          marginBottom:  { duration: 0.24, delay: 0.10 },
          paddingTop:    { duration: 0.24, delay: 0.10 },
          paddingBottom: { duration: 0.24, delay: 0.10 },
        },
      }}
      // ── Drag-ghost source: card fades + shrinks so the ghost feels "lifted" ─
      variants={NOTE_CARD_VARIANTS}
      animate={isDragging ? 'dragging' : 'idle'}
      whileHover={isDragging ? undefined : { scale: 1.012, boxShadow: '0 6px 22px var(--primary-g)' }}
      whileTap={isDragging   ? undefined : { scale: 0.99 }}
      onPointerDown={handlePointerDown}
      className={active ? 'note-card note-card--active' : 'note-card'}
      style={{
        background:   'var(--card)',
        borderRadius: 16,
        padding:      '14px 16px 12px',
        cursor:       isDragging ? 'grabbing' : 'grab',
        border:       active ? '0.5px solid var(--primary)' : '0.5px solid var(--border)',
        boxShadow:    active ? undefined : '0 1px 4px rgba(0,0,0,0.04)',
        position:     'relative',
        overflow:     'hidden',
        willChange:   'transform',
        userSelect:   isDragging ? 'none' : undefined,
        touchAction:  'none', // prevent browser scroll-on-drag on mobile
      }}
    >
      {/* Title row */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
        {note.emoji && <span style={{ fontSize: 13, flexShrink: 0 }}>{note.emoji}</span>}
        <div
          style={{
            fontSize:     13,
            fontWeight:   600,
            color:        'var(--strong)',
            overflow:     'hidden',
            textOverflow: 'ellipsis',
            whiteSpace:   'nowrap',
            flex:         1,
          }}
        >
          {note.title}
        </div>
      </div>

      {/* Snippet */}
      {snip && (
        <div
          style={{
            fontSize:         11,
            color:            'var(--soft)',
            lineHeight:       1.5,
            marginBottom:     8,
            display:          '-webkit-box',
            WebkitLineClamp:  2,
            WebkitBoxOrient:  'vertical',
            overflow:         'hidden',
          }}
        >
          {snip}
        </div>
      )}

      {/* Tags + timestamp + delete — all in one flex row so nothing overlaps */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginTop: 0 }}>
        {/* Tags */}
        <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', flex: 1, minWidth: 0 }}>
          {note.tags.slice(0, 3).map((tag: string, ti: number) => {
            const palette = TAG_PALETTE[ti % TAG_PALETTE.length];
            return (
              <span
                key={tag}
                style={{
                  fontSize:     9,
                  fontWeight:   isDark ? 600 : 500,
                  padding:      '2px 7px',
                  borderRadius: 100,
                  background:   isDark ? 'var(--primary-s)' : palette.bg,
                  color:        isDark ? 'var(--primary)'   : palette.fg,
                }}
              >
                #{tag}
              </span>
            );
          })}
        </div>

        {/* Timestamp */}
        <span style={{ fontSize: 9, color: 'var(--muted)', flexShrink: 0 }}>{ago}</span>

        {/* Delete button — inline, never overlaps timestamp */}
        <button
          type="button"
          className="note-card-delete"
          onClick={handleDelete}
          title={confirmDelete ? 'Click again to confirm' : 'Delete note'}
          style={{
            flexShrink:    0,
            border:        'none',
            borderRadius:  6,
            padding:       '2px 6px',
            fontSize:      10,
            fontWeight:    700,
            fontFamily:    'var(--font-ui)',
            cursor:        'pointer',
            letterSpacing: '0.2px',
            lineHeight:    1,
            background:    confirmDelete ? 'rgba(255,82,82,0.1)' : 'transparent',
            color:         confirmDelete ? '#FF5252' : 'var(--soft)',
            transition:    'background 0.15s, color 0.15s',
          }}
        >
          {confirmDelete ? 'delete?' : '✕'}
        </button>
      </div>
    </motion.div>
  );
});

NoteCard.displayName = 'NoteCard';

export default NoteList;
