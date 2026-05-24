import React, { useState, useEffect, useRef, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useNoteStore, Note } from '../store/noteStore';
import { formatNoteDate } from '../lib/formatTime';

const TAG_PALETTE = [
  { bg: '#F6E3CB', fg: '#9A6B3A' },
  { bg: '#F1DFDB', fg: '#9A5F55' },
  { bg: '#DDE6DD', fg: '#5E7860' },
  { bg: '#DFE7EE', fg: '#5B7388' },
  { bg: '#E8E0EA', fg: '#7A6585' },
  { bg: '#ECE5D8', fg: '#8A7651' },
];

const stripMd = (s: string) =>
  s
    .replace(/#{1,5}\s/g, '')
    .replace(/\*+(.+?)\*+/g, '$1')
    .replace(/\[\[(.+?)\]\]/g, '$1')
    .replace(/^---+$/gm, '')
    .split('\n')
    .filter(Boolean)
    .join(' ')
    .trim();

interface Props {
  open: boolean;
  onClose: () => void;
}

const CommandPalette = ({ open, onClose }: Props) => {
  const { notes, selectNote, createNote, toggleDark, toggleZen, isDark } = useNoteStore();
  const [query, setQuery]   = useState('');
  const [cursor, setCursor] = useState(-1);
  const inputRef            = useRef<HTMLInputElement>(null);
  const listRef             = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (open) {
      setQuery('');
      setCursor(-1);
      setTimeout(() => inputRef.current?.focus(), 60);
    }
  }, [open]);

  const recentNotes = notes.slice(0, 4);
  const matchedNotes = query.trim()
    ? notes
        .filter(
          (n: Note) =>
            n.title.toLowerCase().includes(query.toLowerCase()) ||
            n.content.toLowerCase().includes(query.toLowerCase()) ||
            n.tags.some((t) => t.toLowerCase().includes(query.toLowerCase())),
        )
        .slice(0, 6)
    : recentNotes;

  // ── Whether to show the "Create new note" suggestion row ───────────────────
  // Shown whenever there is a non-empty query (regardless of match count).
  const showCreateRow = query.trim().length > 0;

  // ── Total navigable items: notes + (optional create row) ──────────────────
  const totalItems = matchedNotes.length + (showCreateRow ? 1 : 0);

  // ── Create-note action (also used by the suggestion row) ───────────────────
  const handleCreateFromQuery = useCallback(async () => {
    await createNote(undefined, query.trim() || 'Untitled');
    onClose();
  }, [createNote, query, onClose]);

  const quickActions = [
    {
      icon: '+',
      label: 'New note',
      sub: 'a blank page, warm lamp on',
      shortcut: '⌘ N',
      action: () => {
        void createNote();
        onClose();
      },
    },
    {
      icon: '◑',
      label: 'Toggle theme',
      sub: isDark ? 'switch to Taro Mochi' : 'switch to Midnight Snow',
      shortcut: '',
      action: () => {
        toggleDark();
        onClose();
      },
    },
    {
      icon: '◯',
      label: 'Zen mode',
      sub: 'just you and the words',
      shortcut: '⌘ ⇧ Z',
      action: () => {
        toggleZen();
        onClose();
      },
    },
  ];

  // ── Keyboard navigation ────────────────────────────────────────────────────
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Escape') { onClose(); return; }

      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setCursor((c) => Math.min(c + 1, totalItems - 1));
        return;
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        setCursor((c) => Math.max(c - 1, 0));
        return;
      }
      if (e.key === 'Enter') {
        e.preventDefault();
        if (cursor >= 0 && cursor < matchedNotes.length) {
          void selectNote(matchedNotes[cursor].id);
          onClose();
        } else if (showCreateRow && cursor === matchedNotes.length) {
          void handleCreateFromQuery();
        } else if (matchedNotes.length > 0) {
          // Default: open first result when cursor is at -1
          void selectNote(matchedNotes[0].id);
          onClose();
        } else if (showCreateRow) {
          void handleCreateFromQuery();
        }
      }
    },
    [cursor, matchedNotes, showCreateRow, selectNote, handleCreateFromQuery, onClose, totalItems],
  );

  // ── Scroll active item into view ───────────────────────────────────────────
  useEffect(() => {
    if (cursor < 0 || !listRef.current) return;
    const item = listRef.current.querySelectorAll('[data-palette-item]')[cursor] as HTMLElement | undefined;
    item?.scrollIntoView({ block: 'nearest' });
  }, [cursor]);

  return (
    <AnimatePresence>
      {open && (
        <>
          <motion.div
            className="command-palette-backdrop"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
          />
          <div className="command-palette-anchor">
            <motion.div
              className="command-palette-panel"
              initial={{ opacity: 0, scale: 0.94, y: -16 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.94, y: -16 }}
              transition={{ type: 'spring', stiffness: 420, damping: 32 }}
            >
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 14,
                padding: '18px 22px',
                borderBottom: '0.5px solid var(--divider)',
              }}
            >
              <span style={{ fontSize: 18, color: 'var(--primary)', flexShrink: 0 }}>🔍</span>
              <input
                ref={inputRef}
                value={query}
                onChange={(e) => { setQuery(e.target.value); setCursor(-1); }}
                onKeyDown={handleKeyDown}
                placeholder="search your notes, gently..."
                style={{
                  flex: 1,
                  border: 'none',
                  outline: 'none',
                  background: 'transparent',
                  fontSize: 16,
                  color: 'var(--strong)',
                  fontFamily: 'var(--font-serif)',
                  fontStyle: 'italic',
                }}
              />
              <kbd
                onClick={onClose}
                style={{
                  fontSize: 10,
                  padding: '3px 8px',
                  borderRadius: 8,
                  cursor: 'pointer',
                  background: 'var(--primary-s)',
                  color: 'var(--muted)',
                  border: '0.5px solid var(--border)',
                  fontFamily: 'var(--font-ui)',
                }}
              >
                esc
              </kbd>
            </div>

            <div ref={listRef} style={{ flex: 1, overflowY: 'auto', padding: '0 0 8px' }}>
              <div style={{ padding: '16px 22px 6px' }}>
                <div
                  style={{
                    fontSize: 9,
                    fontWeight: 700,
                    color: 'var(--muted)',
                    letterSpacing: '1.2px',
                    textTransform: 'uppercase',
                    marginBottom: 10,
                  }}
                >
                  {query.trim() ? 'Results' : 'Recent Notes'}
                </div>
                {matchedNotes.map((note: Note, ni: number) => {
                  const snip = stripMd(note.content).slice(0, 80);
                  const isActive = cursor === ni;
                  return (
                    <motion.div
                      key={note.id}
                      data-palette-item
                      whileHover={{ background: 'var(--primary-s)' }}
                      onClick={() => {
                        void selectNote(note.id);
                        onClose();
                      }}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: 14,
                        padding: '11px 12px',
                        borderRadius: 14,
                        cursor: 'pointer',
                        marginBottom: 2,
                        background: isActive ? 'var(--primary-s)' : undefined,
                        outline: isActive ? '1.5px solid var(--primary)' : undefined,
                        outlineOffset: -1,
                      }}
                    >
                      <div
                        style={{
                          width: 36,
                          height: 36,
                          borderRadius: 10,
                          flexShrink: 0,
                          background: ni === 0 ? 'var(--primary-s)' : 'var(--divider)',
                          border: ni === 0 ? '2px solid var(--primary)' : 'none',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          fontSize: 14,
                        }}
                      >
                        {note.emoji ?? '📄'}
                      </div>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div
                          style={{
                            fontSize: 14,
                            fontWeight: 600,
                            color: 'var(--strong)',
                            marginBottom: 2,
                            overflow: 'hidden',
                            textOverflow: 'ellipsis',
                            whiteSpace: 'nowrap',
                            fontFamily: 'var(--font-serif)',
                          }}
                        >
                          {note.title}
                        </div>
                        {snip && (
                          <div
                            style={{
                              fontSize: 11,
                              color: 'var(--muted)',
                              overflow: 'hidden',
                              textOverflow: 'ellipsis',
                              whiteSpace: 'nowrap',
                            }}
                          >
                            ...{snip}
                          </div>
                        )}
                      </div>
                      <div style={{ display: 'flex', gap: 5, alignItems: 'center', flexShrink: 0 }}>
                        {note.tags.slice(0, 2).map((tag: string, ti: number) => {
                          const p = TAG_PALETTE[ti % TAG_PALETTE.length];
                          return (
                            <span
                              key={tag}
                              style={{
                                fontSize: 9,
                                fontWeight: 600,
                                padding: '3px 8px',
                                borderRadius: 100,
                                background: isDark ? 'var(--primary-s)' : p.bg,
                                color: isDark ? 'var(--primary)' : p.fg,
                              }}
                            >
                              #{tag}
                            </span>
                          );
                        })}
                        <span
                          style={{
                            fontSize: 10,
                            color: 'var(--muted)',
                            marginLeft: 4,
                            whiteSpace: 'nowrap',
                          }}
                        >
                          {formatNoteDate(note.updatedAt)}
                        </span>
                      </div>
                    </motion.div>
                  );
                })}
                {query.trim() && matchedNotes.length === 0 && (
                  <div
                    style={{
                      padding: '12px 12px 4px',
                      color: 'var(--muted)',
                      fontSize: 13,
                      fontStyle: 'italic',
                    }}
                  >
                    No notes found for &quot;{query}&quot;
                  </div>
                )}

                {/* ── Create new note suggestion ─────────────────────────────── */}
                {showCreateRow && (() => {
                  const isActive = cursor === matchedNotes.length;
                  return (
                    <motion.div
                      data-palette-item
                      whileHover={{ background: 'var(--primary-s)' }}
                      onClick={() => void handleCreateFromQuery()}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: 14,
                        padding: '11px 12px',
                        borderRadius: 14,
                        cursor: 'pointer',
                        marginTop: 6,
                        background: isActive ? 'var(--primary-s)' : undefined,
                        outline: isActive ? '1.5px solid var(--primary)' : undefined,
                        outlineOffset: -1,
                      }}
                    >
                      <div
                        style={{
                          width: 36,
                          height: 36,
                          borderRadius: 10,
                          background: 'var(--primary-s)',
                          border: '1.5px dashed var(--primary)',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          fontSize: 18,
                          flexShrink: 0,
                          color: 'var(--primary)',
                        }}
                      >
                        +
                      </div>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div
                          style={{
                            fontSize: 14,
                            fontWeight: 600,
                            color: 'var(--primary)',
                            fontFamily: 'var(--font-serif)',
                          }}
                        >
                          Create new note: &ldquo;{query.trim()}&rdquo;
                        </div>
                        <div style={{ fontSize: 11, color: 'var(--muted)' }}>
                          a fresh page, ready for your thoughts
                        </div>
                      </div>
                      <kbd
                        style={{
                          fontSize: 10,
                          padding: '3px 8px',
                          borderRadius: 8,
                          background: 'var(--primary-s)',
                          color: 'var(--primary)',
                          border: '0.5px solid var(--primary)',
                          fontFamily: 'var(--font-ui)',
                          flexShrink: 0,
                        }}
                      >
                        ↵
                      </kbd>
                    </motion.div>
                  );
                })()}
              </div>

              {!query.trim() && (
                <div
                  style={{
                    padding: '8px 22px 6px',
                    borderTop: '0.5px solid var(--divider)',
                    marginTop: 6,
                  }}
                >
                  <div
                    style={{
                      fontSize: 9,
                      fontWeight: 700,
                      color: 'var(--muted)',
                      letterSpacing: '1.2px',
                      textTransform: 'uppercase',
                      marginBottom: 10,
                      paddingTop: 10,
                    }}
                  >
                    Quick Actions
                  </div>
                  {quickActions.map((action) => (
                    <motion.div
                      key={action.label}
                      whileHover={{ background: 'var(--primary-s)' }}
                      onClick={action.action}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: 14,
                        padding: '11px 12px',
                        borderRadius: 14,
                        cursor: 'pointer',
                        marginBottom: 2,
                      }}
                    >
                      <div
                        style={{
                          width: 36,
                          height: 36,
                          borderRadius: 10,
                          background: 'var(--divider)',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          fontSize: 16,
                          flexShrink: 0,
                          color: 'var(--primary)',
                        }}
                      >
                        {action.icon}
                      </div>
                      <div style={{ flex: 1 }}>
                        <div
                          style={{
                            fontSize: 14,
                            fontWeight: 600,
                            color: 'var(--strong)',
                            fontFamily: 'var(--font-serif)',
                          }}
                        >
                          {action.label}
                        </div>
                        <div style={{ fontSize: 11, color: 'var(--muted)' }}>{action.sub}</div>
                      </div>
                      {action.shortcut && (
                        <kbd
                          style={{
                            fontSize: 10,
                            padding: '3px 8px',
                            borderRadius: 8,
                            background: 'var(--primary-s)',
                            color: 'var(--muted)',
                            border: '0.5px solid var(--border)',
                            fontFamily: 'var(--font-ui)',
                          }}
                        >
                          {action.shortcut}
                        </kbd>
                      )}
                    </motion.div>
                  ))}
                </div>
              )}
            </div>

            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 20,
                padding: '10px 22px',
                borderTop: '0.5px solid var(--divider)',
                fontSize: 10,
                color: 'var(--muted)',
                background: 'var(--primary-s)',
                flexShrink: 0,
              }}
            >
              <span>↑↓ navigate</span>
              <span>↵ open · create</span>
              <span style={{ marginLeft: 'auto' }}>
                <span
                  style={{
                    display: 'inline-block',
                    width: 6,
                    height: 6,
                    borderRadius: '50%',
                    background: 'var(--primary)',
                    marginRight: 6,
                    verticalAlign: 'middle',
                  }}
                />
                quietly searching · {notes.length} notes
              </span>
            </div>
            </motion.div>
          </div>
        </>
      )}
    </AnimatePresence>
  );
};

export default CommandPalette;
