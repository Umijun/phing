import { Extension } from '@tiptap/core';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';

/** Inline `#` markers on headings (opacity via CSS); keeps native editable heading nodes. */
export const HeadingMarkerDecorations = Extension.create({
  name: 'headingMarkerDecorations',

  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: new PluginKey('headingMarkerDecorations'),
        props: {
          decorations(state) {
            const { from, to } = state.selection;
            const decs: Decoration[] = [];

            state.doc.descendants((node, pos) => {
              if (node.type.name !== 'heading') return;

              const level = node.attrs.level as number;
              const marker = '#'.repeat(level) + ' ';
              const headStart = pos;
              const headEnd = pos + node.nodeSize;
              const isActive = from <= headEnd && to >= headStart;

              decs.push(
                Decoration.widget(
                  pos + 1,
                  () => {
                    const span = document.createElement('span');
                    span.className = `heading-marker${isActive ? ' is-active' : ''}`;
                    span.textContent = marker;
                    span.setAttribute('contenteditable', 'false');
                    return span;
                  },
                  { side: -1, key: `heading-marker-${pos}` },
                ),
              );
            });

            return DecorationSet.create(state.doc, decs);
          },
        },
      }),
    ];
  },
});
