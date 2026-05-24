import React, { memo, useMemo, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useNoteStore, Note, Pocket } from '../store/noteStore';
import { stripMarkdown } from '../lib/stripMarkdown';
import { formatNoteDate } from '../lib/formatTime';

const TAG_PALETTE = [
  { bg: '#F6E3CB', fg: '#9A6B3A' },
  { bg: '#F1DFDB', fg: '#9A5F55' },
  { bg: '#DDE6DD', fg: '#5E7860' },
  { bg: '#DFE7EE', fg: '#5B7388' },
  { bg: '#E8E0EA', fg: '#7A6585' },
  { bg: '#ECE5D8', fg: '#8A7651' },
];

const NoteList = () => {
  const notes        = useNoteStore((s) => s.notes);
  const pockets      = useNoteStore((s) => s.pockets);
  const activePocket = useNoteStore((s) => s.activePocket);
  const selectedNoteId = useNoteStore((s) => s.selectedNoteId);
  const isDark       = useNoteStore((s) => s.isDark);
  const createNote   = useNoteStore((s) => s.createNote);

  const filtered = useMemo(
    () => notes.filter((n: Note) => activePocket === '' || n.folder === activePocket),
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

/** Memoised — only re-renders when note data, active state, or dark mode changes */
const NoteCard = memo(({
  note,
  active,
  isDark,
}: {
  note: Note;
  active: boolean;
  isDark: boolean;
}) => {
  // Stable store action refs (Zustand actions never change identity)
  const selectNote = useNoteStore((s) => s.selectNote);
  const deleteNote = useNoteStore((s) => s.deleteNote);

  const [confirmDelete, setConfirmDelete] = useState(false);

  // Expensive computations are memoised per-card
  const snip = useMemo(() => stripMarkdown(note.content), [note.content]);
  const ago  = useMemo(() => formatNoteDate(note.updatedAt), [note.updatedAt]);

  const handleDelete = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (confirmDelete) {
      void deleteNote(note.id);
      setConfirmDelete(false);
    } else {
      setConfirmDelete(true);
      setTimeout(() => setConfirmDelete(false), 3000);
    }
  };

  return (
    <motion.div
      // No entry animation — avoids replaying on filter/select changes
      exit={{ opacity: 0, scale: 0.96, height: 0, marginBottom: 0, paddingTop: 0, paddingBottom: 0 }}
      transition={{ duration: 0.18, ease: [0.4, 0, 0.2, 1] }}
      // Subtle hover — no y-offset (avoids layout reflow)
      whileHover={{ scale: 1.012, boxShadow: '0 6px 22px var(--primary-g)' }}
      whileTap={{ scale: 0.99 }}
      onClick={() => void selectNote(note.id)}
      className={active ? 'note-card note-card--active' : 'note-card'}
      style={{
        background: 'var(--card)',
        borderRadius: 16,
        padding: '14px 16px 12px',
        cursor: 'pointer',
        border: active ? '0.5px solid var(--primary)' : '0.5px solid var(--border)',
        boxShadow: active ? undefined : '0 1px 4px rgba(0,0,0,0.04)',
        position: 'relative',
        overflow: 'hidden',
        willChange: 'transform',
      }}
    >
      {/* Title row */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
        {note.emoji && <span style={{ fontSize: 13, flexShrink: 0 }}>{note.emoji}</span>}
        <div
          style={{
            fontSize: 13,
            fontWeight: 600,
            color: 'var(--strong)',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
            flex: 1,
          }}
        >
          {note.title}
        </div>
      </div>

      {/* Snippet */}
      {snip && (
        <div
          style={{
            fontSize: 11,
            color: 'var(--soft)',
            lineHeight: 1.5,
            marginBottom: 8,
            display: '-webkit-box',
            WebkitLineClamp: 2,
            WebkitBoxOrient: 'vertical',
            overflow: 'hidden',
          }}
        >
          {snip}
        </div>
      )}

      {/* Tags + timestamp */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', flex: 1 }}>
          {note.tags.slice(0, 3).map((tag: string, ti: number) => {
            const palette = TAG_PALETTE[ti % TAG_PALETTE.length];
            return (
              <span
                key={tag}
                style={{
                  fontSize: 9,
                  fontWeight: isDark ? 600 : 500,
                  padding: '2px 7px',
                  borderRadius: 100,
                  background: isDark ? 'var(--primary-s)' : palette.bg,
                  color: isDark ? 'var(--primary)' : palette.fg,
                }}
              >
                #{tag}
              </span>
            );
          })}
        </div>
        <span style={{ fontSize: 9, color: 'var(--muted)', flexShrink: 0, marginRight: 24 }}>{ago}</span>
      </div>

      {/* Delete button */}
      <button
        type="button"
        className="note-card-delete"
        onClick={handleDelete}
        title={confirmDelete ? 'Click again to confirm' : 'Delete note'}
        style={{
          position: 'absolute',
          right: 8,
          bottom: 9,
          border: 'none',
          borderRadius: 6,
          padding: '2px 7px',
          fontSize: 10,
          fontWeight: 700,
          fontFamily: 'var(--font-ui)',
          cursor: 'pointer',
          letterSpacing: '0.2px',
          background: confirmDelete ? 'rgba(255,82,82,0.1)' : 'transparent',
          color: confirmDelete ? '#FF5252' : 'var(--soft)',
          opacity: confirmDelete ? 1 : undefined,
          transition: 'background 0.15s, color 0.15s',
        }}
      >
        {confirmDelete ? 'delete?' : '✕'}
      </button>
    </motion.div>
  );
});

NoteCard.displayName = 'NoteCard';

export default NoteList;
