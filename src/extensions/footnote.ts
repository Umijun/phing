import { Extension } from '@tiptap/core';
import { Plugin, PluginKey, TextSelection } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';

/** Regex: inline reference  [^label]  — NOT followed by a colon (which is a definition) */
const REF_RE = /\[\^([^\]]+)\](?!:)/g;

/** Regex: footnote definition line  [^label]: text */
export const DEF_RE = /^\[\^([^\]]+)\]:\s*(.+)$/gm;

/**
 * Parse footnote definitions out of raw markdown content.
 * Returns them in order of appearance.
 */
export function parseFootnotes(content: string): Array<{ label: string; text: string }> {
  const results: Array<{ label: string; text: string }> = [];
  let m: RegExpExecArray | null;
  DEF_RE.lastIndex = 0;
  while ((m = DEF_RE.exec(content)) !== null) {
    results.push({ label: m[1], text: m[2] });
  }
  return results;
}

/**
 * FootnoteExtension:
 *  • Decorates [^n] inline references as superscript chips.
 *  • Cmd/Ctrl+Shift+F  →  inserts [^n] at cursor AND appends a
 *    [^n]:  definition paragraph at the document end, then moves
 *    the cursor there so the user can type the footnote content.
 */
export const FootnoteExtension = Extension.create({
  name: 'footnote',

  addProseMirrorPlugins() {
    return [
      // ── Inline reference decorations ─────────────────────────────────────────
      // Styles [^n] chips as superscript badges inside the editor body.
      new Plugin({
        key: new PluginKey('footnoteDecorations'),
        props: {
          decorations(state) {
            const decs: Decoration[] = [];

            state.doc.descendants((node, pos) => {
              if (!node.isText) return;
              const text = node.text ?? '';
              REF_RE.lastIndex = 0;
              let m: RegExpExecArray | null;
              while ((m = REF_RE.exec(text)) !== null) {
                const from = pos + m.index;
                const to = from + m[0].length;
                decs.push(
                  Decoration.inline(from, to, {
                    class: 'footnote-ref-inline',
                    'data-label': m[1],
                  }),
                );
              }
            });

            return DecorationSet.create(state.doc, decs);
          },
        },
      }),

      // ── Definition-line hide ─────────────────────────────────────────────────
      // Paragraphs that begin with [^label]: are footnote definitions.
      // They must remain in the document so they are saved correctly, but they
      // should never be visible as body text — the footer section below the
      // editor surface renders them properly.
      //
      // IMPORTANT: We do NOT hide the paragraph when the cursor/selection is
      // inside it — otherwise the user can't type or edit the definition line.
      new Plugin({
        key: new PluginKey('footnoteDefHide'),
        props: {
          decorations(state) {
            const decs: Decoration[] = [];
            const { from: selFrom, to: selTo } = state.selection;

            state.doc.forEach((node, pos) => {
              if (!node.isTextblock) return;
              const text = node.textContent;
              // Match lines that start with a footnote definition marker
              if (/^\[\^[^\]]+\]:/.test(text)) {
                const nodeStart = pos;
                const nodeEnd   = pos + node.nodeSize;
                // Skip hiding when the selection overlaps this paragraph so
                // the user can type or edit the definition without it vanishing.
                const cursorInside = selFrom >= nodeStart && selTo <= nodeEnd;
                if (cursorInside) return;
                decs.push(
                  Decoration.node(nodeStart, nodeEnd, {
                    class: 'footnote-def-node',
                  }),
                );
              }
            });

            return DecorationSet.create(state.doc, decs);
          },
        },
      }),
    ];
  },

  addKeyboardShortcuts() {
    return {
      'Mod-Shift-f': () => {
        const { state, view } = this.editor;

        // Count existing inline references to auto-number
        let count = 0;
        state.doc.descendants((node) => {
          if (!node.isText) return;
          REF_RE.lastIndex = 0;
          const m = (node.text ?? '').match(/\[\^([^\]]+)\](?!:)/g);
          if (m) count += m.length;
        });

        const label = String(count + 1);
        const refText = `[^${label}]`;
        const defText = `[^${label}]: `;

        const { from } = state.selection;
        const { tr, schema } = state;

        // 1. Insert the inline reference at the cursor
        tr.insertText(refText, from);

        // 2. Append a definition paragraph at the new document end
        const newDocEnd = tr.doc.content.size;
        const defNode = schema.nodes.paragraph.create(null, schema.text(defText));
        tr.insert(newDocEnd - 1, defNode);

        // 3. Place cursor at the end of the definition text so the user can type
        const finalEnd = tr.doc.content.size - 1;
        tr.setSelection(TextSelection.create(tr.doc, finalEnd));

        view.dispatch(tr);
        return true;
      },
    };
  },
});
