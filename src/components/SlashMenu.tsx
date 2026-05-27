/**
 * SlashMenu.tsx
 *
 * Popup component rendered by the SlashCommand Tiptap extension.
 * Receives the live SuggestionProps and exposes an imperative `onKeyDown`
 * handle so the extension can forward keyboard events without lifting state.
 *
 * Aesthetic contract:
 *   • Frosted-glass panel — var(--card) base + backdrop-filter blur
 *   • Soft rounded corners (14 px), subtle var(--border) stroke
 *   • Selected row: var(--primary-s) fill + 3 px var(--primary) left accent
 *   • Icon badge: var(--primary-s) bg, var(--primary) text, monospace
 *   • Description text: var(--muted) at 10 px
 */

import React, {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from 'react';
import type { SuggestionProps } from '@tiptap/suggestion';
import type { SlashCommand } from '../extensions/slashCommand';

// ── Imperative handle ─────────────────────────────────────────────────────────

export interface SlashMenuRef {
  onKeyDown: (props: { event: KeyboardEvent }) => boolean;
}

// ── Component ─────────────────────────────────────────────────────────────────

const SlashMenu = forwardRef<SlashMenuRef, SuggestionProps<SlashCommand>>(
  (props, ref) => {
    const { items, command } = props;
    const [selectedIndex, setSelectedIndex] = useState(0);
    const listRef = useRef<HTMLDivElement>(null);

    // Reset selection whenever the filtered list changes (user is typing a query).
    useEffect(() => {
      setSelectedIndex(0);
    }, [items]);

    // Scroll the selected row into view whenever it changes via keyboard.
    useEffect(() => {
      const el = listRef.current?.querySelector<HTMLElement>(
        `[data-slash-index="${selectedIndex}"]`,
      );
      el?.scrollIntoView({ block: 'nearest' });
    }, [selectedIndex]);

    const executeCommand = useCallback(
      (index: number) => {
        const item = items[index];
        if (item) command(item);
      },
      [items, command],
    );

    // Exposed to the extension via forwardRef so keyboard events forwarded by
    // the Suggestion plugin are handled here rather than inside the extension.
    useImperativeHandle(ref, () => ({
      onKeyDown: ({ event }: { event: KeyboardEvent }) => {
        if (event.key === 'ArrowUp') {
          setSelectedIndex((i) => (i + items.length - 1) % Math.max(items.length, 1));
          return true;
        }
        if (event.key === 'ArrowDown') {
          setSelectedIndex((i) => (i + 1) % Math.max(items.length, 1));
          return true;
        }
        if (event.key === 'Enter') {
          executeCommand(selectedIndex);
          return true;
        }
        return false;
      },
    }));

    if (!items.length) {
      return (
        <div style={styles.panel} data-slash-menu>
          <div style={styles.empty}>No matching commands</div>
        </div>
      );
    }

    return (
      <div style={styles.panel} data-slash-menu ref={listRef}>
        {/* Section label */}
        <div style={styles.sectionLabel}>BLOCKS</div>

        {items.map((item, index) => {
          const isSelected = index === selectedIndex;
          return (
            <div
              key={item.title}
              data-slash-index={index}
              style={{
                ...styles.row,
                ...(isSelected ? styles.rowSelected : {}),
              }}
              onMouseEnter={() => setSelectedIndex(index)}
              onMouseDown={(e) => {
                // mousedown rather than click so the editor doesn't lose focus
                // before the command fires.
                e.preventDefault();
                executeCommand(index);
              }}
            >
              {/* Left accent bar — only visible on selected row */}
              <div
                style={{
                  ...styles.accent,
                  opacity: isSelected ? 1 : 0,
                }}
              />

              {/* Icon badge */}
              <div
                style={{
                  ...styles.iconBadge,
                  ...(isSelected ? styles.iconBadgeSelected : {}),
                }}
              >
                {item.icon}
              </div>

              {/* Text */}
              <div style={styles.textBlock}>
                <span
                  style={{
                    ...styles.title,
                    ...(isSelected ? styles.titleSelected : {}),
                  }}
                >
                  {item.title}
                </span>
                <span style={styles.description}>{item.description}</span>
              </div>
            </div>
          );
        })}
      </div>
    );
  },
);

SlashMenu.displayName = 'SlashMenu';
export default SlashMenu;

// ── Styles ────────────────────────────────────────────────────────────────────
// CSS-in-JS so the component is fully self-contained and doesn't require a
// separate stylesheet injection.  All colours reference Phing's CSS custom
// properties — they resolve correctly inside the tippy.js portal because tippy
// appends to document.body which is inside the :root scope.

const styles: Record<string, React.CSSProperties> = {
  panel: {
    minWidth:        220,
    maxWidth:        280,
    maxHeight:       320,
    overflowY:       'auto',
    background:      'var(--card)',
    backdropFilter:  'blur(16px)',
    WebkitBackdropFilter: 'blur(16px)',
    border:          '0.5px solid var(--border)',
    borderRadius:    14,
    boxShadow:       '0 8px 32px var(--primary-g)',
    padding:         '6px 0 8px',
    fontFamily:      'var(--font-ui)',
    // Thin scrollbar to match Phing's global style
    scrollbarWidth:  'thin',
  },

  sectionLabel: {
    fontSize:       9,
    fontWeight:     700,
    letterSpacing:  '0.08em',
    color:          'var(--muted)',
    padding:        '2px 14px 6px',
    userSelect:     'none',
  },

  row: {
    display:        'flex',
    alignItems:     'center',
    gap:            10,
    padding:        '6px 14px 6px 10px',
    cursor:         'pointer',
    position:       'relative',
    transition:     'background 0.12s',
    background:     'transparent',
  },

  rowSelected: {
    background:     'var(--primary-s)',
  },

  accent: {
    position:       'absolute',
    left:           0,
    top:            '20%',
    bottom:         '20%',
    width:          3,
    borderRadius:   100,
    background:     'var(--primary)',
    transition:     'opacity 0.12s',
  },

  iconBadge: {
    flexShrink:     0,
    width:          28,
    height:         28,
    display:        'flex',
    alignItems:     'center',
    justifyContent: 'center',
    borderRadius:   7,
    fontSize:       10,
    fontWeight:     700,
    fontFamily:     'var(--font-ui)',
    background:     'var(--primary-s)',
    color:          'var(--muted)',
    transition:     'background 0.12s, color 0.12s',
    userSelect:     'none',
  },

  iconBadgeSelected: {
    background:     'var(--primary-g)',
    color:          'var(--primary)',
  },

  textBlock: {
    display:        'flex',
    flexDirection:  'column',
    gap:            1,
    minWidth:       0,
  },

  title: {
    fontSize:       12,
    fontWeight:     500,
    color:          'var(--strong)',
    lineHeight:     1.3,
    transition:     'color 0.12s',
  },

  titleSelected: {
    color:          'var(--primary)',
    fontWeight:     600,
  },

  description: {
    fontSize:       10,
    color:          'var(--muted)',
    lineHeight:     1.3,
  },

  empty: {
    padding:        '10px 14px',
    fontSize:       12,
    color:          'var(--muted)',
    fontStyle:      'italic',
  },
};
