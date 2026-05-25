/**
 * MindMapBoard.tsx
 * Top-level board view.  Mind maps are now first-class documents — the left
 * sidebar lists all maps (similar to NoteList), and the right area renders the
 * selected map on a React Flow canvas.
 *
 * British English spelling maintained throughout.
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  ReactFlow,
  Background,
  BackgroundVariant,
  Controls,
  type Node,
  type Edge,
  type NodeTypes,
  type EdgeTypes,
  getBezierPath,
  BaseEdge,
  type EdgeProps,
  useReactFlow,
  ReactFlowProvider,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';

import { useMindMapStore, type MindMapDoc } from '../store/mindMapStore';
import { useNoteStore, type Pocket } from '../store/noteStore';
import { calculateLayout, saveMindMapToFile, findNode, type LayoutNode } from '../lib/mindmap';
import { MindMapNode, type MindMapNodeData } from './MindMapNode';
import { MindMapNotePane } from './MindMapNotePane';

// ─── Custom bezier edge ──────────────────────────────────────────────────────

const MindMapEdge = ({
  sourceX, sourceY, targetX, targetY,
  sourcePosition, targetPosition,
}: EdgeProps) => {
  const [edgePath] = getBezierPath({ sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition });
  return (
    <BaseEdge
      path={edgePath}
      style={{ stroke: 'var(--primary)', strokeOpacity: 0.38, strokeWidth: 1.8, fill: 'none' }}
    />
  );
};

// ─── Stable node / edge type maps ────────────────────────────────────────────

const nodeTypes: NodeTypes = { mindMapNode: MindMapNode };
const edgeTypes: EdgeTypes = { mindMapEdge: MindMapEdge };
const PANEL_TRANSITION_MS = 320;

const nodeCentreY = (node: LayoutNode) => node.y + node.height / 2;

const closestNodeByY = (candidates: LayoutNode[], targetY: number): LayoutNode | null => {
  if (!candidates.length) return null;
  return candidates.reduce((closest, node) => {
    const closestDelta = Math.abs(nodeCentreY(closest) - targetY);
    const nodeDelta = Math.abs(nodeCentreY(node) - targetY);
    if (nodeDelta !== closestDelta) return nodeDelta < closestDelta ? node : closest;
    return nodeCentreY(node) < nodeCentreY(closest) ? node : closest;
  });
};

// ─── Mind Map list sidebar ────────────────────────────────────────────────────

interface MindMapListProps {
  mindMaps:         MindMapDoc[];
  selectedId:       string | null;
  pocketFilter:     string;
  onSelect:         (id: string) => void;
  onCreate:         () => void;
  onDelete:         (id: string) => void;
  onRename:         (id: string, title: string) => void;
}

const MindMapList = ({
  mindMaps,
  selectedId,
  pocketFilter,
  onSelect,
  onCreate,
  onDelete,
  onRename,
}: MindMapListProps) => {
  const [editingId,  setEditingId]  = useState<string | null>(null);
  const [draftTitle, setDraftTitle] = useState('');
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const filtered = pocketFilter === '*'
    ? mindMaps
    : mindMaps.filter((m) => m.folder === pocketFilter);

  const startRename = (doc: MindMapDoc, e: React.MouseEvent) => {
    e.stopPropagation();
    setDraftTitle(doc.title);
    setEditingId(doc.id);
    setTimeout(() => inputRef.current?.focus(), 40);
  };

  const commitRename = () => {
    if (editingId && draftTitle.trim()) onRename(editingId, draftTitle.trim());
    setEditingId(null);
    setDraftTitle('');
  };

  const handleDelete = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (deletingId === id) {
      onDelete(id);
      setDeletingId(null);
    } else {
      setDeletingId(id);
      setTimeout(() => setDeletingId((d) => d === id ? null : d), 3000);
    }
  };

  return (
    <div
      className="mm-list"
      style={{
        display: 'flex',
        flexDirection: 'column',
        height: '100%',
        overflow: 'hidden',
      }}
    >
      {/* Header */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '12px 14px 10px',
          borderBottom: '0.5px solid var(--divider)',
          flexShrink: 0,
        }}
      >
        <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--primary)', letterSpacing: '0.3px' }}>
          ✦ Mind Maps
        </span>
        <motion.button
          type="button"
          whileHover={{ background: 'var(--primary-g)', scale: 1.05 }}
          whileTap={{ scale: 0.95 }}
          onClick={onCreate}
          title="New mind map"
          style={{
            border: '0.5px solid var(--primary)',
            background: 'var(--primary-s)',
            color: 'var(--primary)',
            borderRadius: 100,
            padding: '3px 10px',
            fontSize: 9,
            fontWeight: 700,
            cursor: 'pointer',
            fontFamily: 'var(--font-ui)',
            letterSpacing: '0.2px',
          }}
        >
          + New
        </motion.button>
      </div>

      {/* Map list */}
      <div style={{ flex: 1, overflowY: 'auto', overflowX: 'hidden', padding: '8px 6px' }}>
        {filtered.length === 0 && (
          <div style={{ fontSize: 11, color: 'var(--soft)', fontStyle: 'italic', padding: '16px 10px', textAlign: 'center' }}>
            No maps yet
          </div>
        )}
        <AnimatePresence initial={false}>
          {filtered.map((doc) => (
            <motion.div
              key={doc.id}
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: 'auto' }}
              exit={{ opacity: 0, height: 0 }}
              transition={{ duration: 0.18 }}
              style={{ overflow: 'hidden' }}
            >
              <motion.div
                whileHover={{ background: 'var(--primary-s)' }}
                onClick={() => onSelect(doc.id)}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                  padding: '7px 10px',
                  borderRadius: 10,
                  cursor: 'pointer',
                  marginBottom: 2,
                  background: doc.id === selectedId ? 'var(--primary-s)' : 'transparent',
                  borderLeft: doc.id === selectedId ? '2px solid var(--primary)' : '2px solid transparent',
                  transition: 'background 0.15s',
                  position: 'relative',
                }}
                className="mm-list-item"
              >
                {/* Inline rename input */}
                {editingId === doc.id ? (
                  <input
                    ref={inputRef}
                    value={draftTitle}
                    onChange={(e) => setDraftTitle(e.target.value)}
                    onBlur={commitRename}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') { e.preventDefault(); commitRename(); }
                      if (e.key === 'Escape') { setEditingId(null); }
                    }}
                    onClick={(e) => e.stopPropagation()}
                    style={{
                      flex: 1,
                      fontSize: 11,
                      fontFamily: 'var(--font-ui)',
                      border: 'none',
                      outline: '1.5px solid var(--primary)',
                      borderRadius: 6,
                      padding: '2px 6px',
                      background: 'var(--card)',
                      color: 'var(--strong)',
                    }}
                  />
                ) : (
                  <>
                    <span style={{ fontSize: 12, flexShrink: 0 }}>✦</span>
                    <span
                      style={{
                        flex: 1,
                        fontSize: 11,
                        color: doc.id === selectedId ? 'var(--primary)' : 'var(--muted)',
                        fontWeight: doc.id === selectedId ? 600 : 400,
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                      }}
                    >
                      {doc.title}
                    </span>
                    {/* Rename button */}
                    <motion.button
                      type="button"
                      onClick={(e) => startRename(doc, e)}
                      whileHover={{ color: 'var(--primary)' }}
                      className="mm-list-action"
                      style={{
                        border: 'none',
                        background: 'transparent',
                        cursor: 'pointer',
                        fontSize: 9,
                        color: 'var(--soft)',
                        padding: '2px 4px',
                        borderRadius: 4,
                        flexShrink: 0,
                        fontFamily: 'var(--font-ui)',
                      }}
                      title="Rename"
                    >
                      ✎
                    </motion.button>
                    {/* Delete button */}
                    <motion.button
                      type="button"
                      onClick={(e) => handleDelete(doc.id, e)}
                      whileHover={{ background: 'rgba(255,82,82,0.12)', color: '#FF5252' }}
                      className="mm-list-action"
                      style={{
                        border: 'none',
                        background: deletingId === doc.id ? 'rgba(255,82,82,0.12)' : 'transparent',
                        color: deletingId === doc.id ? '#FF5252' : 'var(--soft)',
                        cursor: 'pointer',
                        fontSize: 9,
                        fontWeight: 700,
                        padding: '2px 4px',
                        borderRadius: 4,
                        flexShrink: 0,
                        fontFamily: 'var(--font-ui)',
                      }}
                      title={deletingId === doc.id ? 'Click again to delete' : 'Delete'}
                    >
                      {deletingId === doc.id ? 'del?' : '✕'}
                    </motion.button>
                  </>
                )}
              </motion.div>
            </motion.div>
          ))}
        </AnimatePresence>
      </div>
    </div>
  );
};

// ─── Pocket filter dropdown ───────────────────────────────────────────────────

interface PocketFilterProps {
  pockets: Pocket[];
  active:  string;
  onChange:(id: string) => void;
}

const PocketFilterDropdown = ({ pockets, active, onChange }: PocketFilterProps) => {
  const [open, setOpen] = useState(false);
  const containerRef    = useRef<HTMLDivElement>(null);

  // Close when the user clicks anywhere outside the dropdown
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as HTMLElement)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  const activeLabel = (() => {
    if (active === '*') return '≡ All';
    if (active === '') return '◯ Root';
    const p = pockets.find((pk) => pk.id === active);
    return p ? `${p.emoji ?? ''} ${p.name}`.trim() : '≡ All';
  })();

  const options = [
    { id: '*', label: '≡ All',  color: undefined },
    { id: '',  label: '◯ Root', color: undefined },
    ...pockets.map((p) => ({ id: p.id, label: `${p.emoji ?? ''} ${p.name}`.trim(), color: p.color })),
  ];

  return (
    <div
      ref={containerRef}
      style={{ padding: '6px 10px', borderBottom: '0.5px solid var(--divider)', flexShrink: 0, position: 'relative' }}
    >
      {/* Trigger — shows the active filter label */}
      <motion.button
        type="button"
        onClick={() => setOpen((v) => !v)}
        whileHover={{ background: 'var(--primary-s)' }}
        style={{
          display:        'flex',
          alignItems:     'center',
          justifyContent: 'space-between',
          width:          '100%',
          border:         '0.5px solid var(--border)',
          background:     open ? 'var(--primary-s)' : 'var(--card)',
          color:          open ? 'var(--primary)' : 'var(--muted)',
          borderRadius:   8,
          padding:        '5px 10px',
          fontSize:       10,
          fontWeight:     600,
          cursor:         'pointer',
          fontFamily:     'var(--font-ui)',
          letterSpacing:  '0.2px',
          transition:     'background 0.15s, color 0.15s',
        }}
      >
        <span>{activeLabel}</span>
        <motion.span
          animate={{ rotate: open ? 180 : 0 }}
          transition={{ duration: 0.18, ease: [0.4, 0, 0.2, 1] }}
          style={{ opacity: 0.55, fontSize: 8, display: 'flex', alignItems: 'center' }}
        >
          ▾
        </motion.span>
      </motion.button>

      {/* Frosted-glass dropdown — GPU-accelerated via transform + opacity */}
      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, scale: 0.95, y: -6 }}
            animate={{ opacity: 1, scale: 1,    y: 0  }}
            exit={{    opacity: 0, scale: 0.95, y: -6 }}
            transition={{ duration: 0.14, ease: [0.4, 0, 0.2, 1] }}
            style={{
              position:             'absolute',
              top:                  'calc(100% + 4px)',
              left:                 10,
              right:                10,
              zIndex:               50,
              background:           'var(--card)',
              backdropFilter:       'blur(24px)',
              WebkitBackdropFilter: 'blur(24px)',
              border:               '0.5px solid var(--border)',
              borderRadius:         12,
              boxShadow:            '0 8px 28px rgba(0,0,0,0.1), 0 2px 8px rgba(0,0,0,0.06)',
              padding:              '4px',
              transformOrigin:      'top center',
            }}
          >
            {options.map((opt) => (
              <motion.button
                key={opt.id}
                type="button"
                whileHover={{ background: 'var(--primary-s)', color: 'var(--primary)' }}
                onClick={() => { onChange(opt.id); setOpen(false); }}
                style={{
                  display:      'flex',
                  alignItems:   'center',
                  gap:          6,
                  width:        '100%',
                  border:       'none',
                  background:   active === opt.id ? 'var(--primary-g)' : 'transparent',
                  color:        active === opt.id ? 'var(--primary)' : 'var(--muted)',
                  borderRadius: 8,
                  padding:      '5px 8px',
                  fontSize:     10,
                  fontWeight:   active === opt.id ? 700 : 400,
                  cursor:       'pointer',
                  fontFamily:   'var(--font-ui)',
                  textAlign:    'left',
                }}
              >
                {opt.color && (
                  <span style={{
                    display: 'inline-block', width: 5, height: 5,
                    borderRadius: '50%', background: opt.color, flexShrink: 0,
                  }} />
                )}
                {opt.label}
              </motion.button>
            ))}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};

// ─── Inner board (needs ReactFlow context) ───────────────────────────────────

const BoardInner = () => {
  // ── Store selectors ─────────────────────────────────────────────────────────
  const mindMaps         = useMindMapStore((s) => s.mindMaps);
  const selectedMapId    = useMindMapStore((s) => s.selectedMindMapId);
  const tree             = useMindMapStore((s) => s.activeTree());
  const selectedId       = useMindMapStore((s) => s.selectedId);
  const editingId        = useMindMapStore((s) => s.editingId);
  const notePopupId      = useMindMapStore((s) => s.notePopupId);
  const setSelected      = useMindMapStore((s) => s.setSelected);
  const startEditing     = useMindMapStore((s) => s.startEditing);
  const addChild         = useMindMapStore((s) => s.addChild);
  const addSibling       = useMindMapStore((s) => s.addSibling);
  const deleteSelected   = useMindMapStore((s) => s.deleteSelected);
  const resetBoard       = useMindMapStore((s) => s.resetBoard);
  const openNote         = useMindMapStore((s) => s.openNote);
  const closeNote        = useMindMapStore((s) => s.closeNote);
  const updateNote       = useMindMapStore((s) => s.updateNote);
  const selectMindMap    = useMindMapStore((s) => s.selectMindMap);
  const createMindMap    = useMindMapStore((s) => s.createMindMap);
  const deleteMindMap    = useMindMapStore((s) => s.deleteMindMap);
  const renameMindMap    = useMindMapStore((s) => s.renameMindMap);

  const pockets = useNoteStore((s) => s.pockets);
  const isDark  = useNoteStore((s) => s.isDark);
  const isSidebarOpen = useNoteStore((s) => s.isSidebarOpen);
  const { fitView, setCenter } = useReactFlow();

  const boardRef            = useRef<HTMLDivElement>(null);
  const prevEditingRef      = useRef<string | null>(null);
  const prevNotePopupRef    = useRef<string | null>(null);
  // Set to true for 300 ms after inline label editing ends so that a held
  // Enter key does not immediately trigger "add sibling" on the board.
  const editJustCommittedRef = useRef(false);

  const [pocketFilter, setPocketFilter] = useState<string>('*');

  // ── Focus helper ─────────────────────────────────────────────────────────────
  const focusBoard = useCallback(() => {
    requestAnimationFrame(() =>
      requestAnimationFrame(() => boardRef.current?.focus({ preventScroll: true }))
    );
  }, []);

  // ── Convert tree → React Flow nodes & edges ───────────────────────────────
  const layout = useMemo(() => calculateLayout(tree), [tree]);

  const layoutById = useMemo(
    () => new Map(layout.nodes.map((node) => [node.id, node])),
    [layout],
  );

  const { nodes, edges } = useMemo<{ nodes: Node[]; edges: Edge[] }>(() => {
    return {
      nodes: layout.nodes.map((n) => ({
        id:       n.id,
        type:     'mindMapNode',
        position: { x: n.x, y: n.y },
        data: {
          label:     n.label,
          depth:     n.depth,
          hasNote:   !!(n.noteContent?.trim()),
          direction: n.direction,
        } satisfies MindMapNodeData,
        selected:   n.id === selectedId,
        draggable:  false,
        selectable: true,
        width:      n.width,
        height:     n.height,
      })),
      edges: layout.edges.map((e) => ({
        id:           e.id,
        source:       e.sourceId,
        target:       e.targetId,
        type:         'mindMapEdge',
        focusable:    false,
        // Connect the correct named handles so left-side edges curve rightward
        // and right-side edges curve leftward — matching the bi-directional layout.
        sourceHandle: e.direction === 'left' ? 'source-left'  : 'source-right',
        targetHandle: e.direction === 'left' ? 'target-right' : 'target-left',
      })),
    };
  }, [layout, selectedId]);

  const closestVisualChildId = useCallback(
    (nodeId: string, direction?: 'left' | 'right') => {
      const parent = layoutById.get(nodeId);
      if (!parent) return null;
      const children = layout.nodes.filter((node) =>
        node.parentId === nodeId && (!direction || node.direction === direction),
      );
      return closestNodeByY(children, nodeCentreY(parent))?.id ?? null;
    },
    [layout, layoutById],
  );

  const visualSiblingId = useCallback(
    (nodeId: string, move: 'up' | 'down') => {
      const current = layoutById.get(nodeId);
      if (!current?.parentId) return null;

      const currentY = nodeCentreY(current);
      const siblings = layout.nodes
        .filter((node) =>
          node.parentId === current.parentId &&
          node.direction === current.direction &&
          node.id !== nodeId,
        )
        .filter((node) => move === 'up'
          ? nodeCentreY(node) < currentY
          : nodeCentreY(node) > currentY,
        )
        .sort((a, b) => move === 'up'
          ? nodeCentreY(b) - nodeCentreY(a)
          : nodeCentreY(a) - nodeCentreY(b),
        );

      return siblings[0]?.id ?? null;
    },
    [layout, layoutById],
  );

  // ── Pan viewport to newly selected node ───────────────────────────────────
  useEffect(() => {
    if (!selectedId) return;
    const n = layoutById.get(selectedId);
    if (!n) return;
    setCenter(n.x + n.width / 2, n.y + n.height / 2, { duration: 320, zoom: 1 });
  }, [selectedId, layoutById]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Initial fit-view + root selection ─────────────────────────────────────
  useEffect(() => {
    setTimeout(() => fitView({ padding: 0.35, duration: 400 }), 80);
    if (tree.id) setSelected(tree.id);
    focusBoard();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Fit view when selected map changes ────────────────────────────────────
  useEffect(() => {
    setTimeout(() => fitView({ padding: 0.35, duration: 400 }), 80);
    focusBoard();
  }, [selectedMapId]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Keep React Flow centred while side panels animate ─────────────────────
  useEffect(() => {
    const startedAt = performance.now();
    let raf = 0;

    const refitDuringPanelMotion = () => {
      fitView({ padding: 0.35, duration: 0 });
      if (performance.now() - startedAt < PANEL_TRANSITION_MS) {
        raf = requestAnimationFrame(refitDuringPanelMotion);
      } else {
        fitView({ padding: 0.35, duration: 180 });
      }
    };

    raf = requestAnimationFrame(refitDuringPanelMotion);
    return () => cancelAnimationFrame(raf);
  }, [notePopupId, isSidebarOpen, fitView]);

  // ── Refocus board after inline label editing ends ─────────────────────────
  // Also sets a brief cooldown so a held Enter key doesn't fire "add sibling"
  // on the board immediately after the commit.
  useEffect(() => {
    if (prevEditingRef.current !== null && editingId === null) {
      editJustCommittedRef.current = true;
      const t = setTimeout(() => { editJustCommittedRef.current = false; }, 300);
      focusBoard();
      return () => clearTimeout(t);
    }
    prevEditingRef.current = editingId;
  }, [editingId, focusBoard]);

  // ── Refocus board after the note pane closes ──────────────────────────────
  useEffect(() => {
    if (prevNotePopupRef.current !== null && notePopupId === null) {
      focusBoard();
    }
    prevNotePopupRef.current = notePopupId;
  }, [notePopupId, focusBoard]);

  // ── Keyboard handler ──────────────────────────────────────────────────────
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      // Bail while a node label is being edited, or for 300 ms after committing
      // (prevents a held Enter from immediately triggering "add sibling").
      if (editingId || editJustCommittedRef.current) return;

      const shortcutKey = e.key.toLowerCase();

      if ((e.metaKey || e.ctrlKey) && e.shiftKey && shortcutKey === 'n') {
        e.preventDefault();
        e.stopPropagation();
        if (notePopupId) closeNote();
        else if (selectedId) openNote(selectedId);
        return;
      }

      if (notePopupId) return;

      const sel = selectedId;
      if (!sel) return;

      switch (e.key) {
        case 'Tab':
          e.preventDefault(); e.stopPropagation(); addChild(sel); break;
        case 'Enter':
          e.preventDefault(); e.stopPropagation(); addSibling(sel); break;
        case ' ':
          e.preventDefault(); e.stopPropagation(); startEditing(sel); break;
        case 'ArrowRight': {
          e.preventDefault(); e.stopPropagation();
          const current = layoutById.get(sel);
          if (!current) break;
          const target = current.id === tree.id
            ? closestVisualChildId(tree.id, 'right')
            : current.direction === 'left'
              ? current.parentId
              : closestVisualChildId(current.id);
          if (target) setSelected(target); break;
        }
        case 'ArrowLeft': {
          e.preventDefault(); e.stopPropagation();
          const current = layoutById.get(sel);
          if (!current) break;
          const target = current.id === tree.id
            ? closestVisualChildId(tree.id, 'left')
            : current.direction === 'right'
              ? current.parentId
              : closestVisualChildId(current.id);
          if (target) setSelected(target); break;
        }
        case 'ArrowDown': {
          e.preventDefault(); e.stopPropagation();
          const nid = visualSiblingId(sel, 'down');
          if (nid) setSelected(nid); break;
        }
        case 'ArrowUp': {
          e.preventDefault(); e.stopPropagation();
          const nid = visualSiblingId(sel, 'up');
          if (nid) setSelected(nid); break;
        }
        case 'Delete':
        case 'Backspace':
          e.preventDefault(); e.stopPropagation(); deleteSelected(); break;
        default: break;
      }
    },
    [
      editingId, selectedId, notePopupId,
      addChild, addSibling, startEditing,
      tree.id, layoutById, closestVisualChildId, visualSiblingId,
      deleteSelected, setSelected, openNote, closeNote,
    ],
  );

  // ── Resolve note-pane data ─────────────────────────────────────────────────
  const notePaneNode  = notePopupId ? findNode(tree, notePopupId) : null;
  const notePaneLabel = notePopupId
    ? (layoutById.get(notePopupId)?.label ?? notePopupId)
    : '';

  // ── Active map title for toolbar ──────────────────────────────────────────
  const activeMapTitle = mindMaps.find((d) => d.id === selectedMapId)?.title ?? 'Mind Map';

  return (
    <div
      className={`mm-board${isDark ? ' dark' : ''}`}
      style={{ display: 'flex', flexDirection: 'row', width: '100%', height: '100%', overflow: 'hidden' }}
    >
      {/* ── Left sidebar: pocket filter + map list ───────────────────────── */}
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          height: '100%',
          flexShrink: 0,
          width: 220,
          borderRight: '0.5px solid var(--border)',
          background: 'var(--sidebar-bg)',
          backdropFilter: 'blur(24px)',
          WebkitBackdropFilter: 'blur(24px)',
          overflow: 'hidden',
        }}
      >
        <PocketFilterDropdown
          pockets={pockets}
          active={pocketFilter}
          onChange={setPocketFilter}
        />
        {/* Map list — takes remaining height and scrolls internally */}
        <div style={{ flex: 1, minHeight: 0 }}>
          <MindMapList
            mindMaps={mindMaps}
            selectedId={selectedMapId}
            pocketFilter={pocketFilter}
            onSelect={(id) => { selectMindMap(id); focusBoard(); }}
            onCreate={() => { void createMindMap(pocketFilter === '*' ? '' : pocketFilter); focusBoard(); }}
            onDelete={(id) => void deleteMindMap(id)}
            onRename={(id, title) => renameMindMap(id, title)}
          />
        </div>
      </div>

      {/* ── Main area: toolbar + canvas ────────────────────────────────────── */}
      <div
        ref={boardRef}
        tabIndex={0}
        onKeyDownCapture={handleKeyDown}
        style={{ flex: 1, display: 'flex', flexDirection: 'column', outline: 'none', minWidth: 0 }}
      >
        {/* Top toolbar */}
        <div className="mm-toolbar">
          <span className="mm-toolbar__title">✦ {activeMapTitle}</span>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <MmBtn onClick={() => { if (selectedId) addChild(selectedId);   focusBoard(); }} title="Add child (Tab)">+ child</MmBtn>
            <MmBtn onClick={() => { if (selectedId) addSibling(selectedId); focusBoard(); }} title="Add sibling (↵)">+ sibling</MmBtn>
            <MmBtn onClick={() => { deleteSelected(); focusBoard(); }} title="Delete node (Del)" danger>✕ delete</MmBtn>
            <div className="mm-toolbar__sep" />
            <MmBtn
              onClick={() => {
                if (selectedId) {
                  if (notePopupId === selectedId) closeNote();
                  else openNote(selectedId);
                }
              }}
              title="Toggle note pane (⌘⇧N)"
              primary={!!notePopupId}
            >
              💭 note
            </MmBtn>
            <div className="mm-toolbar__sep" />
            <MmBtn onClick={() => { resetBoard(); focusBoard(); }} title="Clear board">↺ reset</MmBtn>
            <MmBtn onClick={() => void saveMindMapToFile(tree)} title="Export Markdown" primary>↓ export</MmBtn>
          </div>
        </div>

        {/* Keyboard hints */}
        <div className="mm-hints">
          <span><kbd>Tab</kbd> child</span>
          <span><kbd>↵</kbd> sibling</span>
          <span><kbd>Space</kbd> edit</span>
          <span><kbd>↑↓←→</kbd> navigate</span>
          <span><kbd>Del</kbd> remove</span>
          <span><kbd>⌘⇧N</kbd> note</span>
        </div>

        {/* Canvas row */}
        <div className="mm-canvas-row">
          <div className="mm-canvas-wrap">
            <ReactFlow
              nodes={nodes}
              edges={edges}
              nodeTypes={nodeTypes}
              edgeTypes={edgeTypes}
              onNodeClick={(_, node) => { setSelected(node.id); focusBoard(); }}
              onNodeDoubleClick={(_, node) => startEditing(node.id)}
              onPaneClick={() => { setSelected(tree.id); focusBoard(); }}
              onNodesChange={() => {/* controlled */}}
              onEdgesChange={() => {}}
              nodesDraggable={false}
              nodesConnectable={false}
              elementsSelectable
              fitView
              minZoom={0.2}
              maxZoom={2.5}
              proOptions={{ hideAttribution: true }}
            >
              <Background
                variant={BackgroundVariant.Dots}
                gap={24}
                size={1}
                color="var(--border)"
                style={{ opacity: 0.6 }}
              />
              <Controls
                showInteractive={false}
                style={{
                  background:   'var(--card)',
                  border:       '0.5px solid var(--border)',
                  borderRadius: 12,
                  boxShadow:    '0 4px 16px var(--primary-g)',
                }}
              />
            </ReactFlow>
          </div>

          {/* Note pane */}
          <AnimatePresence>
            {notePopupId && notePaneNode && (
              <MindMapNotePane
                key={notePopupId}
                nodeId={notePopupId}
                nodeLabel={notePaneLabel}
                initialContent={notePaneNode.noteContent ?? ''}
                isDark={isDark}
                onSave={updateNote}
                onClose={closeNote}
              />
            )}
          </AnimatePresence>
        </div>
      </div>
    </div>
  );
};

// ─── Toolbar button helper ────────────────────────────────────────────────────

const MmBtn = ({
  children, onClick, title, primary, danger,
}: {
  children: React.ReactNode;
  onClick:  () => void;
  title?:   string;
  primary?: boolean;
  danger?:  boolean;
}) => (
  <button
    type="button"
    title={title}
    onClick={onClick}
    className={`mm-toolbar__btn${primary ? ' mm-toolbar__btn--primary' : ''}${danger ? ' mm-toolbar__btn--danger' : ''}`}
  >
    {children}
  </button>
);

// ─── Public export ────────────────────────────────────────────────────────────

const MindMapBoard = () => (
  <ReactFlowProvider>
    <BoardInner />
  </ReactFlowProvider>
);

export default MindMapBoard;
