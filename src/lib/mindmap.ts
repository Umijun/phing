import { writeTextFile } from '@tauri-apps/plugin-fs';
import { save } from '@tauri-apps/plugin-dialog';

// ─── Core tree type ───────────────────────────────────────────────────────────

export interface MindMapNode {
  id: string;
  label: string;
  children: MindMapNode[];
  noteContent?: string; // optional rich-text note attached to this node
}

// ─── ID helper ────────────────────────────────────────────────────────────────

export function genMindId(): string {
  return Math.random().toString(36).slice(2, 10);
}

// ─── Tree traversal helpers ───────────────────────────────────────────────────

export function findNode(root: MindMapNode, id: string): MindMapNode | null {
  if (root.id === id) return root;
  for (const c of root.children) {
    const found = findNode(c, id);
    if (found) return found;
  }
  return null;
}

export function findParent(root: MindMapNode, id: string): MindMapNode | null {
  for (const c of root.children) {
    if (c.id === id) return root;
    const found = findParent(c, id);
    if (found) return found;
  }
  return null;
}

export function getNodeDepth(root: MindMapNode, id: string, depth = 0): number {
  if (root.id === id) return depth;
  for (const c of root.children) {
    const d = getNodeDepth(c, id, depth + 1);
    if (d !== -1) return d;
  }
  return -1;
}

// ─── Immutable tree mutations ─────────────────────────────────────────────────

export function treeAddChild(
  root: MindMapNode,
  parentId: string,
  child: MindMapNode,
): MindMapNode {
  if (root.id === parentId) return { ...root, children: [...root.children, child] };
  return { ...root, children: root.children.map((c) => treeAddChild(c, parentId, child)) };
}

export function treeAddSiblingAfter(
  root: MindMapNode,
  afterId: string,
  newNode: MindMapNode,
): MindMapNode {
  const hasChild = root.children.some((c) => c.id === afterId);
  if (hasChild) {
    const idx = root.children.findIndex((c) => c.id === afterId);
    return {
      ...root,
      children: [
        ...root.children.slice(0, idx + 1),
        newNode,
        ...root.children.slice(idx + 1),
      ],
    };
  }
  return { ...root, children: root.children.map((c) => treeAddSiblingAfter(c, afterId, newNode)) };
}

export function treeUpdateLabel(root: MindMapNode, id: string, label: string): MindMapNode {
  if (root.id === id) return { ...root, label };
  return { ...root, children: root.children.map((c) => treeUpdateLabel(c, id, label)) };
}

export function treeUpdateNote(root: MindMapNode, id: string, noteContent: string): MindMapNode {
  if (root.id === id) return { ...root, noteContent };
  return { ...root, children: root.children.map((c) => treeUpdateNote(c, id, noteContent)) };
}

export function treeDelete(root: MindMapNode, id: string): MindMapNode {
  return {
    ...root,
    children: root.children
      .filter((c) => c.id !== id)
      .map((c) => treeDelete(c, id)),
  };
}

// ─── Layout ───────────────────────────────────────────────────────────────────

export interface LayoutNode {
  id: string;
  label: string;
  x: number;
  y: number;
  width: number;
  height: number;
  depth: number;
  parentId: string | null;
  noteContent?: string;
}

export interface LayoutEdge {
  id: string;
  sourceId: string;
  targetId: string;
}

// Layout constants
const H_GAP = 80;  // horizontal gap between parent right-edge and child left-edge
const V_GAP = 18;  // vertical gap between sibling subtrees

/**
 * Estimate the rendered pixel width for a node label.
 *
 * Uses a character-count heuristic based on approximate per-character widths
 * for the fonts used at each depth level (Lora for root, LINESeedSans for
 * children).  Avoids a DOM measurement round-trip.
 *
 * Min 90 px · Max 280 px.
 */
export function estimateNodeWidth(label: string, depth: number): number {
  const charPx = depth === 0 ? 9.5 : 8;  // root uses a slightly wider serif font
  const hPad   = depth === 0 ? 56  : 36; // horizontal padding inside the pill
  const raw    = label.length * charPx + hPad;
  return Math.max(90, Math.min(280, raw));
}

/**
 * Estimate the rendered pixel height for a node, accounting for text that
 * wraps onto multiple lines when the label is long.
 *
 * This keeps the layout engine in sync with the CSS-rendered height so that
 * sibling nodes never visually overlap after wrapping.
 *
 * Min 44 px · Max 120 px.
 */
export function estimateNodeHeight(label: string, width: number, depth: number): number {
  const charPx       = depth === 0 ? 9.5 : 8;
  const hPad         = depth === 0 ? 56  : 36;
  const vPad         = depth === 0 ? 26  : 18;  // top + bottom padding sum
  const lineH        = depth === 0 ? 22  : 20;  // px per wrapped line
  const innerW       = Math.max(1, width - hPad);
  const charsPerLine = Math.max(1, Math.floor(innerW / charPx));
  const lines        = Math.ceil(label.length / charsPerLine);
  return Math.max(44, Math.min(120, lines * lineH + vPad));
}

function subtreeH(node: MindMapNode, depth: number): number {
  const w = estimateNodeWidth(node.label, depth);
  const h = estimateNodeHeight(node.label, w, depth);
  if (!node.children.length) return h;
  const childTotal =
    node.children.reduce((sum, c) => sum + subtreeH(c, depth + 1), 0) +
    V_GAP * (node.children.length - 1);
  return Math.max(h, childTotal);
}

function layoutRecurse(
  node: MindMapNode,
  x: number,
  cy: number, // centre-y of this node
  depth: number,
  parentId: string | null,
  outNodes: LayoutNode[],
  outEdges: LayoutEdge[],
) {
  const w = estimateNodeWidth(node.label, depth);
  const h = estimateNodeHeight(node.label, w, depth);

  outNodes.push({
    id:          node.id,
    label:       node.label,
    x,
    y:           cy - h / 2,
    width:       w,
    height:      h,
    depth,
    parentId,
    noteContent: node.noteContent,
  });

  if (parentId) {
    outEdges.push({ id: `e-${parentId}-${node.id}`, sourceId: parentId, targetId: node.id });
  }

  if (!node.children.length) return;

  const childX = x + w + H_GAP;
  const totalH =
    node.children.reduce((s, c) => s + subtreeH(c, depth + 1), 0) +
    V_GAP * (node.children.length - 1);
  let childY = cy - totalH / 2;

  for (const child of node.children) {
    const ch = subtreeH(child, depth + 1);
    layoutRecurse(child, childX, childY + ch / 2, depth + 1, node.id, outNodes, outEdges);
    childY += ch + V_GAP;
  }
}

export function calculateLayout(root: MindMapNode): { nodes: LayoutNode[]; edges: LayoutEdge[] } {
  const nodes: LayoutNode[] = [];
  const edges: LayoutEdge[] = [];
  layoutRecurse(root, 0, 0, 0, null, nodes, edges);
  return { nodes, edges };
}

// ─── Markdown export ──────────────────────────────────────────────────────────

export function exportMindMapToMarkdown(root: MindMapNode): string {
  const lines: string[] = [];

  function traverse(node: MindMapNode, depth: number) {
    if (depth === 0) {
      lines.push(`# ${node.label}`);
    } else if (depth === 1) {
      lines.push(`\n## ${node.label}`);
    } else if (depth === 2) {
      lines.push(`### ${node.label}`);
    } else {
      lines.push(`${'  '.repeat(depth - 3)}- ${node.label}`);
    }
    // Append the secret note beneath this node's heading/bullet
    if (node.noteContent?.trim()) {
      lines.push('');
      lines.push(node.noteContent.trim());
      lines.push('');
    }
    node.children.forEach((c) => traverse(c, depth + 1));
  }

  traverse(root, 0);
  return lines.join('\n');
}

// ─── Tauri file save ──────────────────────────────────────────────────────────

export async function saveMindMapToFile(root: MindMapNode): Promise<void> {
  const content = exportMindMapToMarkdown(root);
  const slug = root.label.trim().replace(/\s+/g, '-').toLowerCase().slice(0, 40) || 'mindmap';
  const path = await save({
    defaultPath: `${slug}.md`,
    filters: [{ name: 'Markdown', extensions: ['md'] }],
    title: 'Export Mind Map',
  });
  if (path) await writeTextFile(path, content);
}
