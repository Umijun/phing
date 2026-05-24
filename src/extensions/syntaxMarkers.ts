import { Extension } from '@tiptap/core';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';

/** Maps mark type names to their syntax symbols */
const MARK_SYMBOLS: Record<string, string> = {
  bold: '**',
  italic: '*',
  underline: '_',
  strike: '~~',
  code: '`',
  link: '[',
};

/** Add syntax markers (decorations) for inline markdown formatting when focused/selected. */
export const SyntaxMarkers = Extension.create({
  name: 'syntaxMarkers',

  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: new PluginKey('syntaxMarkers'),
        props: {
          decorations(state) {
            const { from, to } = state.selection;
            const decs: Decoration[] = [];
            const decoratedRanges = new Set<string>(); // Track ranges to avoid duplicates

            state.doc.descendants((node, pos) => {
              // Only process text nodes with marks
              if (!node.isText || !node.marks.length) return;

              const nodeStart = pos;
              const nodeEnd = pos + node.nodeSize;

              // Check if node overlaps with selection
              const isActive = from < nodeEnd && to > nodeStart;
              if (!isActive) return;

              // Process each mark on this node
              node.marks.forEach((mark) => {
                const symbol = MARK_SYMBOLS[mark.type.name];
                if (!symbol) return;

                // Create decorations for open and close markers
                const key = `${pos}-${mark.type.name}`;
                if (!decoratedRanges.has(key)) {
                  // Opening marker
                  decs.push(
                    Decoration.widget(pos, createMarkerElement(symbol), {
                      side: -1,
                      key: `open-${key}`,
                    }),
                  );
                  // Closing marker
                  decs.push(
                    Decoration.widget(pos + node.nodeSize, createMarkerElement(symbol), {
                      side: 1,
                      key: `close-${key}`,
                    }),
                  );
                  decoratedRanges.add(key);
                }
              });
            });

            return DecorationSet.create(state.doc, decs);
          },
        },
      }),
    ];
  },
});

function createMarkerElement(symbol: string): HTMLElement {
  const span = document.createElement('span');
  span.className = 'syntax-marker is-active';
  span.textContent = symbol;
  span.setAttribute('contenteditable', 'false');
  return span;
}
