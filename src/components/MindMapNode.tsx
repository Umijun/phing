import React, { useEffect, useRef, useState } from 'react';
import { Handle, Position, type NodeProps } from '@xyflow/react';
import { useMindMapStore } from '../store/mindMapStore';

export interface MindMapNodeData {
  label: string;
  depth: number;
  hasNote: boolean;
  [key: string]: unknown;
}

export const MindMapNode = ({ id, data, selected }: NodeProps) => {
  const nodeData = data as MindMapNodeData;
  const editingId   = useMindMapStore((s) => s.editingId);
  const commitEdit  = useMindMapStore((s) => s.commitEdit);
  const setSelected = useMindMapStore((s) => s.setSelected);
  const startEditing = useMindMapStore((s) => s.startEditing);
  const openNote    = useMindMapStore((s) => s.openNote);

  const isEditing = editingId === id;
  const isRoot    = nodeData.depth === 0;
  const hasNote   = nodeData.hasNote;

  const [draft, setDraft] = useState(nodeData.label);
  const inputRef = useRef<HTMLInputElement>(null);

  // Sync draft when editing starts
  useEffect(() => {
    if (isEditing) {
      setDraft(nodeData.label);
      setTimeout(() => {
        inputRef.current?.focus();
        inputRef.current?.select();
      }, 20);
    }
  }, [isEditing, nodeData.label]);

  const commit = () => commitEdit(id, draft);

  const depthClass =
    isRoot ? 'mm-node--root'
    : nodeData.depth === 1 ? 'mm-node--l1'
    : 'mm-node--deep';

  return (
    <div
      className={`mm-node ${depthClass} ${selected ? 'mm-node--selected' : ''} ${hasNote ? 'mm-node--has-note' : ''}`}
      onDoubleClick={(e) => { e.stopPropagation(); startEditing(id); }}
      onClick={() => setSelected(id)}
    >
      {/* Delicate note indicator — a tiny StickyNote icon, not a badge */}
      {hasNote && (
        <button
          type="button"
          className="mm-node-note-icon"
          title="Open note (⌘⇧N)"
          onClick={(e) => { e.stopPropagation(); openNote(id); }}
        >
          {/* Lucide StickyNote path */}
          <svg
            width="10"
            height="10"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M15.5 3H5a2 2 0 0 0-2 2v14c0 1.1.9 2 2 2h14a2 2 0 0 0 2-2V8.5L15.5 3Z" />
            <path d="M15 3v6h6" />
          </svg>
        </button>
      )}
      {/* Target handle (left) — hidden for root */}
      {!isRoot && (
        <Handle
          type="target"
          position={Position.Left}
          className="mm-handle"
          isConnectable={false}
        />
      )}

      {isEditing ? (
        <input
          ref={inputRef}
          className="mm-node-input"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commit}
          // Block at CAPTURE phase so the board's onKeyDownCapture never fires
          onKeyDownCapture={(e) => e.stopPropagation()}
          onKeyDown={(e) => {
            if (e.key === 'Enter') { e.preventDefault(); commit(); }
            if (e.key === 'Escape') { e.preventDefault(); setDraft(nodeData.label); commitEdit(id, nodeData.label); }
          }}
        />
      ) : (
        /* The label is rendered without truncation — node width is set by the
           layout engine (estimateNodeWidth), so the text always fits cleanly. */
        <span className="mm-node-label">{nodeData.label}</span>
      )}

      {/* Source handle (right) */}
      <Handle
        type="source"
        position={Position.Right}
        className="mm-handle"
        isConnectable={false}
      />
    </div>
  );
};
