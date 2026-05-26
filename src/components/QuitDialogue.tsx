/**
 * QuitDialogue.tsx
 *
 * Shown when the user tries to quit (× button or Cmd+Q) while there are
 * unsaved changes in the note editor or mind-map board.
 *
 * Three resolution paths:
 *   1. Save & Quit  — flush all pending writes, then destroy the window.
 *   2. Discard      — destroy the window immediately without flushing.
 *   3. Cancel       — dismiss the dialogue and let the user continue.
 *
 * Styling follows the Taro Mochi / Midnight Snow palette via CSS variables so
 * it adapts to light and dark mode automatically.
 *
 * British English spelling maintained throughout.
 */

import React from 'react';
import { motion, AnimatePresence } from 'framer-motion';

interface QuitDialogueProps {
  open:          boolean;
  onSaveAndQuit: () => void;
  onDiscard:     () => void;
  onCancel:      () => void;
}

const QuitDialogue = ({
  open,
  onSaveAndQuit,
  onDiscard,
  onCancel,
}: QuitDialogueProps) => (
  <AnimatePresence>
    {open && (
      <>
        {/* Backdrop — lighter than the conflict dialogue; less alarming */}
        <motion.div
          key='quit-backdrop'
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
          key='quit-dialogue'
          role='alertdialog'
          aria-modal='true'
          aria-labelledby='quit-title'
          aria-describedby='quit-body'
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
          {/* Soft decorative mark */}
          <div
            aria-hidden='true'
            style={{
              fontSize:     20,
              color:        'var(--primary)',
              marginBottom: 16,
              letterSpacing: 2,
              opacity:      0.85,
            }}
          >
            ✦
          </div>

          {/* Title */}
          <div
            id='quit-title'
            style={{
              fontSize:     13,
              fontWeight:   600,
              color:        'var(--strong)',
              marginBottom: 9,
            }}
          >
            Unsaved thoughts
          </div>

          {/* Body */}
          <div
            id='quit-body'
            style={{
              fontSize:     11.5,
              color:        'var(--muted)',
              lineHeight:   1.72,
              marginBottom: 22,
            }}
          >
            You have unsaved thoughts.
            <br />
            Would you like to save them before leaving?
          </div>

          {/* Actions — stacked, most encouraged first */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
            <button
              type='button'
              className='conflict-btn conflict-btn--primary'
              onClick={onSaveAndQuit}
              autoFocus
            >
              Save &amp; Quit
            </button>

            <button
              type='button'
              className='conflict-btn conflict-btn--secondary'
              onClick={onDiscard}
            >
              Discard
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

export default QuitDialogue;
