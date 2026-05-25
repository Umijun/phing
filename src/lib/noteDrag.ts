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
  kind:    'note';
  noteId:  string;
  title:   string;
  emoji?:  string;
  /** Current folder — used to skip no-op drops. */
  folder:  string;
}

export interface DraggingBoard {
  kind:    'board';
  boardId: string;
  title:   string;
  /** Current folder — used to skip no-op drops. */
  folder:  string;
}

/** Union of every item type that can be dragged into a Pocket. */
export type DraggingItem = DraggingNote | DraggingBoard;

interface NoteDragStore {
  dragging:         DraggingItem | null;
  /** The pocket id currently hovered during drag.  null = not over any target.
   *  '' = the "All Notes" target (moves note/board to root folder). */
  hoveredPocketId:  string | null;
  setDragging:      (d: DraggingItem | null) => void;
  setHoveredPocket: (id: string | null) => void;
}

export const useNoteDrag = create<NoteDragStore>((set) => ({
  dragging:         null,
  hoveredPocketId:  null,
  setDragging:      (dragging)        => set({ dragging }),
  setHoveredPocket: (hoveredPocketId) => set({ hoveredPocketId }),
}));
