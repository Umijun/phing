/**
 * DragGhost.tsx
 *
 * A small "folded paper" that follows the cursor while a note is being dragged
 * to a pocket.  Rendered into document.body via a React portal so it floats
 * above every panel — completely outside the normal layout tree.
 *
 * Visuals:
 *   • Idle drag  — paper tilted 2 °, soft shadow
 *   • Over target — paper tilts to 6 °, scales down slightly (being pulled in)
 *   • Enter       — springs in from scale 0
 *   • Exit        — collapses to scale 0 (disappears into the pocket)
 */

import { createPortal }         from 'react-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { ghostX, ghostY, useNoteDrag } from '../lib/noteDrag';

const DragGhost = () => {
  const dragging        = useNoteDrag((s) => s.dragging);
  const hoveredPocketId = useNoteDrag((s) => s.hoveredPocketId);
  const isOverTarget    = hoveredPocketId !== null;

  return createPortal(
    <AnimatePresence>
      {dragging && (
        <motion.div
          // Position follows the cursor via MotionValues — no React re-render.
          style={{
            position:    'fixed',
            left:        0,
            top:         0,
            x:           ghostX,
            y:           ghostY,
            translateX:  '-50%',
            translateY:  '-60%',    // slightly above the finger / cursor tip
            pointerEvents: 'none',  // must not intercept pointer events
            zIndex:      9999,
          }}
          // ── Enter spring ──────────────────────────────────────────────────
          initial={{ scale: 0, opacity: 0, rotate: -6 }}
          // ── Idle vs. over-target ──────────────────────────────────────────
          animate={isOverTarget
            ? { scale: 0.88, opacity: 1, rotate: 6 }   // being pulled in
            : { scale: 1,    opacity: 1, rotate: 2 }   // floating freely
          }
          // ── Exit — collapses away as if dropped ───────────────────────────
          exit={{ scale: 0, opacity: 0, rotate: 10,
                  transition: { type: 'spring', stiffness: 600, damping: 28 } }}
          transition={{ type: 'spring', stiffness: 520, damping: 30 }}
        >
          <div className="drag-ghost__paper">
            {/* Paper fold corner */}
            <div className="drag-ghost__fold" />

            {/* Content */}
            <div className="drag-ghost__body">
              <span className="drag-ghost__icon">
                {dragging.emoji ?? '📄'}
              </span>
              <span className="drag-ghost__title">
                {dragging.title}
              </span>
            </div>

            {/* Hint label that appears when hovering a pocket */}
            <AnimatePresence>
              {isOverTarget && (
                <motion.div
                  className="drag-ghost__hint"
                  initial={{ opacity: 0, y: 4 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{    opacity: 0, y: 4 }}
                  transition={{ duration: 0.14 }}
                >
                  drop here ✦
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        </motion.div>
      )}
    </AnimatePresence>,
    document.body,
  );
};

export default DragGhost;
