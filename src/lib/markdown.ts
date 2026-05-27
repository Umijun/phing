import type { Extensions } from '@tiptap/core';
import type { Editor } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import Underline from '@tiptap/extension-underline';
import Placeholder from '@tiptap/extension-placeholder';
// All four table extensions are re-exported from the single table package.
import { Table, TableRow, TableCell, TableHeader } from '@tiptap/extension-table';
import { Markdown } from '@tiptap/markdown';
import { HeadingMarkerDecorations } from '../extensions/headingMarkers';
import { SyntaxMarkers } from '../extensions/syntaxMarkers';
import { FootnoteExtension } from '../extensions/footnote';
import { PhingKeyboard } from '../extensions/phingKeyboard';
import { SyntaxVisibility } from '../extensions/syntaxVisibility';
import { ZenModeExtension } from '../extensions/zenMode';
import { WikiLink, type WikiLinkItem } from '../extensions/wikiLink';
import { SlashCommand } from '../extensions/slashCommand';
import type { NoteCursor } from '../store/noteStore';
import { stripLegacyBody } from './frontmatter';

export type GetWikiLinkItems = () => WikiLinkItem[];

export function createEditorExtensions(getWikiItems?: GetWikiLinkItems): Extensions {
  return [
    StarterKit.configure({ heading: { levels: [1, 2, 3, 4, 5] } }),
    HeadingMarkerDecorations,
    SyntaxMarkers,
    FootnoteExtension,
    SyntaxVisibility,
    ZenModeExtension,
    PhingKeyboard,
    Underline,
    // Table support — resizable handles are disabled to preserve the calm
    // aesthetic; GFM serialisation is handled automatically by @tiptap/markdown.
    Table.configure({ resizable: false }),
    TableRow,
    TableCell,
    TableHeader,
    Placeholder.configure({ placeholder: "Type '/' for commands" }),
    Markdown.configure({
      markedOptions: { gfm: true, breaks: false },
    }),
    WikiLink.configure({
      getItems: getWikiItems ?? (() => []),
    }),
    // Slash Command menu — triggered by '/' at line start or after a space.
    SlashCommand,
  ];
}

/** Normalize body markdown before loading into the editor. */
export function normalizeBodyMarkdown(md: string): string {
  return stripLegacyBody(md).trim();
}

export function getBodyMarkdown(editor: Editor): string {
  return editor.getMarkdown?.() ?? '';
}

export function setBodyMarkdown(
  editor: Editor,
  md: string,
  emitUpdate = false,
): void {
  // normalizeBodyMarkdown strips legacy frontmatter artefacts and trims.
  // The @tiptap/markdown tokenizer now parses [[…]] syntax natively, so no
  // HTML pre-processing is needed before handing content to setContent.
  const body = normalizeBodyMarkdown(md);
  editor.commands.setContent(body || '', { emitUpdate, contentType: 'markdown' });
}

export function restoreCursor(editor: Editor, cursor?: NoteCursor): void {
  if (!cursor) return;
  const docSize = editor.state.doc.content.size;
  const anchor = Math.min(Math.max(1, cursor.anchor), docSize);
  const head = Math.min(Math.max(1, cursor.head), docSize);
  editor.commands.setTextSelection({ from: anchor, to: head });
}
