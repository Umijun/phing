/**
 * FileTree.tsx
 *
 * Recursive sidebar file-tree component for Phing's infinite nested folder
 * support.  Each vault directory renders as an expandable FolderNode; each
 * .md file renders as a NoteNode that can be clicked to open it in the editor.
 *
 * Design principles:
 *  - Strictly minimal: no icons, just taro-tinted "›" arrows + indentation.
 *  - Animations via Framer Motion using the same curve constants as the rest
 *    of the app (~250 ms smooth / spring-pop on entrance).
 *  - Hover-revealed action buttons (+ sub-folder, ✎ rename, ✕ delete) so the
 *    tree stays visually quiet until the user needs controls.
 *  - All FS mutations are delegated to the Zustand store; this component only
 *    owns expand/collapse UI state.
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { useNoteStore } from '../store/noteStore';
import { useNoteDrag } from '../lib/noteDrag';
import { pocketGlow } from '../lib/pockets';
import { relPath } from '../lib/fileTree';
import type { FileNode } from '../lib/fileTree';
import EmojiPicker from './EmojiPicker';

// ─── Constants ────────────────────────────────────────────────────────────────

/** Horizontal padding per depth level in pixels. */
const INDENT_PX = 10;
/** Base left padding for depth-0 items (top-level folders). */
const BASE_PAD  = 8;

// ─── Root component ───────────────────────────────────────────────────────────

interface FileTreeProps {
  /** The children of the vault root (not the root node itself). */
  nodes:     FileNode[];
  vaultPath: string;
}

export const FileTree = ({ nodes, vaultPath }: FileTreeProps) => (
  <>
    {nodes.map((node) => (
      <FileTreeNode
        key={node.path}
        node={node}
        depth={0}
        vaultPath={vaultPath}
        defaultExpanded
      />
    ))}
  </>
);

// ─── Single tree node ─────────────────────────────────────────────────────────

interface FileTreeNodeProps {
  node:            FileNode;
  depth:           number;
  vaultPath:       string;
  defaultExpanded?: boolean;
}

const FileTreeNode = ({ node, depth, vaultPath, defaultExpanded }: FileTreeNodeProps) => {
  if (node.isDir) {
    return (
      <FolderNode
        node={node}
        depth={depth}
        vaultPath={vaultPath}
        defaultExpanded={defaultExpanded ?? depth === 0}
      />
    );
  }
  return <NoteNode node={node} depth={depth} vaultPath={vaultPath} />;
};

// ─── Folder node ──────────────────────────────────────────────────────────────

const FolderNode = ({
  node,
  depth,
  vaultPath,
  defaultExpanded,
}: {
  node:            FileNode;
  depth:           number;
  vaultPath:       string;
  defaultExpanded: boolean;
}) => {
  const [expanded,       setExpanded]     = useState(defaultExpanded);
  const [isRenaming,     setIsRenaming]   = useState(false);
  const [renameDraft,    setRenameDraft]  = useState(node.name);
  const [isAddingFolder, setAddingFolder] = useState(false);
  const [newFolderName,  setNewFolderName] = useState('');
  const [confirmDelete,  setConfirmDelete] = useState(false);

  const renameInputRef        = useRef<HTMLInputElement>(null);
  const newFolderInputRef     = useRef<HTMLInputElement>(null);
  const confirmDeleteTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Guards against the onBlur double-fire that occurs when pressing Enter:
  // setAddingFolder(false) unmounts the input, which fires onBlur synchronously
  // before React can re-render, so commitNewFolder would run twice with the
  // same captured newFolderName.  The ref resets each time the input opens.
  const commitFiredRef        = useRef(false);

  // ── Store subscriptions ───────────────────────────────────────────────────
  const activePocket     = useNoteStore((s) => s.activePocket);
  const setActivePocket  = useNoteStore((s) => s.setActivePocket);
  const pockets          = useNoteStore((s) => s.pockets);
  const renameTreeFolder = useNoteStore((s) => s.renameTreeFolder);
  const deleteTreeFolder = useNoteStore((s) => s.deleteTreeFolder);
  const createSubFolder  = useNoteStore((s) => s.createSubFolder);
  const setPocketEmoji   = useNoteStore((s) => s.setPocketEmoji);

  // Drag-store subscription — only used for depth-0 (Pocket) drop-target feedback.
  const isDraggingAny   = useNoteDrag((s) => s.dragging !== null);
  const hoveredPocketId = useNoteDrag((s) => s.hoveredPocketId);

  const folderRel    = relPath(vaultPath, node.path);
  const isActive     = activePocket === folderRel || activePocket.startsWith(folderRel + '/');
  const isDropTarget = isDraggingAny && hoveredPocketId === folderRel;

  // Pocket metadata (color dot + emoji) for depth-0 folders only.
  const pocket = depth === 0 ? pockets.find((p) => p.id === folderRel) : undefined;

  // Pre-compute pocket-tinted background values so the motion.div animate /
  // whileHover props always receive stable, primitive strings (not function
  // calls inside JSX, which would create new objects on every render).
  const pocketBgIdle   = pocket ? pocketGlow(pocket.color, 0.06) : undefined;
  const pocketBgActive = pocket ? pocketGlow(pocket.color, 0.14) : undefined;
  const pocketBgDrop   = pocket ? pocketGlow(pocket.color, 0.22) : undefined;
  const pocketBgHover  = pocket ? pocketGlow(pocket.color, 0.13) : undefined;

  // ── Side-effects ──────────────────────────────────────────────────────────
  useEffect(() => () => {
    // Cancel confirm-delete timer on unmount to avoid setState on an
    // unmounted component when a folder is deleted while the timer is running.
    if (confirmDeleteTimerRef.current !== null) {
      clearTimeout(confirmDeleteTimerRef.current);
    }
  }, []);

  useEffect(() => {
    if (isRenaming) {
      setRenameDraft(node.name);
      setTimeout(() => { renameInputRef.current?.focus(); renameInputRef.current?.select(); }, 30);
    }
  }, [isRenaming, node.name]);

  useEffect(() => {
    if (isAddingFolder) {
      // Reset the double-fire guard every time the input opens.
      commitFiredRef.current = false;
      // Delay focus slightly so the AnimatePresence height animation has
      // started and the input node is in the DOM.
      setTimeout(() => newFolderInputRef.current?.focus(), 50);
    }
  }, [isAddingFolder]);

  // ── Handlers ──────────────────────────────────────────────────────────────
  const handleFolderClick = () => {
    setExpanded((e) => !e);
    setActivePocket(folderRel);
  };

  const commitRename = useCallback(async () => {
    const name = renameDraft.trim();
    // Empty or unchanged — just close the input, no store call needed.
    if (!name || name === node.name) { setIsRenaming(false); return; }
    const renamed = await renameTreeFolder(node.path, name);
    if (renamed) {
      // Success — close the input; the store has already updated the tree.
      setIsRenaming(false);
    }
    // On collision or FS error (renamed === false) we intentionally leave
    // isRenaming: true so the input stays open and the user can pick a
    // different name.  The store logged a console.warn with the reason.
  }, [renameDraft, node.name, node.path, renameTreeFolder]);

  const commitNewFolder = useCallback(async () => {
    // Guard: onBlur fires when the input unmounts after setAddingFolder(false).
    // Without this, pressing Enter calls commitNewFolder twice — once from
    // onKeyDown and once from the resulting onBlur — which races createSubFolder
    // and can corrupt the vaultTree insertion.
    if (commitFiredRef.current) return;
    commitFiredRef.current = true;

    const name = newFolderName.trim();
    setAddingFolder(false);
    setNewFolderName('');
    if (name) {
      setExpanded(true);
      await createSubFolder(node.path, name);
    }
  }, [newFolderName, node.path, createSubFolder]);

  const handleDelete = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (confirmDelete) {
      if (confirmDeleteTimerRef.current !== null) {
        clearTimeout(confirmDeleteTimerRef.current);
        confirmDeleteTimerRef.current = null;
      }
      void deleteTreeFolder(node.path);
    } else {
      setConfirmDelete(true);
      confirmDeleteTimerRef.current = setTimeout(() => {
        confirmDeleteTimerRef.current = null;
        setConfirmDelete((c) => (c ? false : c));
      }, 3000);
    }
  };

  const pad = BASE_PAD + depth * INDENT_PX;

  return (
    <div>
      {/* Folder header row */}
      {isRenaming ? (
        <div style={{ paddingLeft: pad, paddingRight: 6 }}>
          <input
            ref={renameInputRef}
            value={renameDraft}
            onChange={(e) => setRenameDraft(e.target.value)}
            onBlur={() => void commitRename()}
            onKeyDown={(e) => {
              if (e.key === 'Enter')  { e.preventDefault(); void commitRename(); }
              if (e.key === 'Escape') { e.preventDefault(); setIsRenaming(false); }
            }}
            style={{
              width:      '100%',
              fontSize:   11,
              fontFamily: 'var(--font-ui)',
              padding:    '3px 8px',
              borderRadius: 6,
              border:     '0.5px solid var(--primary)',
              background: 'var(--card)',
              color:      'var(--strong)',
              outline:    'none',
              margin:     '2px 0',
            }}
          />
        </div>
      ) : (
        <motion.div
          // Pocket-aware background: tinted with the pocket's pastel color.
          // whileHover is suppressed during drag so the two states don't fight.
          whileHover={isDropTarget ? {} : {
            background: pocketBgHover ?? 'var(--primary-s)',
            color:      'var(--primary)',
          }}
          animate={
            isDropTarget
              ? { background: pocketBgDrop   ?? 'var(--primary-s)', color: 'var(--primary)' }
              : isActive
                ? { background: pocketBgActive ?? 'var(--primary-g)', color: 'var(--primary)' }
                : pocketBgIdle
                  ? { background: pocketBgIdle }
                  : {}
          }
          onClick={handleFolderClick}
          data-pocket-id={folderRel}
          className={`file-tree-folder${isActive ? ' file-tree-folder--active' : ''}${isDropTarget ? ' file-tree-folder--droptarget' : ''}`}
          style={{
            paddingLeft:   pad,
            // Pocket-coloured left border — the CSS rule sets 'transparent'
            // as default; we override it here for depth-0 pockets.
            ...(pocket ? { borderLeftColor: pocket.color } : {}),
          }}
          title={folderRel || node.name}
        >
          {/* Expand / collapse arrow */}
          <motion.span
            className="file-tree-arrow"
            animate={{ rotate: expanded ? 90 : 0 }}
            transition={{ duration: 0.18, ease: [0.4, 0, 0.2, 1] }}
          >
            ›
          </motion.span>

          {/* Pocket color dot — only visible while dragging to give pulse feedback.
              In normal state the colored left-border acts as the color signal. */}
          {pocket && isDraggingAny && (
            <motion.span
              animate={isDropTarget
                ? { scale: [1, 1.55, 1], transition: { repeat: Infinity, duration: 0.85, ease: 'easeInOut' } }
                : { scale: 1,            transition: { type: 'spring', stiffness: 400, damping: 20 } }
              }
              style={{
                width:        6,
                height:       6,
                borderRadius: '50%',
                background:   pocket.color,
                flexShrink:   0,
                display:      'inline-block',
                boxShadow:    isDropTarget
                  ? `0 0 8px ${pocketGlow(pocket.color, 0.73)}`
                  : `0 0 4px ${pocketGlow(pocket.color, 0.38)}`,
              }}
            />
          )}

          {/* Emoji trigger — depth-0 pockets only; clicking opens the picker. */}
          {depth === 0 && (
            <EmojiPicker
              emoji={pocket?.emoji}
              defaultEmoji="📂"
              onSelect={(em) => setPocketEmoji(folderRel, em)}
            />
          )}

          {/* Folder name */}
          <span
            style={{
              flex:         1,
              overflow:     'hidden',
              textOverflow: 'ellipsis',
              whiteSpace:   'nowrap',
              fontSize:     depth === 0 ? 11 : 10.5,
              fontWeight:   isActive ? 600 : depth === 0 ? 500 : 400,
            }}
          >
            {node.name}
          </span>

          {/* Hover-revealed actions */}
          <span
            className="file-tree-actions"
            onClick={(e) => e.stopPropagation()}
          >
            <TreeActionBtn
              title="New sub-folder"
              onClick={(e) => { e.stopPropagation(); setExpanded(true); setAddingFolder(true); }}
            >+</TreeActionBtn>
            <TreeActionBtn
              title="Rename folder"
              onClick={(e) => { e.stopPropagation(); setIsRenaming(true); }}
            >✎</TreeActionBtn>
            <TreeActionBtn
              title={confirmDelete ? 'Click again to delete' : 'Delete folder'}
              danger={confirmDelete}
              onClick={handleDelete}
            >{confirmDelete ? '?' : '✕'}</TreeActionBtn>
          </span>
        </motion.div>
      )}

      {/* Children */}
      <AnimatePresence initial={false}>
        {expanded && (
          <motion.div
            key="children"
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.22, ease: [0.4, 0, 0.2, 1] }}
            style={{ overflow: 'hidden' }}
          >
            {/* New sub-folder inline input */}
            {isAddingFolder && (
              <div style={{ paddingLeft: pad + INDENT_PX + 4, paddingRight: 6 }}>
                <input
                  ref={newFolderInputRef}
                  value={newFolderName}
                  onChange={(e) => setNewFolderName(e.target.value)}
                  placeholder="Folder name…"
                  onBlur={() => void commitNewFolder()}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter')  { e.preventDefault(); void commitNewFolder(); }
                    if (e.key === 'Escape') {
                      e.preventDefault();
                      setAddingFolder(false);
                      setNewFolderName('');
                    }
                  }}
                  style={{
                    width:      '100%',
                    fontSize:   10.5,
                    fontFamily: 'var(--font-ui)',
                    padding:    '3px 8px',
                    borderRadius: 6,
                    border:     '0.5px solid var(--primary)',
                    background: 'var(--card)',
                    color:      'var(--strong)',
                    outline:    'none',
                    margin:     '2px 0',
                  }}
                />
              </div>
            )}

            {node.children.map((child) => (
              <FileTreeNode
                key={child.path}
                node={child}
                depth={depth + 1}
                vaultPath={vaultPath}
                defaultExpanded={false}
              />
            ))}

            {node.children.length === 0 && !isAddingFolder && (
              <div
                style={{
                  paddingLeft: pad + INDENT_PX + 14,
                  paddingTop:  3,
                  paddingBottom: 3,
                  fontSize:    10,
                  color:       'var(--soft)',
                  fontStyle:   'italic',
                }}
              >
                empty
              </div>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};

// ─── Note node ────────────────────────────────────────────────────────────────

const NoteNode = ({
  node,
  depth,
  vaultPath,
}: {
  node:      FileNode;
  depth:     number;
  vaultPath: string;
}) => {
  const notes          = useNoteStore((s) => s.notes);
  const selectedNoteId = useNoteStore((s) => s.selectedNoteId);
  const selectNote     = useNoteStore((s) => s.selectNote);
  const setActivePocket = useNoteStore((s) => s.setActivePocket);

  const rel      = relPath(vaultPath, node.path);
  const note     = notes.find((n) => n.filePath === rel);
  const isActive = note?.id === selectedNoteId;

  const displayName = note?.title ?? node.name.replace(/\.md$/i, '');
  const emoji       = note?.emoji;

  const pad = BASE_PAD + depth * INDENT_PX + 14; // +14 to align past the arrow

  const handleClick = () => {
    if (!note) return;
    // Navigate to the note's parent folder and open the note
    const folder = relPath(vaultPath, node.path.split('/').slice(0, -1).join('/'));
    setActivePocket(folder);
    void selectNote(note.id);
  };

  return (
    <motion.div
      whileHover={{ background: 'var(--primary-s)', color: 'var(--primary)' }}
      onClick={handleClick}
      className={`file-tree-note${isActive ? ' file-tree-note--active' : ''}${!note ? ' file-tree-note--unloaded' : ''}`}
      style={{ paddingLeft: pad }}
      title={displayName}
    >
      {emoji && <span style={{ fontSize: 10, flexShrink: 0 }}>{emoji}</span>}
      <span
        style={{
          flex:         1,
          overflow:     'hidden',
          textOverflow: 'ellipsis',
          whiteSpace:   'nowrap',
        }}
      >
        {displayName}
      </span>
    </motion.div>
  );
};

// ─── Shared action button ─────────────────────────────────────────────────────

const TreeActionBtn = ({
  children,
  title,
  danger,
  onClick,
}: {
  children: React.ReactNode;
  title:    string;
  danger?:  boolean;
  onClick:  (e: React.MouseEvent) => void;
}) => (
  <button
    type="button"
    title={title}
    onClick={onClick}
    className={`file-tree-action-btn${danger ? ' file-tree-action-btn--danger' : ''}`}
  >
    {children}
  </button>
);
