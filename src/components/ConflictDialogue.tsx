/**
 * ConflictDialogue.tsx
 *
 * Modal shown when the file watcher detects that an open note was modified
 * on disk by an external process (e.g. another editor or a sync daemon).
 *
 * Three resolution paths:
 *   1. Reload from disk  — discard local edits, adopt the on-disk version.
 *   2. Keep local        — overwrite the on-disk version with local state.
 *   3. Dismiss           — do nothing for now (conflict state persists).
 */

import React from 'react';
import { motion, AnimatePresence } from 'framer-motion';

export interface ConflictInfo {
  noteId: string;
  noteTitle: string;
  absPath: string;
}

interface ConflictDialogueProps {
  conflict: ConflictInfo | null;
  onReload: (noteId: string) => void;
  onKeepLocal: (noteId: string) => void;
  onDismiss: () => void;
}

const ConflictDialogue = ({
  conflict,
  onReload,
  onKeepLocal,
  onDismiss,
}: ConflictDialogueProps) => (
  <AnimatePresence>
    {conflict && (
      <>
        {/* Backdrop */}
        <motion.div
          key='backdrop'
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.18 }}
          onClick={onDismiss}
          style={{
            position:   'fixed',
            inset:      0,
            background: 'rgba(0, 0, 0, 0.35)',
            zIndex:     9000,
          }}
        />

        {/* Dialogue card */}
        <motion.div
          key='dialogue'
          initial={{ opacity: 0, y: -16, scale: 0.96 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: -8, scale: 0.97 }}
          transition={{ type: 'spring', stiffness: 380, damping: 32 }}
          style={{
            position:     'fixed',
            top:          '50%',
            left:         '50%',
            transform:    'translate(-50%, -50%)',
            zIndex:       9001,
            background:   'var(--card)',
            border:       '0.5px solid var(--border)',
            borderRadius: 14,
            padding:      '22px 24px 20px',
            width:        360,
            boxShadow:    '0 8px 48px rgba(0, 0, 0, 0.22)',
            fontFamily:   'var(--font-ui)',
          }}
        >
          <div
            style={{
              fontSize:     13,
              fontWeight:   600,
              color:        'var(--strong)',
              marginBottom: 6,
            }}
          >
            External change detected
          </div>

          <div
            style={{
              fontSize:     11,
              color:        'var(--muted)',
              marginBottom: 18,
              lineHeight:   1.65,
            }}
          >
            <strong style={{ color: 'var(--text)' }}>
              &ldquo;{conflict.noteTitle}&rdquo;
            </strong>{' '}
            was modified on disk by another process. How would you like to proceed?
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <button
              type='button'
              className='conflict-btn conflict-btn--primary'
              onClick={() => onReload(conflict.noteId)}
            >
              Reload from disk
            </button>
            <button
              type='button'
              className='conflict-btn conflict-btn--secondary'
              onClick={() => onKeepLocal(conflict.noteId)}
            >
              Keep my local version
            </button>
            <button
              type='button'
              className='conflict-btn conflict-btn--ghost'
              onClick={onDismiss}
            >
              Dismiss
            </button>
          </div>
        </motion.div>
      </>
    )}
  </AnimatePresence>
);

export default ConflictDialogue;
