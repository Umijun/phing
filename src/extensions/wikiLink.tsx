import {
  Mark,
  mergeAttributes,
  type JSONContent,
  type MarkdownRendererHelpers,
  type MarkdownParseHelpers,
  type MarkdownToken,
} from '@tiptap/core';
import { PluginKey } from '@tiptap/pm/state';
import Suggestion, { type SuggestionProps } from '@tiptap/suggestion';
import type { Range } from '@tiptap/core';

export interface WikiLinkItem {
  id: string;
  title: string;
  emoji?: string;
}

export interface WikiLinkOptions {
  getItems: () => WikiLinkItem[];
}

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    wikiLink: {
      setWikiLink: (attrs: { noteId: string; label: string }) => ReturnType;
    };
  }
}

const wikiSuggestionKey = new PluginKey('wikiLinkSuggestion');

function wikiFindSuggestionMatch(config: {
  char: string;
  $position: import('@tiptap/pm/model').ResolvedPos;
}): { range: Range; query: string; text: string } | null {
  const { $position } = config;
  const text = $position.parent.textBetween(
    0,
    $position.parentOffset,
    undefined,
    '\ufffc',
  );
  const match = text.match(/\[\[([^\]]*?)$/);
  if (!match) return null;

  const query = match[1];
  const from = $position.pos - query.length - 2;
  const to = $position.pos;

  return {
    range: { from, to },
    query,
    text: `[[${query}`,
  };
}

function buildSuggestionPopup(): {
  render: () => {
    onStart: (props: SuggestionProps<WikiLinkItem>) => void;
    onUpdate: (props: SuggestionProps<WikiLinkItem>) => void;
    onExit: () => void;
    onKeyDown: (props: { event: KeyboardEvent }) => boolean;
  };
} {
  const element = document.createElement('div');
  element.className = 'wiki-link-suggestion';
  let selected = 0;
  let items: WikiLinkItem[] = [];
  let command: ((item: WikiLinkItem) => void) | null = null;

  const renderList = () => {
    element.innerHTML = '';
    if (!items.length) {
      const empty = document.createElement('div');
      empty.className = 'wiki-link-suggestion__empty';
      empty.textContent = 'No matching notes';
      element.appendChild(empty);
      return;
    }
    items.forEach((item, i) => {
      const row = document.createElement('button');
      row.type = 'button';
      row.className = `wiki-link-suggestion__item${i === selected ? ' is-selected' : ''}`;
      row.textContent = `${item.emoji ? `${item.emoji} ` : ''}${item.title}`;
      row.addEventListener('mousedown', (e) => {
        e.preventDefault();
        command?.(item);
      });
      element.appendChild(row);
    });
  };

  return {
    render: () => ({
      onStart: (props) => {
        items = props.items;
        command = props.command;
        selected = 0;
        renderList();
        if (props.clientRect) {
          const rect = props.clientRect();
          if (rect) {
            element.style.position = 'fixed';
            element.style.left = `${rect.left}px`;
            element.style.top = `${rect.bottom + 6}px`;
            element.style.zIndex = '10000';
          }
        }
        document.body.appendChild(element);
      },
      onUpdate: (props) => {
        items = props.items;
        command = props.command;
        selected = 0;
        renderList();
        if (props.clientRect) {
          const rect = props.clientRect();
          if (rect) {
            element.style.left = `${rect.left}px`;
            element.style.top = `${rect.bottom + 6}px`;
          }
        }
      },
      onExit: () => {
        element.remove();
      },
      onKeyDown: ({ event }) => {
        if (event.key === 'ArrowUp') {
          selected = (selected + items.length - 1) % Math.max(items.length, 1);
          renderList();
          return true;
        }
        if (event.key === 'ArrowDown') {
          selected = (selected + 1) % Math.max(items.length, 1);
          renderList();
          return true;
        }
        if (event.key === 'Enter') {
          const item = items[selected];
          if (item) command?.(item);
          return true;
        }
        if (event.key === 'Escape') {
          return true;
        }
        return false;
      },
    }),
  };
}

export const WikiLink = Mark.create<WikiLinkOptions>({
  name: 'wikiLink',

  priority: 1000,

  inclusive: false,

  addOptions() {
    return {
      getItems: () => [],
    };
  },

  addAttributes() {
    return {
      noteId: { default: null },
      label: { default: null },
    };
  },

  parseHTML() {
    return [
      {
        tag: 'span[data-wiki-link]',
        getAttrs: (el) => {
          if (typeof el === 'string') return false;
          const node = el as HTMLElement;
          return {
            noteId: node.getAttribute('data-note-id'),
            label: node.getAttribute('data-label') ?? node.textContent,
          };
        },
      },
    ];
  },

  renderHTML({ HTMLAttributes }) {
    return [
      'span',
      mergeAttributes(HTMLAttributes, {
        'data-wiki-link': '',
        class: 'wiki-link',
        'data-note-id': HTMLAttributes.noteId,
        'data-label': HTMLAttributes.label,
      }),
      0,
    ];
  },

  // ── Markdown serialisation ────────────────────────────────────────────────
  //
  // @tiptap/markdown v3 discovers the open/close delimiters for a mark by
  // calling renderMarkdown with a *synthetic* node whose content is a single
  // placeholder text node, and whose helpers.renderChildren() returns that same
  // placeholder string.  It then splits the returned string around the
  // placeholder to derive `open` and `close`.
  //
  // Returning `[[${helpers.renderChildren(...)}]]` therefore gives:
  //   open  = "[["
  //   close = "]]"
  //
  // The serialiser inserts the real text content between those delimiters,
  // producing the correct `[[Note Name]]` Markdown output.
  //
  // DO NOT read `node.attrs.label` here — that would embed the label in the
  // open string, which causes the placeholder to be unfindable, making both
  // open and close resolve to "" and the mark disappear from the output.
  renderMarkdown(node: JSONContent, helpers: MarkdownRendererHelpers): string {
    return `[[${helpers.renderChildren(node.content ?? [])}]]`;
  },

  // ── Markdown tokenisation (deserialisation) ───────────────────────────────
  //
  // Register a custom marked.js tokenizer so that [[Note Name]] is parsed as
  // a `wikiLink` token during the Markdown → ProseMirror pipeline.  Without
  // this, marked treats [[ as the start of a regular link and the syntax is
  // lost on reload.
  markdownTokenizer: {
    name:  'wikiLink',
    level: 'inline' as const,
    // "start" tells marked the earliest character that can begin this token.
    // Using '[' is correct: every [[...]] starts with '['.
    start: '[',
    tokenize(src: string): MarkdownToken | undefined {
      const match = /^\[\[([^\]\n]+?)\]\]/.exec(src);
      if (!match) return undefined;
      return {
        type:  'wikiLink',
        raw:   match[0],
        label: match[1].trim(),
      };
    },
  },

  // ── Markdown token → ProseMirror mark ────────────────────────────────────
  //
  // Called when the tokenizer produces a `wikiLink` token.  We apply the
  // `wikiLink` mark to a text node containing the label.  The noteId is set
  // to the label (the UUID is not stored in Markdown); the click handler in
  // Editor.tsx resolves it to a real note via title-based lookup.
  parseMarkdown(
    token: MarkdownToken,
    helpers: MarkdownParseHelpers,
  ): ReturnType<MarkdownParseHelpers['applyMark']> {
    const label = (token.label as string | undefined) ?? (token.raw as string ?? '');
    return helpers.applyMark(
      'wikiLink',
      [helpers.createTextNode(label)],
      { noteId: label, label },
    );
  },

  addCommands() {
    return {
      setWikiLink:
        (attrs) =>
        ({ chain }) =>
          chain().setMark(this.name, attrs).run(),
    };
  },

  addProseMirrorPlugins() {
    const popup = buildSuggestionPopup();

    return [
      Suggestion<WikiLinkItem, WikiLinkItem>({
        editor: this.editor,
        pluginKey: wikiSuggestionKey,
        char: '[',
        allowSpaces: true,
        allowedPrefixes: [' ', '\n', null as unknown as string],
        findSuggestionMatch: wikiFindSuggestionMatch,
        items: ({ query }) => {
          const q = query.toLowerCase();
          return this.options
            .getItems()
            .filter((n) => n.title.toLowerCase().includes(q))
            .slice(0, 12);
        },
        command: ({ editor, range, props }) => {
          const label = props.title;

          // If the user typed [[label]] in full (with closing ]]) and then
          // repositioned the cursor to be inside the [[…]] block, the suggestion
          // range only covers the [[query part.  We must also consume the
          // trailing ]] so it does not appear as stray syntax after the pill.
          let endPos = range.to;
          try {
            const { state } = editor;
            if (endPos < state.doc.content.size) {
              const trailing = state.doc.textBetween(
                endPos,
                Math.min(endPos + 2, state.doc.content.size),
              );
              if (trailing === ']]') endPos += 2;
            }
          } catch {
            // Ignore — silently fall back to the original range end
          }

          editor
            .chain()
            .focus()
            .deleteRange({ from: range.from, to: endPos })
            .insertContent({
              type: 'text',
              text: label,
              marks: [
                {
                  type: 'wikiLink',
                  attrs: { noteId: props.id, label },
                },
              ],
            })
            .run();
        },
        render: popup.render,
      }),
    ];
  },
});

// NOTE: preprocessWikiLinksInMarkdown (the old HTML-span workaround) has been
// removed.  The markdownTokenizer above handles [[…]] natively inside the
// @tiptap/markdown pipeline, so no pre-processing is required.
