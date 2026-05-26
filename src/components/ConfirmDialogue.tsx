/**
 * ConfirmDialogue.tsx
 *
 * Generic confirmation modal for destructive actions.
 *
 * Props
 * ─────
 *   open         — controls visibility (AnimatePresence handles the exit animation)
 *   title        — short header text (e.g. "Reset board?")
 *   message      — explanatory body copy
 *   confirmLabel — label for the confirm / destructive button (e.g. "Yes, reset")
 *   onConfirm    — called when the user commits to the action
 *   onCancel     — called when the user dismisses (backdrop click, Cancel, Escape)
 *   danger       — when true the confirm button renders in the danger / red accent
 *
 * Styling intentionally mirrors QuitDialogue — same palette, same spring
 * animation, same button classes — so both dialogues feel cohesive.
 *
 * British English spelling maintained throughout.
 */

import React, { useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';

interface ConfirmDialogueProps {
  open:         boolean;
  title:        string;
  message:      string;
  confirmLabel: string;
  onConfirm:    () => void;
  onCancel:     () => void;
  /** When true the confirm button renders with a red / destructive accent. */
  danger?:      boolean;
}

const ConfirmDialogue = ({
  open,
  title,
  message,
  confirmLabel,
  onConfirm,
  onCancel,
  danger = false,
}: ConfirmDialogueProps) => {
  // Close on Escape so keyboard-first users can bail out without a mouse click.
  useEffect(() => {
    if (!open) return;
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onCancel();
      }
    };
    window.addEventListener('keydown', handleKey, { capture: true });
    return () => window.removeEventListener('keydown', handleKey, { capture: true });
  }, [open, onCancel]);

  return (
    <AnimatePresence>
      {open && (
        <>
          {/* Backdrop */}
          <motion.div
            key='confirm-backdrop'
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            onClick={onCancel}
            style={{
              position:   'fixed',
              inset:      0,
              background: 'rgba(0, 0, 0, 0.22)',
              zIndex:     9000,
            }}
          />

          {/* Card */}
          <motion.div
            key='confirm-dialogue'
            role='alertdialog'
            aria-modal='true'
            aria-labelledby='confirm-title'
            aria-describedby='confirm-body'
            initial={{ opacity: 0, y: -14, scale: 0.95 }}
            animate={{ opacity: 1, y: 0,   scale: 1    }}
            exit={{ opacity: 0,    y: -8,  scale: 0.97 }}
            transition={{ type: 'spring', stiffness: 360, damping: 30 }}
            style={{
              position:     'fixed',
              top:          '50%',
              left:         '50%',
              transform:    'translate(-50%, -50%)',
              zIndex:       9001,
              background:   'var(--card)',
              border:       '0.5px solid var(--border)',
              borderRadius: 18,
              padding:      '30px 28px 24px',
              width:        320,
              boxShadow:    '0 8px 56px rgba(0, 0, 0, 0.14), 0 2px 8px rgba(0, 0, 0, 0.06)',
              fontFamily:   'var(--font-ui)',
              textAlign:    'center',
            }}
          >
            {/* Decorative mark — red when danger, primary otherwise */}
            <div
              aria-hidden='true'
              style={{
                fontSize:      20,
                color:         danger ? 'var(--danger, #e05252)' : 'var(--primary)',
                marginBottom:  16,
                letterSpacing: 2,
                opacity:       0.85,
              }}
            >
              {danger ? '⚠' : '✦'}
            </div>

            {/* Title */}
            <div
              id='confirm-title'
              style={{
                fontSize:     13,
                fontWeight:   600,
                color:        'var(--strong)',
                marginBottom: 9,
              }}
            >
              {title}
            </div>

            {/* Body */}
            <div
              id='confirm-body'
              style={{
                fontSize:     11.5,
                color:        'var(--muted)',
                lineHeight:   1.72,
                marginBottom: 22,
              }}
            >
              {message}
            </div>

            {/* Actions */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
              <button
                type='button'
                className={
                  danger
                    ? 'conflict-btn conflict-btn--danger'
                    : 'conflict-btn conflict-btn--primary'
                }
                onClick={onConfirm}
                autoFocus
              >
                {confirmLabel}
              </button>

              <button
                type='button'
                className='conflict-btn conflict-btn--ghost'
                onClick={onCancel}
              >
                Cancel
              </button>
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
};

export default ConfirmDialogue;
