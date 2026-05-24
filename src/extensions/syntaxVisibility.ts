import { Extension } from '@tiptap/core';
import { Plugin, PluginKey } from '@tiptap/pm/state';

const syntaxVisibleKey = new PluginKey('syntaxVisible');

/** Toggles .syntax-visible on the editor root when the selection is active. */
export const SyntaxVisibility = Extension.create({
  name: 'syntaxVisibility',

  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: syntaxVisibleKey,
        view(view) {
          const update = () => {
            const { from, to } = view.state.selection;
            const active = view.hasFocus() || from !== to;
            view.dom.classList.toggle('syntax-visible', active);
          };
          update();
          return { update };
        },
      }),
    ];
  },
});
