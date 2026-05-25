import React, { useEffect, useRef, useState, useCallback, useMemo } from 'react';
import EmojiPicker from './EmojiPicker';
import { motion, AnimatePresence } from 'framer-motion';
import { useEditor, EditorContent, Editor as TipTapEditor } from '@tiptap/react';
import {
  createEditorExtensions,
  getBodyMarkdown,
  setBodyMarkdown,
  restoreCursor,
} from '../lib/markdown';
import { useNoteStore, Note, type SyncState, normaliseTag } from '../store/noteStore';
import { fmtTime24, formatNoteDate } from '../lib/formatTime';
import { findBacklinks } from '../lib/backlinks';
import { parseFootnotes } from '../extensions/footnote';
import { exportToPdf } from '../lib/pdfExport';

interface EditorProps {
  onOpenPalette?: () => void;
}

interface TocItem {
  text: string;
  level: number;
}

// ── Collapsible TOC tree ─────────────────────────────────────────────────────

interface TocNode extends TocItem {
  /** Original flat index — used by scrollToHeading */
  flatIndex: number;
  children: TocNode[];
}

/** Converts a flat TocItem array into a nested tree structure. */
function buildTocTree(items: TocItem[]): TocNode[] {
  const roots: TocNode[] = [];
  const stack: TocNode[] = [];

  items.forEach((item, i) => {
    const node: TocNode = { ...item, flatIndex: i, children: [] };

    // Pop nodes that are at the same or deeper nesting level
    while (stack.length > 0 && stack[stack.length - 1].level >= item.level) {
      stack.pop();
    }

    if (stack.length === 0) {
      roots.push(node);
    } else {
      stack[stack.length - 1].children.push(node);
    }

    stack.push(node);
  });

  return roots;
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const fmt = (iso: string) => {
  const d = new Date(iso);
  return `${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()}`;
};

const TAG_PALETTE = [
  { bg: '#F6E3CB', fg: '#9A6B3A' },
  { bg: '#F1DFDB', fg: '#9A5F55' },
  { bg: '#DDE6DD', fg: '#5E7860' },
  { bg: '#DFE7EE', fg: '#5B7388' },
  { bg: '#E8E0EA', fg: '#7A6585' },
  { bg: '#ECE5D8', fg: '#8A7651' },
];

const parseToc = (editor: TipTapEditor | null): TocItem[] => {
  if (!editor) return [];
  const items: TocItem[] = [];
  editor.state.doc.forEach((node) => {
    if (node.type.name === 'heading') {
      items.push({ text: node.textContent, level: node.attrs.level });
    }
  });
  return items;
};

// ── Save indicator ─────────────────────────────────────────────────────────────

function buildSaveLabel(sync: SyncState): string {
  switch (sync.status) {
    case 'saving':   return '· saving…';
    case 'dirty':    return '· unsaved';
    case 'error':    return '· sync failed';
    case 'conflict': return '· conflict';
    case 'synced': {
      if (!sync.lastSyncedAt) return '';
      const d = new Date(sync.lastSyncedAt);
      const hh = String(d.getHours()).padStart(2, '0');
      const mm = String(d.getMinutes()).padStart(2, '0');
      return `· synced ${hh}:${mm}`;
    }
    default:
      return '';
  }
}

const Editor = ({ onOpenPalette }: EditorProps) => {
  const {
    notes,
    pockets,
    selectedNoteId,
    patchNote,
    flushActiveNote,
    selectNote,
    isZen,
    toggleZen,
    isAcademic,
    toggleAcademic,
    isDark,
    syncState,
    backlinksOpen,
    toggleBacklinks,
    addTag,
    removeTag,
    tagCounts,
  } = useNoteStore();

  const note = notes.find((n: Note) => n.id === selectedNoteId);
  const pocket = pockets.find((p) => p.id === note?.folder);

  const editorWrapRef = useRef<HTMLDivElement>(null);
  const titleRef = useRef<HTMLDivElement>(null);
  const descRef = useRef<HTMLDivElement>(null);
  const saveTimeout = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const prevNoteIdRef = useRef<string | null>(null);

  const [tocItems, setTocItems] = useState<TocItem[]>([]);
  const [activeToc, setActiveToc] = useState(0);
  const [findOpen, setFindOpen] = useState(false);
  const [findQuery, setFindQuery] = useState('');
  const findRef = useRef<HTMLInputElement>(null);

  const [localTitle, setLocalTitle] = useState('');
  const [localDesc, setLocalDesc] = useState('');

  // Movable toolbar
  const [toolbarOffset, setToolbarOffset] = useState({ x: 0, y: 0 });
  const [isDraggingToolbar, setIsDraggingToolbar] = useState(false);
  const toolbarDragRef = useRef<{ mx: number; my: number; ox: number; oy: number } | null>(null);

  // Collapsible TOC panel (open/closed)
  const [tocOpen, setTocOpen] = useState(true);
  // Set of flatIndex values whose children are currently collapsed
  const [collapsedNodes, setCollapsedNodes] = useState<Set<number>>(new Set());

  const toggleTocNode = useCallback((flatIndex: number) => {
    setCollapsedNodes((prev) => {
      const next = new Set(prev);
      if (next.has(flatIndex)) next.delete(flatIndex);
      else next.add(flatIndex);
      return next;
    });
  }, []);

  const extensions = useMemo(
    () =>
      createEditorExtensions(() =>
        useNoteStore.getState().notes.map((n) => ({
          id: n.id,
          title: n.title,
          emoji: n.emoji,
        })),
      ),
    [],
  );

  const editor = useEditor({
    extensions,
    content: '',
    onUpdate: ({ editor: ed }) => {
      if (!note) return;
      clearTimeout(saveTimeout.current);
      saveTimeout.current = setTimeout(() => {
        const body = getBodyMarkdown(ed);
        const { from, to } = ed.state.selection;
        patchNote(note.id, {
          content: body,
          cursor: { anchor: from, head: to },
        });
        setTocItems(parseToc(ed));
      }, 400);
    },
    onSelectionUpdate: ({ editor: ed }) => {
      setTocItems(parseToc(ed));
    },
    // Event-driven autosave: flush immediately when the editor loses focus
    // (e.g. user switches apps or clicks outside the Tiptap area).
    onBlur: () => {
      void flushActiveNote();
    },
  });

  useEffect(() => {
    if (!editor || !note) return;

    const load = async () => {
      if (prevNoteIdRef.current && prevNoteIdRef.current !== note.id) {
        await flushActiveNote();
      }
      prevNoteIdRef.current = note.id;

      setLocalTitle(note.title);
      setLocalDesc(note.description ?? '');

      if (titleRef.current) titleRef.current.innerText = note.title;
      if (descRef.current) descRef.current.innerText = note.description ?? '';

      setBodyMarkdown(editor, note.content, false);
      restoreCursor(editor, note.cursor);
      setTocItems(parseToc(editor));
    };

    void load();
  }, [note?.id, editor]);

  useEffect(() => {
    if (!note) return;
    setLocalTitle(note.title);
    if (titleRef.current && document.activeElement !== titleRef.current) {
      titleRef.current.innerText = note.title;
    }
    setLocalDesc(note.description ?? '');
    if (descRef.current && document.activeElement !== descRef.current) {
      descRef.current.innerText = note.description ?? '';
    }
  }, [note?.title, note?.description]);

  useEffect(() => {
    const wrap = editorWrapRef.current;
    if (!wrap) return;

    const onWikiClick = (e: MouseEvent) => {
      const el = (e.target as HTMLElement).closest('.wiki-link, [data-wiki-link]');
      if (!el) return;
      e.preventDefault();

      const noteId = el.getAttribute('data-note-id') ?? '';
      const label  = el.getAttribute('data-label') ?? el.textContent ?? '';

      const allNotes = useNoteStore.getState().notes;

      // 1. Prefer a direct UUID match — this works for freshly-created links
      //    where noteId is the real note UUID stored in mark.attrs.noteId.
      let target = allNotes.find((n) => n.id === noteId);

      // 2. After a Markdown round-trip, noteId equals the link label (the note
      //    title), because [[Title]] carries no UUID.  Fall back to title match.
      if (!target && label.trim()) {
        const needle = label.trim().toLowerCase();
        target = allNotes.find((n) => n.title.trim().toLowerCase() === needle);
      }

      if (target) void selectNote(target.id);
    };

    wrap.addEventListener('click', onWikiClick);
    return () => wrap.removeEventListener('click', onWikiClick);
  }, [selectNote, editor]);

  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'f') {
        e.preventDefault();
        setFindOpen((v) => !v);
        setTimeout(() => findRef.current?.focus(), 60);
      }
      if (e.key === 'Escape') setFindOpen(false);
    };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, []);

  useEffect(() => {
    if (!isDraggingToolbar) return;
    const onMove = (e: MouseEvent) => {
      if (!toolbarDragRef.current) return;
      const dx = e.clientX - toolbarDragRef.current.mx;
      const dy = e.clientY - toolbarDragRef.current.my;
      setToolbarOffset({ x: toolbarDragRef.current.ox + dx, y: toolbarDragRef.current.oy + dy });
    };
    const onUp = () => { setIsDraggingToolbar(false); toolbarDragRef.current = null; };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return () => { window.removeEventListener('mousemove', onMove); window.removeEventListener('mouseup', onUp); };
  }, [isDraggingToolbar]);

  // ── Backlinks — depend on stable IDs to avoid stale-closure glitches ────────
  // Using selectedNoteId (a primitive) instead of `note` (a new object reference
  // on every render) prevents unnecessary recomputations and rendering artefacts.
  const backlinks = useMemo(() => {
    const current = notes.find((n) => n.id === selectedNoteId);
    if (!current) return [] as Note[];
    const title = current.title.trim();
    if (!title) return [] as Note[];
    const needle = `[[${title}]]`;
    // Deduplicate by ID in case the same note links multiple times
    const seen = new Set<string>();
    return notes.filter((n) => {
      if (n.id === current.id) return false;
      if (!n.content.includes(needle)) return false;
      if (seen.has(n.id)) return false;
      seen.add(n.id);
      return true;
    });
  }, [notes, selectedNoteId]);

  const footnotes = useMemo(
    () => (note ? parseFootnotes(note.content) : []),
    [note?.content],
  );

  // ── PDF export — captures the editor surface and saves a native PDF file ────
  const [isPdfExporting, setIsPdfExporting] = useState(false);

  const handlePdfExport = useCallback(async () => {
    if (!note || isPdfExporting) return;
    // Flush any pending changes before capturing
    await flushActiveNote();

    const surface = editorWrapRef.current?.querySelector<HTMLElement>('.editor-surface');
    if (!surface) return;

    setIsPdfExporting(true);
    try {
      await exportToPdf(surface, note.title);
    } catch (err) {
      console.error('[phing] PDF export failed', err);
    } finally {
      setIsPdfExporting(false);
    }
  }, [note, isPdfExporting, flushActiveNote]);

  const scrollZenToCursor = useCallback(() => {
    if (!isZen || !editor) return;
    const wrap = editorWrapRef.current;
    if (!wrap) return;
    const { from } = editor.state.selection;
    const coords = editor.view.coordsAtPos(from);
    const wrapRect = wrap.getBoundingClientRect();
    const targetY = wrapRect.height * 0.45;
    const cursorYInWrap = coords.top - wrapRect.top;
    wrap.scrollTop += cursorYInWrap - targetY;
  }, [editor, isZen]);

  useEffect(() => {
    if (!editor || !isZen) return;
    const onMove = () => scrollZenToCursor();
    editor.on('selectionUpdate', onMove);
    editor.on('update', onMove);
    editor.on('focus', onMove);
    requestAnimationFrame(onMove);
    return () => {
      editor.off('selectionUpdate', onMove);
      editor.off('update', onMove);
      editor.off('focus', onMove);
    };
  }, [editor, isZen, scrollZenToCursor]);

  const scrollToHeading = useCallback((idx: number) => {
    const container = editorWrapRef.current;
    if (!container) return;
    const headings = container.querySelectorAll('h1,h2,h3,h4,h5');
    const el = headings[idx] as HTMLElement | undefined;
    if (!el) return;

    const containerTop = container.getBoundingClientRect().top;
    const elTop = el.getBoundingClientRect().top;
    const offsetTop = elTop - containerTop + container.scrollTop;

    container.scrollTo({ top: Math.max(0, offsetTop - 80), behavior: 'smooth' });
    setActiveToc(idx);
  }, []);

  const onTitleBlur = () => {
    if (!note || !titleRef.current) return;
    const newTitle = titleRef.current.innerText.trim() || 'Untitled';
    setLocalTitle(newTitle);
    patchNote(note.id, { title: newTitle });
  };

  const onDescBlur = () => {
    if (!note || !descRef.current) return;
    const newDesc = descRef.current.innerText.trim();
    setLocalDesc(newDesc);
    patchNote(note.id, { description: newDesc });
  };

  const saveLabel = buildSaveLabel(syncState);

  if (!note || !editor) {
    return (
      <div
        style={{
          flex: 1,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          flexDirection: 'column',
          gap: 12,
          color: 'var(--muted)',
        }}
      >
        <span style={{ fontSize: 36 }}>(o_o)</span>
        <p className="editor-empty-hint">select a note, or begin a new one</p>
      </div>
    );
  }

  const wordCount = note.content.split(/\s+/).filter(Boolean).length;
  const readTime = Math.max(1, Math.round(wordCount / 200));

  return (
    <div
      className="editor-root"
      style={{
        flex: 1,
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
        position: 'relative',
        minWidth: 0,
        minHeight: 0,
      }}
    >
      <div
        className="editor-chrome-bar"
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '9px 24px',
          borderBottom: '0.5px solid var(--divider)',
          flexShrink: 0,
          background: 'var(--bg)',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11, color: 'var(--muted)' }}>
          <span style={{ fontWeight: 600, color: 'var(--primary)' }}>Phing</span>
          {pocket && (
            <>
              <span>/</span>
              <span>{pocket.name}</span>
            </>
          )}
          <span>/</span>
          <span style={{ color: 'var(--strong)', fontWeight: 500 }}>{localTitle || note.title}</span>
          <span style={{ marginLeft: 8, color: 'var(--primary)', fontSize: 10 }}>{saveLabel}</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 14, fontSize: 11 }}>
          <motion.span
            whileHover={{ color: 'var(--primary)' }}
            onClick={() => {
              setFindOpen((v) => !v);
              setTimeout(() => findRef.current?.focus(), 60);
            }}
            style={{
              color: findOpen ? 'var(--primary)' : 'var(--muted)',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: 4,
              background: findOpen ? 'var(--primary-s)' : 'transparent',
              padding: '3px 8px',
              borderRadius: 7,
              transition: 'all 0.18s',
            }}
          >
            🔍 find · ⌘F
          </motion.span>
          <motion.span
            whileHover={{ background: 'var(--primary-s)', color: 'var(--primary)' }}
            onClick={toggleZen}
            style={{
              padding: '3px 8px',
              borderRadius: 7,
              cursor: 'pointer',
              transition: 'all 0.18s',
              color: isZen ? 'var(--primary)' : 'var(--muted)',
              background: isZen ? 'var(--primary-s)' : 'transparent',
              fontWeight: isZen ? 600 : 400,
            }}
          >
            ◯ zen · {isZen ? 'on' : 'off'}
          </motion.span>
          <motion.span
            whileHover={{ background: 'var(--primary-s)', color: 'var(--primary)' }}
            onClick={toggleAcademic}
            title="Academic A4 writing mode (⌘⇧A)"
            style={{
              padding: '3px 8px',
              borderRadius: 7,
              cursor: 'pointer',
              transition: 'all 0.18s',
              color: isAcademic ? 'var(--primary)' : 'var(--muted)',
              background: isAcademic ? 'var(--primary-s)' : 'transparent',
              fontWeight: isAcademic ? 600 : 400,
            }}
          >
            𝐴 a4
          </motion.span>
          <motion.span
            whileHover={{ background: 'var(--primary-s)', color: 'var(--primary)' }}
            onClick={() => setTocOpen((v) => !v)}
            style={{
              padding: '3px 8px',
              borderRadius: 7,
              cursor: 'pointer',
              transition: 'all 0.18s',
              color: tocOpen ? 'var(--primary)' : 'var(--muted)',
              background: tocOpen ? 'var(--primary-s)' : 'transparent',
              fontWeight: tocOpen ? 600 : 400,
            }}
          >
            ☰ toc
          </motion.span>
          <motion.span
            whileHover={{ background: 'var(--primary-s)', color: 'var(--primary)' }}
            onClick={toggleBacklinks}
            title="Toggle backlinks panel (⌘⇧B)"
            style={{
              padding: '3px 8px',
              borderRadius: 7,
              cursor: 'pointer',
              transition: 'all 0.18s',
              color: backlinksOpen ? 'var(--primary)' : 'var(--muted)',
              background: backlinksOpen ? 'var(--primary-s)' : 'transparent',
              fontWeight: backlinksOpen ? 600 : 400,
            }}
          >
            ↩ links
          </motion.span>
          <motion.span
            whileHover={{ background: 'var(--primary-s)', color: 'var(--primary)' }}
            onClick={() => void handlePdfExport()}
            title="Export to PDF"
            style={{
              padding: '3px 8px',
              borderRadius: 7,
              cursor: isPdfExporting ? 'wait' : 'pointer',
              transition: 'all 0.18s',
              color: isPdfExporting ? 'var(--primary)' : 'var(--muted)',
              opacity: isPdfExporting ? 0.7 : 1,
            }}
          >
            {isPdfExporting ? '⏳ exporting…' : '↓ pdf'}
          </motion.span>
        </div>
      </div>

      <AnimatePresence>
        {findOpen && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2 }}
            style={{
              borderBottom: '0.5px solid var(--divider)',
              background: 'var(--card)',
              overflow: 'hidden',
              flexShrink: 0,
            }}
          >
            <div className="editor-find-bar" style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 24px' }}>
              <span style={{ fontSize: 13, color: 'var(--muted)' }}>🔍</span>
              <input
                ref={findRef}
                value={findQuery}
                onChange={(e) => setFindQuery(e.target.value)}
                placeholder="Find in note..."
                style={{
                  flex: 1,
                  border: 'none',
                  outline: 'none',
                  background: 'transparent',
                  fontSize: 13,
                  color: 'var(--strong)',
                  fontFamily: 'var(--font-ui)',
                }}
              />
              <span
                style={{ fontSize: 10, color: 'var(--muted)', cursor: 'pointer' }}
                onClick={() => setFindOpen(false)}
              >
                ESC
              </span>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <div
        className="editor-toolbar"
        style={{
          position: 'absolute',
          top: (findOpen ? 90 : 46) + toolbarOffset.y,
          left: `calc(50% + ${toolbarOffset.x}px)`,
          transform: 'translateX(-50%)',
          background: 'var(--card)',
          border: '0.5px solid var(--border)',
          borderRadius: 100,
          padding: '5px 10px 5px 8px',
          display: 'flex',
          alignItems: 'center',
          gap: 2,
          boxShadow: '0 4px 20px var(--primary-g)',
          zIndex: 10,
          backdropFilter: 'blur(12px)',
          userSelect: 'none',
        }}
      >
        {/* Drag handle */}
        <span
          title="Drag to move · double-click to reset"
          onMouseDown={(e) => {
            e.preventDefault();
            toolbarDragRef.current = { mx: e.clientX, my: e.clientY, ox: toolbarOffset.x, oy: toolbarOffset.y };
            setIsDraggingToolbar(true);
          }}
          onDoubleClick={() => setToolbarOffset({ x: 0, y: 0 })}
          style={{
            cursor: isDraggingToolbar ? 'grabbing' : 'grab',
            fontSize: 12,
            color: 'var(--soft)',
            padding: '0 4px',
            marginRight: 4,
            lineHeight: 1,
          }}
        >
          ⠿
        </span>
        {[
          { label: 'B', action: () => editor.chain().focus().toggleBold().run(), active: editor.isActive('bold') },
          { label: 'I', action: () => editor.chain().focus().toggleItalic().run(), active: editor.isActive('italic') },
          { label: 'U', action: () => editor.chain().focus().toggleUnderline().run(), active: editor.isActive('underline') },
          { label: 'S', action: () => editor.chain().focus().toggleStrike().run(), active: editor.isActive('strike') },
        ].map((btn) => (
          <TBtn key={btn.label} {...btn} />
        ))}
        <Div />
        {[1, 2, 3].map((h) => (
          <TBtn
            key={h}
            label={`H${h}`}
            action={() => editor.chain().focus().toggleHeading({ level: h as 1 | 2 | 3 }).run()}
            active={editor.isActive('heading', { level: h })}
            small
          />
        ))}
        <Div />
        <TBtn label="≡" action={() => editor.chain().focus().toggleBulletList().run()} active={editor.isActive('bulletList')} />
        <TBtn label="①" action={() => editor.chain().focus().toggleOrderedList().run()} active={editor.isActive('orderedList')} />
        <TBtn label='"' action={() => editor.chain().focus().toggleBlockquote().run()} active={editor.isActive('blockquote')} />
        <TBtn label="<>" action={() => editor.chain().focus().toggleCode().run()} active={editor.isActive('code')} small />
        <Div />
        <TBtn label="—" action={() => editor.chain().focus().setHorizontalRule().run()} active={false} />
      </div>

      <div
        className="editor-main"
        style={{ flex: 1, display: 'flex', overflow: 'hidden', minHeight: 0 }}
      >
        <div
          ref={editorWrapRef}
          className={`editor-scroll${isZen ? ' zen-mode' : ''}${isAcademic ? ' academic-mode' : ''}`}
          style={{
            flex: 1,
            minHeight: 0,
            overflowY: 'auto',
            overflowX: 'hidden',
            paddingTop: 52,
            position: 'relative',
          }}
        >
          <div className="editor-surface" style={{ maxWidth: 720, margin: '0 auto', padding: '32px 56px 120px' }}>
            <div className="editor-meta">
              {pocket?.name ?? 'Notes'} · {fmt(note.createdAt)}
            </div>

            {/* Title row: emoji trigger + contenteditable title */}
            <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10, marginBottom: 10 }}>
              <EmojiPicker
                emoji={note.emoji}
                defaultEmoji="📄"
                large
                onSelect={(em) => patchNote(note.id, { emoji: em })}
              />
              <div
                ref={titleRef}
                className="editor-title"
                contentEditable
                suppressContentEditableWarning
                onBlur={onTitleBlur}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    descRef.current?.focus();
                  }
                }}
                data-placeholder="Note title..."
                style={{ flex: 1, marginBottom: 0 }}
              />
            </div>

            <div
              ref={descRef}
              className="editor-desc"
              contentEditable
              suppressContentEditableWarning
              onBlur={onDescBlur}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  editor.commands.focus('start');
                }
              }}
              data-placeholder="Add a short description..."
            />

            <TagBar
              noteId={note.id}
              tags={note.tags}
              tagCounts={tagCounts}
              isDark={isDark}
              onAdd={(tag) => addTag(note.id, tag)}
              onRemove={(tag) => removeTag(note.id, tag)}
            />

            <EditorContent
              editor={editor}
              className={`phing-editor${isZen ? ' zen-active' : ''}`}
            />

            {footnotes.length > 0 && (
              <div className="editor-footnotes">
                <div className="editor-footnotes__rule" />
                <div className="editor-footnotes__label">Footnotes</div>
                {footnotes.map((fn, i) => (
                  <div key={fn.label} id={`fn-${fn.label}`} className="editor-footnotes__item">
                    <span className="editor-footnotes__num">{i + 1}</span>
                    <span className="editor-footnotes__text">{fn.text}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        <motion.div
          className="editor-toc-panel"
          animate={{ width: tocOpen ? 220 : 0, opacity: tocOpen ? 1 : 0 }}
          transition={{ duration: 0.28, ease: [0.4, 0, 0.2, 1] }}
          style={{
            flexShrink: 0,
            borderLeft: '0.5px solid var(--divider)',
            display: 'flex',
            flexDirection: 'column',
            overflow: 'hidden',
            minHeight: 0,
            minWidth: 0,
          }}
        >
          {/* Scrollable inner area — TOC, backlinks, and file info all scroll together */}
          <div
            className="editor-toc-scroll"
            style={{
              flex: 1,
              overflowY: 'auto',
              overflowX: 'hidden',
              paddingTop: 20,
              paddingBottom: 20,
            }}
          >
            {tocItems.length > 0 && (
              <div style={{ padding: '0 16px 20px', borderBottom: '0.5px solid var(--divider)' }}>
                <div
                  style={{
                    fontSize: 9,
                    fontWeight: 700,
                    color: 'var(--muted)',
                    letterSpacing: '1px',
                    textTransform: 'uppercase',
                    marginBottom: 12,
                  }}
                >
                  Contents
                </div>
                <TocTree
                  nodes={buildTocTree(tocItems)}
                  activeFlatIndex={activeToc}
                  collapsedNodes={collapsedNodes}
                  onToggleCollapse={toggleTocNode}
                  onNavigate={(i) => scrollToHeading(i)}
                />
              </div>
            )}
            {backlinksOpen && (
              <div
                style={{
                  padding: '16px 16px 20px',
                  borderBottom: tocItems.length > 0 ? '0.5px solid var(--divider)' : undefined,
                }}
              >
                <div
                  style={{
                    fontSize: 9,
                    fontWeight: 700,
                    color: 'var(--muted)',
                    letterSpacing: '1px',
                    textTransform: 'uppercase',
                    marginBottom: 12,
                  }}
                >
                  Backlinks
                </div>
                {backlinks.length === 0 ? (
                  <div style={{ fontSize: 11, color: 'var(--soft)', fontStyle: 'italic' }}>
                    No backlinks yet
                  </div>
                ) : (
                  backlinks.map((bl) => (
                    <motion.div
                      key={bl.id}
                      whileHover={{ color: 'var(--primary)', background: 'var(--primary-s)' }}
                      onClick={() => void selectNote(bl.id)}
                      style={{
                        display:      'flex',
                        alignItems:   'center',
                        gap:          6,
                        fontSize:     11,
                        color:        'var(--muted)',
                        padding:      '5px 6px',
                        borderRadius: 8,
                        cursor:       'pointer',
                        overflow:     'hidden',
                        transition:   'background 0.15s, color 0.15s',
                      }}
                    >
                      {bl.emoji != null && (
                        <span style={{ flexShrink: 0 }}>{bl.emoji}</span>
                      )}
                      <span
                        style={{
                          overflow:     'hidden',
                          textOverflow: 'ellipsis',
                          whiteSpace:   'nowrap',
                        }}
                      >
                        {bl.title ?? 'Untitled'}
                      </span>
                    </motion.div>
                  ))
                )}
              </div>
            )}
            <div style={{ padding: '20px 16px' }}>
              <div
                style={{
                  fontSize: 9,
                  fontWeight: 700,
                  color: 'var(--muted)',
                  letterSpacing: '1px',
                  textTransform: 'uppercase',
                  marginBottom: 14,
                }}
              >
                File
              </div>
              {[
                { label: 'opened', value: fmtTime24(note.createdAt) },
                { label: 'edited', value: formatNoteDate(note.updatedAt) },
                { label: 'words', value: wordCount.toLocaleString() },
                { label: 'reading', value: `~${readTime} min` },
              ].map(({ label, value }) => (
                <div key={label} style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 10 }}>
                  <span style={{ fontSize: 11, color: 'var(--muted)' }}>{label}</span>
                  <span style={{ fontSize: 11, color: 'var(--strong)', fontWeight: 500 }}>{value}</span>
                </div>
              ))}
            </div>
          </div>
        </motion.div>
      </div>

      <div
        className="editor-status-bar"
        style={{
          display: 'flex',
          gap: 16,
          padding: '6px 56px',
          borderTop: '0.5px solid var(--divider)',
          fontSize: 10,
          color: 'var(--muted)',
          flexShrink: 0,
          background: 'var(--bg)',
        }}
      >
        <span style={{ color: 'var(--primary)' }}>{saveLabel}</span>
        <span>{wordCount} words</span>
        <span>~{readTime} min</span>
      </div>
    </div>
  );
};

// ─── Tag components ──────────────────────────────────────────────────────────

interface TagPillProps {
  tag:      string;
  paletteIndex: number;
  isDark:   boolean;
  onRemove: () => void;
}

const TagPill = ({ tag, paletteIndex, isDark, onRemove }: TagPillProps) => {
  const p = TAG_PALETTE[paletteIndex % TAG_PALETTE.length];
  return (
    <span
      className="editor-tag editor-tag--pill"
      style={{
        background: isDark ? 'var(--primary-s)' : p.bg,
        color:      isDark ? 'var(--primary)'   : p.fg,
      }}
    >
      #{tag}
      <button
        type="button"
        className="editor-tag__remove"
        onClick={(e) => { e.stopPropagation(); onRemove(); }}
        aria-label={`Remove tag ${tag}`}
        tabIndex={-1}
      >
        ×
      </button>
    </span>
  );
};

interface TagBarProps {
  noteId:    string;
  tags:      string[];
  tagCounts: Record<string, number>;
  isDark:    boolean;
  onAdd:     (tag: string) => void;
  onRemove:  (tag: string) => void;
}

const TagBar = ({ tags, tagCounts, isDark, onAdd, onRemove }: TagBarProps) => {
  const [isAdding, setIsAdding]   = React.useState(false);
  const [draft,    setDraft]      = React.useState('');
  const inputRef                  = React.useRef<HTMLInputElement>(null);

  // Suggestions: existing vault tags that start with the draft and aren't already on this note.
  const suggestions = React.useMemo(() => {
    const q = draft.trim().toLowerCase();
    if (!q) return [];
    return Object.keys(tagCounts)
      .filter((t) => t.startsWith(q) && !tags.includes(t))
      .sort((a, b) => tagCounts[b] - tagCounts[a]) // most-used first
      .slice(0, 6);
  }, [draft, tagCounts, tags]);

  const startAdding = () => {
    setIsAdding(true);
    // Focus after the next paint so the input is mounted.
    requestAnimationFrame(() => inputRef.current?.focus());
  };

  const commit = (value = draft) => {
    const norm = normaliseTag(value);
    if (norm) onAdd(norm);
    setDraft('');
    // Keep input open for multi-add; re-focus for the next tag.
    requestAnimationFrame(() => inputRef.current?.focus());
  };

  const cancel = () => {
    setDraft('');
    setIsAdding(false);
  };

  return (
    <div
      className="editor-tags"
      style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center', marginBottom: 28 }}
    >
      {tags.map((tag, ti) => (
        <TagPill
          key={tag}
          tag={tag}
          paletteIndex={ti}
          isDark={isDark}
          onRemove={() => onRemove(tag)}
        />
      ))}

      {isAdding ? (
        <div style={{ position: 'relative' }}>
          <input
            ref={inputRef}
            className="editor-tag-input"
            value={draft}
            maxLength={40}
            placeholder="add tag…"
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter')  { e.preventDefault(); commit(); }
              if (e.key === 'Escape') { e.preventDefault(); cancel(); }
            }}
            // onBlur fires only when focus leaves to something other than a
            // suggestion button (those use onMouseDown + preventDefault).
            onBlur={cancel}
          />

          {suggestions.length > 0 && (
            <div className="tag-suggestions">
              {suggestions.map((s) => (
                <button
                  key={s}
                  type="button"
                  className="tag-suggestion-item"
                  // preventDefault keeps focus on the input so onBlur doesn't fire.
                  onMouseDown={(e) => { e.preventDefault(); commit(s); }}
                >
                  <span>#{s}</span>
                  <span className="tag-suggestion-count">{tagCounts[s]}</span>
                </button>
              ))}
            </div>
          )}
        </div>
      ) : (
        <button
          type="button"
          className="editor-tag editor-tag--add"
          onClick={startAdding}
        >
          + add a tag
        </button>
      )}
    </div>
  );
};

// ─── Collapsible TOC tree ────────────────────────────────────────────────────

interface TocTreeProps {
  nodes: TocNode[];
  activeFlatIndex: number;
  collapsedNodes: Set<number>;
  onToggleCollapse: (flatIndex: number) => void;
  onNavigate: (flatIndex: number) => void;
}

const TocTree = ({
  nodes,
  activeFlatIndex,
  collapsedNodes,
  onToggleCollapse,
  onNavigate,
}: TocTreeProps) => (
  <>
    {nodes.map((node) => (
      <TocTreeItem
        key={node.flatIndex}
        node={node}
        activeFlatIndex={activeFlatIndex}
        collapsedNodes={collapsedNodes}
        onToggleCollapse={onToggleCollapse}
        onNavigate={onNavigate}
      />
    ))}
  </>
);

interface TocTreeItemProps {
  node: TocNode;
  activeFlatIndex: number;
  collapsedNodes: Set<number>;
  onToggleCollapse: (flatIndex: number) => void;
  onNavigate: (flatIndex: number) => void;
}

const TocTreeItem = ({
  node,
  activeFlatIndex,
  collapsedNodes,
  onToggleCollapse,
  onNavigate,
}: TocTreeItemProps) => {
  const hasChildren   = node.children.length > 0;
  const isCollapsed   = collapsedNodes.has(node.flatIndex);
  const isActive      = activeFlatIndex === node.flatIndex;

  return (
    <>
      {/* ── Row ─────────────────────────────────────────────────────────── */}
      <motion.div
        whileHover={{ color: 'var(--primary)' }}
        onClick={() => onNavigate(node.flatIndex)}
        style={{
          display:      'flex',
          alignItems:   'center',
          gap:          6,
          padding:      `5px 4px 5px ${(node.level - 1) * 12 + 4}px`,
          fontSize:     node.level === 1 ? 12 : 11,
          color:        isActive ? 'var(--primary)' : 'var(--muted)',
          cursor:       'pointer',
          transition:   'color 0.15s',
          borderLeft:   isActive ? '2px solid var(--primary)' : '2px solid transparent',
          borderRadius: '0 6px 6px 0',
          userSelect:   'none',
        }}
      >
        {/* Chevron — only rendered when children exist */}
        {hasChildren ? (
          <motion.span
            animate={{ rotate: isCollapsed ? -90 : 0 }}
            transition={{ duration: 0.18, ease: [0.4, 0, 0.2, 1] }}
            onClick={(e) => {
              e.stopPropagation();
              onToggleCollapse(node.flatIndex);
            }}
            style={{
              display:     'inline-flex',
              alignItems:  'center',
              fontSize:    8,
              color:       'var(--soft)',
              flexShrink:  0,
              cursor:      'pointer',
              padding:     '2px',
              borderRadius: 4,
              lineHeight:  1,
            }}
            title={isCollapsed ? 'Expand section' : 'Collapse section'}
          >
            ▾
          </motion.span>
        ) : (
          /* Spacer so leaf items align with parent text */
          <span style={{ width: 12, flexShrink: 0 }} />
        )}

        {/* Heading text — no auto-numbering; indentation provides hierarchy */}
        <span
          style={{
            overflow:     'hidden',
            textOverflow: 'ellipsis',
            whiteSpace:   'nowrap',
          }}
        >
          {node.text}
        </span>
      </motion.div>

      {/* ── Children — animate in/out ────────────────────────────────── */}
      <AnimatePresence initial={false}>
        {hasChildren && !isCollapsed && (
          <motion.div
            key="children"
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.22, ease: [0.4, 0, 0.2, 1] }}
            style={{ overflow: 'hidden' }}
          >
            <TocTree
              nodes={node.children}
              activeFlatIndex={activeFlatIndex}
              collapsedNodes={collapsedNodes}
              onToggleCollapse={onToggleCollapse}
              onNavigate={onNavigate}
            />
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
};

// ─── Toolbar helpers ─────────────────────────────────────────────────────────

const Div = () => (
  <div style={{ width: 0.5, height: 14, background: 'var(--border)', margin: '0 4px' }} />
);

const TBtn = ({
  label,
  action,
  active,
  small,
}: {
  label: string;
  action: () => void;
  active: boolean;
  small?: boolean;
}) => (
  <motion.div
    whileHover={{ scale: 1.1 }}
    whileTap={{ scale: 0.92 }}
    onClick={action}
    style={{
      width: 28,
      height: 28,
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      borderRadius: 7,
      fontSize: small ? 9 : 13,
      fontWeight: 700,
      cursor: 'pointer',
      color: active ? 'var(--primary)' : 'var(--muted)',
      background: active ? 'var(--primary-s)' : 'transparent',
      transition: 'all 0.16s',
    }}
  >
    {label}
  </motion.div>
);

export default Editor;
