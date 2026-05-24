/**
 * noteDrag.ts
 *
 * Shared state for the drag-a-note-into-a-pocket interaction.
 *
 * Architecture:
 *   • ghostX / ghostY — framer-motion MotionValues so the DragGhost component
 *     can track the cursor position at 60 fps without React re-renders.
 *   • useNoteDrag    — tiny Zustand store for the logical drag state (which note
 *     is being dragged, which pocket is currently targeted).
 *
 * Both are module-level singletons so NoteCard, Sidebar, and DragGhost can
 * all share them without prop-drilling.
 */

import { motionValue }  from 'framer-motion';
import { create }       from 'zustand';

// ── Ghost position ────────────────────────────────────────────────────────────

/** Screen-space x coordinate of the drag ghost, updated every pointermove. */
export const ghostX = motionValue(0);
/** Screen-space y coordinate of the drag ghost, updated every pointermove. */
export const ghostY = motionValue(0);

// ── Drag state ────────────────────────────────────────────────────────────────

export interface DraggingNote {
  noteId:  string;
  title:   string;
  emoji?:  string;
  folder:  string; // current folder — used to skip no-op drops
}

interface NoteDragStore {
  dragging:         DraggingNote | null;
  /** The pocket id currently hovered during drag.  null = not over any target.
   *  '' = the "All Notes" target (moves note to root folder). */
  hoveredPocketId:  string | null;
  setDragging:      (d: DraggingNote | null) => void;
  setHoveredPocket: (id: string | null) => void;
}

export const useNoteDrag = create<NoteDragStore>((set) => ({
  dragging:         null,
  hoveredPocketId:  null,
  setDragging:      (dragging)        => set({ dragging }),
  setHoveredPocket: (hoveredPocketId) => set({ hoveredPocketId }),
}));
