/**
 * fileTree.ts
 *
 * TypeScript types and pure immutable helpers for the vault FileNode tree
 * returned by the Rust `scan_vault_tree` command.
 *
 * All mutation helpers return NEW trees — they never mutate in place —
 * so Zustand's `set()` equality check always triggers a re-render.
 */

// ─── Core type ────────────────────────────────────────────────────────────────

export interface FileNode {
  name:     string;
  /** Absolute path, forward-slash normalised on all platforms. */
  path:     string;
  isDir:    boolean;
  children: FileNode[];
}

// ─── Rust → TS adapter ───────────────────────────────────────────────────────
// The Rust struct uses `#[serde(rename_all = "camelCase")]` so the raw JSON
// already has `isDir` (not `is_dir`).  This type guard just satisfies TS.

type RawNode = { name: string; path: string; isDir: boolean; children: RawNode[] };

export function fromRaw(raw: unknown): FileNode {
  const n = raw as RawNode;
  return {
    name:     n.name,
    path:     n.path,
    isDir:    n.isDir,
    children: (n.children ?? []).map(fromRaw),
  };
}

// ─── Path helpers ─────────────────────────────────────────────────────────────

/** Vault-relative path from an absolute node path (empty string = vault root). */
export function relPath(vaultPath: string, absPath: string): string {
  const norm = absPath.replace(/\\/g, '/');
  const base = vaultPath.replace(/\\/g, '/').replace(/\/$/, '');
  if (norm === base) return '';
  return norm.startsWith(base + '/') ? norm.slice(base.length + 1) : norm;
}

/** Absolute path from a vault-relative path. */
export function absPath(vaultPath: string, rel: string): string {
  if (!rel) return vaultPath.replace(/\\/g, '/');
  return `${vaultPath.replace(/\\/g, '/').replace(/\/$/, '')}/${rel}`;
}

/** The immediate parent's absolute path (returns vault path for top-level nodes). */
export function parentAbsPath(nodePath: string): string {
  const parts = nodePath.replace(/\\/g, '/').split('/');
  parts.pop();
  return parts.join('/');
}

// ─── Tree search ──────────────────────────────────────────────────────────────

export function findByPath(root: FileNode, target: string): FileNode | null {
  if (root.path === target) return root;
  for (const child of root.children) {
    const found = findByPath(child, target);
    if (found) return found;
  }
  return null;
}

// ─── Immutable mutations ──────────────────────────────────────────────────────

/**
 * Insert `child` under the node at `parentPath`.
 * Maintains the sort invariant: directories first, then files, both
 * sorted case-insensitively by name.
 */
export function insertChild(
  root:       FileNode,
  parentPath: string,
  child:      FileNode,
): FileNode {
  if (root.path === parentPath) {
    const existing = root.children.filter((c) => c.path !== child.path);
    const dirs  = [...existing.filter((c) => c.isDir),  ...(child.isDir  ? [child] : [])];
    const files = [...existing.filter((c) => !c.isDir), ...(!child.isDir ? [child] : [])];
    dirs.sort( (a, b) => a.name.toLowerCase().localeCompare(b.name.toLowerCase()));
    files.sort((a, b) => a.name.toLowerCase().localeCompare(b.name.toLowerCase()));
    return { ...root, children: [...dirs, ...files] };
  }
  return {
    ...root,
    children: root.children.map((c) => insertChild(c, parentPath, child)),
  };
}

/**
 * Remove the node at `targetPath` from the tree.
 * Removes the subtree entirely — use for both delete and move-out scenarios.
 */
export function removeNode(root: FileNode, targetPath: string): FileNode {
  return {
    ...root,
    children: root.children
      .filter((c) => c.path !== targetPath)
      .map((c)  => removeNode(c, targetPath)),
  };
}

/**
 * Rename a node (and recursively update all descendant paths).
 * `newAbsPath` is the full new absolute path for the renamed item.
 *
 * Also re-sorts the direct parent's children after the rename so the sidebar
 * order stays correct (e.g. renaming "apple" → "zebra" should move it to the
 * end of its siblings, not leave it at "apple"'s old position).
 */
export function renameNodeTree(
  root:       FileNode,
  oldAbsPath: string,
  newAbsPath: string,
): FileNode {
  if (root.path === oldAbsPath) {
    const newName = newAbsPath.split('/').pop() ?? root.name;
    // Recursively rewrite every path inside this subtree
    const rewrite = (node: FileNode): FileNode => ({
      ...node,
      path:     node.path.replace(oldAbsPath, newAbsPath),
      name:     node.path === oldAbsPath ? newName : node.name,
      children: node.children.map(rewrite),
    });
    return rewrite({ ...root, name: newName });
  }

  const newChildren = root.children.map((c) => renameNodeTree(c, oldAbsPath, newAbsPath));

  // Re-sort only at the direct parent level — deeper levels are unchanged.
  if (parentAbsPath(oldAbsPath) === root.path) {
    const dirs  = newChildren.filter((c) => c.isDir);
    const files = newChildren.filter((c) => !c.isDir);
    dirs.sort( (a, b) => a.name.toLowerCase().localeCompare(b.name.toLowerCase()));
    files.sort((a, b) => a.name.toLowerCase().localeCompare(b.name.toLowerCase()));
    return { ...root, children: [...dirs, ...files] };
  }

  return { ...root, children: newChildren };
}
