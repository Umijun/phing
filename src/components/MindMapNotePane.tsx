import React, { useEffect, useRef } from 'react';
import { motion } from 'framer-motion';
import { useEditor, EditorContent } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import Placeholder from '@tiptap/extension-placeholder';
import { Markdown } from '@tiptap/markdown';

// ─── Props ────────────────────────────────────────────────────────────────────

interface MindMapNotePaneProps {
  nodeId:         string;
  nodeLabel:      string;
  initialContent: string;
  isDark:         boolean;
  onSave:  (nodeId: string, content: string) => void;
  onClose: () => void;
}

// ─── Component ────────────────────────────────────────────────────────────────

export const MindMapNotePane = ({
  nodeId,
  nodeLabel,
  initialContent,
  isDark,
  onSave,
  onClose,
}: MindMapNotePaneProps) => {
  // Keep a live ref to the current markdown content so the cleanup effect
  // can read it without stale-closure issues (no need for editor to be stable).
  const contentRef = useRef<string>(initialContent);

  // ── Tiptap editor ──────────────────────────────────────────────────────────
  const editor = useEditor({
    extensions: [
      StarterKit,
      Markdown,
      Placeholder.configure({ placeholder: 'Write a note for this node… ✨' }),
    ],
    autofocus: 'end',
    editorProps: {
      attributes: { class: 'mm-note-pane__editor-content' },
    },
    onUpdate: ({ editor: e }) => {
      // Mirror every keystroke into the ref so the cleanup save is always fresh
      contentRef.current = e.getMarkdown?.() ?? e.getText();
    },
    onCreate: ({ editor: e }) => {
      if (initialContent) {
        // Use the @tiptap/markdown content-type to parse initial markdown
        e.commands.setContent(
          initialContent,
          { emitUpdate: false, contentType: 'markdown' } as Parameters<typeof e.commands.setContent>[1],
        );
        contentRef.current = initialContent;
      }
    },
  });

  // ── Auto-save on unmount ───────────────────────────────────────────────────
  // Covers every close path: X button, ⌘⇧N toggle, Escape, board/pocket switch.
  // Using a ref means we never capture stale state in the closure.
  useEffect(() => {
    return () => {
      onSave(nodeId, contentRef.current);
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Escape closes the pane ────────────────────────────────────────────────
  // Registered at document capture so it fires before Tiptap or the board
  // can swallow the event.
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
      }
    };
    document.addEventListener('keydown', handler, true);
    return () => document.removeEventListener('keydown', handler, true);
  }, [onClose]);

  // ── Slide-in / slide-out spring ───────────────────────────────────────────
  return (
    <motion.div
      className={`mm-note-pane${isDark ? ' dark' : ''}`}
      initial={{ x: '100%', opacity: 0 }}
      animate={{ x: 0,      opacity: 1 }}
      exit={{    x: '100%', opacity: 0 }}
      transition={{ type: 'spring', stiffness: 360, damping: 36 }}
      // Stop the board's onKeyDownCapture from swallowing typing in the editor.
      // Since the board handler checks `notePopupId` and bails, this is
      // defence-in-depth — events still reach the Tiptap editor below us.
      onKeyDown={(e) => e.stopPropagation()}
    >
      {/* ── Header ──────────────────────────────────────────────────────────── */}
      <div className="mm-note-pane__header">
        <div className="mm-note-pane__node-label">
          <span className="mm-note-pane__label-dot" aria-hidden />
          <span className="mm-note-pane__label-text">{nodeLabel}</span>
        </div>

        <button
          type="button"
          className="mm-note-pane__close"
          onClick={onClose}
          title="Collapse note pane (⌘⇧N)"
          aria-label="Collapse note pane"
        >
          ›
        </button>
      </div>

      {/* ── Tiptap editor ───────────────────────────────────────────────────── */}
      <EditorContent editor={editor} className="mm-note-pane__editor" />

      {/* ── Footer hint ─────────────────────────────────────────────────────── */}
      <div className="mm-note-pane__footer">
        <kbd>⌘⇧N</kbd> collapse &nbsp;·&nbsp; auto-saves on close
      </div>
    </motion.div>
  );
};
