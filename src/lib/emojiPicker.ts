/**
 * emojiPicker.ts
 *
 * Curated emoji palette for Phing's Taro Mochi / Midnight Snow aesthetic.
 * Two thematic groups, each with 10–20 hand-picked glyphs.
 */

export interface EmojiGroup {
  label:  string;
  emojis: string[];
}

export const EMOJI_GROUPS: EmojiGroup[] = [
  {
    label: 'Café & Bakery',
    emojis: [
      '☕️', '🍵', '🥛', '🧋', '🍰',
      '🧁', '🍦', '🍩', '🍪', '🥞',
      '🍮', '🍡', '🍧', '🥐', '🧇',
      '🍯', '🍓', '🍋', '🥨', '🥖',
    ],
  },
  {
    label: 'Sakura & Spring',
    emojis: [
      '🌸', '💮', '🏵️', '🌺', '🌷',
      '🎀', '🩰', '💘', '💗', '✨',
    ],
  },
];
