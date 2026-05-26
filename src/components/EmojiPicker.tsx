/**
 * EmojiPicker.tsx
 *
 * A self-contained floating emoji picker.
 *
 * Architecture notes:
 *   - The popover renders via ReactDOM.createPortal at document.body so it
 *     escapes any overflow:hidden or backdrop-filter stacking context in the
 *     sidebar or file-tree containers.
 *   - Position is calculated from the trigger button's getBoundingClientRect()
 *     and clamped to the viewport right-edge so the picker never runs off screen.
 *   - 220ms ease-out Framer Motion animation consistent with the rest of Phing.
 *   - Closes on Escape, on outside mousedown, or on emoji selection.
 */

import React, { useEffect, useRef, useState } from 'react';
import ReactDOM from 'react-dom';
import { AnimatePresence, motion } from 'framer-motion';
import { EMOJI_GROUPS } from '../lib/emojiPicker';

// ─── Width of the popover in px (used for right-edge clamping) ─────────────
const POPOVER_W = 222;

// ─── Props ─────────────────────────────────────────────────────────────────

interface EmojiPickerProps {
  /** Currently selected emoji — shown on the trigger button. */
  emoji?: string;
  /**
   * Fallback icon displayed when no emoji is set.
   * Use '📂' for pockets / folders and '📄' for notes.
   */
  defaultEmoji?: string;
  /** Called with the chosen emoji; picker closes automatically. */
  onSelect: (emoji: string) => void;
  /** Extra class names for the trigger button. */
  className?: string;
  /**
   * Renders a larger trigger (22 px emoji) suitable for the note-title row.
   * Defaults to false (13 px — compact sidebar / file-tree size).
   */
  large?: boolean;
}

// ─── Component ──────────────────────────────────────────────────────────────

const EmojiPicker = ({
  emoji,
  defaultEmoji = '📂',
  onSelect,
  className,
  large = false,
}: EmojiPickerProps) => {
  const [open, setOpen] = useState(false);
  const [pos,  setPos]  = useState({ top: 0, left: 0 });

  const triggerRef = useRef<HTMLButtonElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);

  // ── Open / position ────────────────────────────────────────────────────
  const openPicker = (e: React.MouseEvent) => {
    e.stopPropagation();
    const rect = triggerRef.current?.getBoundingClientRect();
    if (!rect) return;
    const left = Math.min(rect.left, window.innerWidth - POPOVER_W - 8);
    setPos({ top: rect.bottom + 6, left });
    setOpen((prev) => !prev);
  };

  // ── Close on outside click ──────────────────────────────────────────────
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (
        !popoverRef.current?.contains(e.target as Node) &&
        !triggerRef.current?.contains(e.target as Node)
      ) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open]);

  // ── Close on Escape ────────────────────────────────────────────────────
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open]);

  // ── Select ─────────────────────────────────────────────────────────────
  const handleSelect = (em: string) => {
    onSelect(em);
    setOpen(false);
  };

  // ── Render ─────────────────────────────────────────────────────────────
  const triggerClass = [
    'emoji-trigger',
    large     ? 'emoji-trigger--lg' : '',
    className ?? '',
  ].filter(Boolean).join(' ');

  return (
    <>
      {/* Trigger button */}
      <button
        ref={triggerRef}
        type="button"
        onClick={openPicker}
        title="Choose emoji"
        className={triggerClass}
        // Prevent the folder-row click (expand/collapse) from also firing.
        onPointerDown={(e) => e.stopPropagation()}
      >
        {emoji ?? defaultEmoji}
      </button>

      {/* Floating popover — rendered at document.body via portal */}
      {typeof document !== 'undefined' &&
        ReactDOM.createPortal(
          <AnimatePresence>
            {open && (
              <motion.div
                ref={popoverRef}
                className="emoji-popover"
                style={{ top: pos.top, left: pos.left }}
                initial={{ opacity: 0, scale: 0.93, y: -8 }}
                animate={{ opacity: 1, scale: 1,    y: 0  }}
                exit={   { opacity: 0, scale: 0.93, y: -8 }}
                transition={{ duration: 0.22, ease: [0.4, 0, 0.2, 1] }}
              >
                {EMOJI_GROUPS.map((group, gi) => (
                  <div
                    key={group.label}
                    className={gi > 0 ? 'emoji-section emoji-section--sep' : 'emoji-section'}
                  >
                    <div className="emoji-section__label">{group.label}</div>
                    <div className="emoji-grid">
                      {group.emojis.map((em) => (
                        <button
                          key={em}
                          type="button"
                          className={`emoji-item${em === emoji ? ' emoji-item--active' : ''}`}
                          onClick={() => handleSelect(em)}
                          title={em}
                        >
                          {em}
                        </button>
                      ))}
                    </div>
                  </div>
                ))}
              </motion.div>
            )}
          </AnimatePresence>,
          document.body,
        )}
    </>
  );
};

export default EmojiPicker;
