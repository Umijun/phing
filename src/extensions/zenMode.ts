import { Extension } from '@tiptap/core';
import type { EditorState } from '@tiptap/pm/state';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';
import { useNoteStore } from '../store/noteStore';

const zenDefocusKey = new PluginKey('zenDefocus');

function blockAtSelection(state: EditorState) {
  const { $from } = state.selection;
  for (let d = $from.depth; d > 0; d--) {
    const node = $from.node(d);
    if (node.isBlock && node.type.name !== 'doc') {
      return { pos: $from.before(d), size: node.nodeSize };
    }
  }
  return null;
}

export const ZenModeExtension = Extension.create({
  name: 'zenMode',

  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: zenDefocusKey,
        props: {
          decorations(state) {
            if (!useNoteStore.getState().isZen) return DecorationSet.empty;

            const active = blockAtSelection(state);
            if (!active) return DecorationSet.empty;

            const activeStart = active.pos;
            const activeEnd = active.pos + active.size;
            const decs: Decoration[] = [];

            state.doc.descendants((node, pos) => {
              if (!node.isBlock || node.type.name === 'doc') return;
              const end = pos + node.nodeSize;
              const overlaps = pos < activeEnd && end > activeStart;
              if (overlaps) return;
              decs.push(
                Decoration.node(pos, end, { class: 'zen-defocus' }),
              );
            });

            return DecorationSet.create(state.doc, decs);
          },
        },
      }),
    ];
  },
});
