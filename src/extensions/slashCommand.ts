/**
 * slashCommand.ts
 *
 * Tiptap Extension that triggers a Slash Command menu whenever the user types
 * '/' at the start of a line or immediately after a space.  The menu is
 * rendered as a React component (SlashMenu) via @tiptap/react's ReactRenderer
 * and anchored to the cursor with tippy.js.
 *
 * Architecture mirrors WikiLink — Suggestion plugin inside addProseMirrorPlugins —
 * but uses ReactRenderer rather than vanilla DOM so the popup inherits React
 * context (theme variables, Zustand store) automatically.
 */

import { Extension } from '@tiptap/core';
import { PluginKey } from '@tiptap/pm/state';
import Suggestion, { type SuggestionProps } from '@tiptap/suggestion';
import { ReactRenderer } from '@tiptap/react';
import tippy, { type Instance as TippyInstance } from 'tippy.js';
import type { Editor, Range } from '@tiptap/core';
import SlashMenu, { type SlashMenuRef } from '../components/SlashMenu';

// ── Command definitions ────────────────────────────────────────────────────────

export interface SlashCommand {
  icon:        string;
  title:       string;
  description: string;
  keywords:    string[];
  command:     (params: { editor: Editor; range: Range }) => void;
}

export const SLASH_COMMANDS: SlashCommand[] = [
  {
    icon:        'H1',
    title:       'Heading 1',
    description: 'Large section heading',
    keywords:    ['h1', 'heading', 'title', 'large'],
    command:     ({ editor, range }) =>
      editor.chain().focus().deleteRange(range).toggleHeading({ level: 1 }).run(),
  },
  {
    icon:        'H2',
    title:       'Heading 2',
    description: 'Medium section heading',
    keywords:    ['h2', 'heading', 'subtitle', 'medium'],
    command:     ({ editor, range }) =>
      editor.chain().focus().deleteRange(range).toggleHeading({ level: 2 }).run(),
  },
  {
    icon:        'H3',
    title:       'Heading 3',
    description: 'Small section heading',
    keywords:    ['h3', 'heading', 'small'],
    command:     ({ editor, range }) =>
      editor.chain().focus().deleteRange(range).toggleHeading({ level: 3 }).run(),
  },
  {
    icon:        '•',
    title:       'Bullet List',
    description: 'Unordered list',
    keywords:    ['bullet', 'list', 'ul', 'unordered'],
    command:     ({ editor, range }) =>
      editor.chain().focus().deleteRange(range).toggleBulletList().run(),
  },
  {
    icon:        '1.',
    title:       'Numbered List',
    description: 'Ordered list',
    keywords:    ['numbered', 'ordered', 'list', 'ol', 'number'],
    command:     ({ editor, range }) =>
      editor.chain().focus().deleteRange(range).toggleOrderedList().run(),
  },
  {
    icon:        '❝',
    title:       'Quote',
    description: 'Blockquote',
    keywords:    ['quote', 'blockquote', 'callout'],
    command:     ({ editor, range }) =>
      editor.chain().focus().deleteRange(range).toggleBlockquote().run(),
  },
  {
    icon:        '—',
    title:       'Divider',
    description: 'Horizontal rule',
    keywords:    ['divider', 'separator', 'hr', 'rule', 'line'],
    command:     ({ editor, range }) =>
      editor.chain().focus().deleteRange(range).setHorizontalRule().run(),
  },
  {
    icon:        '<>',
    title:       'Code Block',
    description: 'Multi-line code snippet',
    keywords:    ['code', 'codeblock', 'pre', 'snippet', 'block'],
    command:     ({ editor, range }) =>
      editor.chain().focus().deleteRange(range).toggleCodeBlock().run(),
  },
];

// ── Plugin key ─────────────────────────────────────────────────────────────────

const slashCommandKey = new PluginKey('slashCommand');

// ── Extension ─────────────────────────────────────────────────────────────────

export const SlashCommand = Extension.create({
  name: 'slashCommand',

  addProseMirrorPlugins() {
    return [
      Suggestion<SlashCommand>({
        editor: this.editor,
        pluginKey: slashCommandKey,

        // Trigger character.
        char: '/',

        // Fire after a space (mid-sentence) as well as at line start.
        // null means "start of textblock" — together with ' ' this covers both.
        allowedPrefixes: [' ', null as unknown as string],

        // Stop collecting the query at the first space so '/heading 1' doesn't
        // swallow the remainder of a sentence.
        allowSpaces: false,

        // ── Item list ─────────────────────────────────────────────────────────
        items: ({ query }): SlashCommand[] => {
          const q = query.toLowerCase().trim();
          if (!q) return SLASH_COMMANDS;
          return SLASH_COMMANDS.filter(
            (cmd) =>
              cmd.title.toLowerCase().includes(q) ||
              cmd.description.toLowerCase().includes(q) ||
              cmd.keywords.some((k) => k.startsWith(q)),
          );
        },

        // ── Execute the chosen command ────────────────────────────────────────
        command: ({ editor, range, props }) => {
          props.command({ editor, range });
        },

        // ── Popup rendering via ReactRenderer + tippy.js ──────────────────────
        render: () => {
          let renderer: ReactRenderer<SlashMenuRef>;
          let popup: TippyInstance[];

          return {
            onStart: (props: SuggestionProps<SlashCommand>) => {
              renderer = new ReactRenderer(SlashMenu, {
                props,
                editor: props.editor,
              });

              if (!props.clientRect) return;

              popup = tippy('body', {
                getReferenceClientRect: props.clientRect as () => DOMRect,
                appendTo: () => document.body,
                content:      renderer.element,
                showOnCreate: true,
                interactive:  true,
                trigger:      'manual',
                placement:    'bottom-start',
                // Zero animation so the menu snaps in/out crisply alongside
                // Phing's own Framer Motion transitions.
                animation:    false,
                // Prevent tippy from adding its own max-width.
                maxWidth:     'none',
              });
            },

            onUpdate: (props: SuggestionProps<SlashCommand>) => {
              renderer.updateProps(props);
              if (!props.clientRect) return;
              popup[0]?.setProps({
                getReferenceClientRect: props.clientRect as () => DOMRect,
              });
            },

            onExit: () => {
              popup?.[0]?.destroy();
              renderer?.destroy();
            },

            // Forward keyboard events to the SlashMenu component ref so it can
            // manage its own selectedIndex without needing a shared signal.
            onKeyDown: ({ event }) => {
              if (event.key === 'Escape') {
                popup?.[0]?.hide();
                return true;
              }
              return renderer?.ref?.onKeyDown?.({ event }) ?? false;
            },
          };
        },
      }),
    ];
  },
});
