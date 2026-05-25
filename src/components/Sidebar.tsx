/**
 * Sidebar.tsx
 *
 * Three-zone layout:
 *   1. Profile block   — fixed top, never scrolls
 *   2. Nav + Pockets   — flex: 1, scrolls when pocket list overflows
 *   3. Vault + toggle  — fixed bottom, never scrolls
 *
 * Drag-to-pocket:
 *   Each pocket item (and "All Notes") carries a data-pocket-id attribute.
 *   NoteCard's pointer-drag handler uses document.elementsFromPoint to read
 *   this attribute and set the hovered pocket in useNoteDrag.  Sidebar reads
 *   that store to render visual feedback — no direct event wiring needed here.
 *
 * British English spelling maintained throughout.
 */

import React, { useEffect, useRef, useState } from 'react';
import EmojiPicker from './EmojiPicker';
import { motion, AnimatePresence } from 'framer-motion';
import { useNoteStore, Pocket } from '../store/noteStore';
import { useVaultStore } from '../store/vaultStore';
import { truncatePath, defaultVaultPath } from '../lib/vaultPaths';
import { readAvatarFromFile } from '../lib/profileAvatar';
import { isTauri } from '../lib/tauri';
import { useNoteDrag } from '../lib/noteDrag';
import { FileTree } from './FileTree';
import * as vaultService from '../services/vaultService';
import { pocketGlow } from '../lib/pockets';
import { mkdir, exists } from '@tauri-apps/plugin-fs';
import type { AppView } from '../App';

interface LangStrings {
  all: string;
  pockets: string;
  newPocket: string;
  vault: string;
}

const i18n = {
  en: { all: 'All Notes', pockets: 'Pockets', newPocket: '+ New Pocket', vault: 'vault' } as LangStrings,
  th: { all: 'ทั้งหมด', pockets: 'Pockets', newPocket: '+ pocket ใหม่', vault: 'vault' } as LangStrings,
};

const springHover = { type: 'spring' as const, stiffness: 400, damping: 25 };

const Sidebar = ({ view, onViewChange }: { view?: AppView; onViewChange?: (v: AppView) => void }) => {
  const {
    pockets,
    activePocket,
    setActivePocket,
    isDark,
    toggleDark,
    lang,
    profile,
    updateProfile,
    loadVault,
    createFolder,
    deleteFolder,
    vaultTree,
    createSubFolder,
    setPocketEmoji,
  } = useNoteStore();
  const { vaultPath, setVaultPath } = useVaultStore();

  // ── Drag state (read-only in Sidebar — NoteCard writes it) ────────────────
  const hoveredPocketId = useNoteDrag((s) => s.hoveredPocketId);
  const isDraggingAny   = useNoteDrag((s) => s.dragging !== null);

  const t: LangStrings = lang === 'th' ? i18n.th : i18n.en;

  const [vaultOpen,           setVaultOpen]           = useState(false);
  const [newPocketOpen,       setNewPocketOpen]       = useState(false);
  const [newPocketName,       setNewPocketName]       = useState('');
  const [confirmDeletePocket, setConfirmDeletePocket] = useState<string | null>(null);
  const fileInputRef   = useRef<HTMLInputElement>(null);
  const nameRef        = useRef<HTMLDivElement>(null);
  const subtitleRef    = useRef<HTMLDivElement>(null);
  const pocketInputRef = useRef<HTMLInputElement>(null);
  // Guards against the onBlur double-fire that occurs when pressing Enter:
  // setNewPocketOpen(false) unmounts the input, which fires onBlur synchronously
  // before React can re-render, so submitNewPocket would run twice with the
  // same captured newPocketName.  Mirrors the commitFiredRef pattern in
  // FileTree's FolderNode.
  const submitFiredRef = useRef(false);

  const initial = profile.name.trim().charAt(0).toUpperCase() || 'S';

  useEffect(() => {
    if (nameRef.current && document.activeElement !== nameRef.current) {
      nameRef.current.textContent = profile.name;
    }
    if (subtitleRef.current && document.activeElement !== subtitleRef.current) {
      subtitleRef.current.textContent = profile.subtitle;
    }
  }, [profile.name, profile.subtitle]);

  useEffect(() => {
    if (newPocketOpen) {
      submitFiredRef.current = false; // reset guard each time the input opens
      setTimeout(() => pocketInputRef.current?.focus(), 80);
    }
  }, [newPocketOpen]);

  const onFileInput = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const dataUrl = await readAvatarFromFile(file);
    if (dataUrl) updateProfile({ avatarUrl: dataUrl });
    e.target.value = '';
  };

  const onNameBlur     = () => updateProfile({ name:     nameRef.current?.innerText.trim()     || 'Scholar' });
  const onSubtitleBlur = () => updateProfile({ subtitle: subtitleRef.current?.innerText.trim() || '' });

  const submitNewPocket = async () => {
    if (submitFiredRef.current) return; // suppress the onBlur double-fire on Enter
    submitFiredRef.current = true;
    const name = newPocketName.trim();
    if (name) {
      if (vaultPath && vaultTree) {
        // Vault is open — create an actual directory at the vault root so the
        // folder appears in the file tree immediately.  createSubFolder also
        // patches vaultTree and sets activePocket.
        await createSubFolder(vaultPath, name);
      } else {
        // No vault (sample-data / first-run) — create an in-memory pocket only.
        createFolder(name);
      }
    }
    setNewPocketName('');
    setNewPocketOpen(false);
  };

  const applyVault = async (path: string) => {
    if (isTauri()) {
      if (!(await exists(path))) await mkdir(path, { recursive: true });
    }
    setVaultPath(path);
    await loadVault(path);
  };

  const onDeletePocket = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (confirmDeletePocket === id) {
      deleteFolder(id);
      setConfirmDeletePocket(null);
    } else {
      setConfirmDeletePocket(id);
      setTimeout(() => setConfirmDeletePocket((c) => (c === id ? null : c)), 3000);
    }
  };

  return (
    <div style={{ width: '100%', height: '100%' }}>
      {/* Hidden file input for avatar upload */}
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        style={{ display: 'none' }}
        onChange={onFileInput}
      />

      <div
        style={{
          width:                200,
          height:               '100%',
          background:           'var(--sidebar-bg)',
          backdropFilter:       'blur(24px)',
          WebkitBackdropFilter: 'blur(24px)',
          borderRight:          '0.5px solid var(--border)',
          display:              'flex',
          flexDirection:        'column',
          overflow:             'hidden',
        }}
      >

        {/* ── Zone 1: Profile (fixed top) ───────────────────────────────── */}
        <motion.div
          whileHover={{ background: 'var(--primary-s)' }}
          transition={springHover}
          style={{
            flexShrink:   0,
            display:      'flex',
            alignItems:   'center',
            gap:          10,
            padding:      '14px 10px 12px',
            borderBottom: '0.5px solid var(--divider)',
          }}
        >
          <button
            type="button"
            className="sidebar-profile__avatar"
            onClick={() => fileInputRef.current?.click()}
            title="Change avatar"
            aria-label="Change avatar"
          >
            {profile.avatarUrl ? <img src={profile.avatarUrl} alt="" /> : initial}
          </button>
          <div style={{ minWidth: 0, flex: 1 }}>
            <div
              ref={nameRef}
              className="sidebar-profile__name"
              contentEditable
              suppressContentEditableWarning
              onBlur={onNameBlur}
              onKeyDown={(e) => {
                if (e.key === 'Enter') { e.preventDefault(); subtitleRef.current?.focus(); }
              }}
            />
            <div
              ref={subtitleRef}
              className="sidebar-profile__subtitle"
              contentEditable
              suppressContentEditableWarning
              onBlur={onSubtitleBlur}
              onKeyDown={(e) => e.key === 'Enter' && e.preventDefault()}
            />
          </div>
        </motion.div>

        {/* ── Zone 2: Navigation + Pockets (scrollable) ────────────────── */}
        <div
          className="sidebar-nav-scroll"
          style={{
            flex:            1,
            overflowY:       'auto',
            overflowX:       'hidden',
            minHeight:       0,
            paddingTop:      10,
            paddingBottom:   8,
            scrollbarGutter: 'stable',
          }}
        >
          {/* Top nav */}
          <SectionLabel label="Navigation" />

          {/* "All Notes" — drop target for moving notes to root (no pocket) */}
          <NavItem
            label={t.all}
            icon="≡"
            active={activePocket === '' && view !== 'board'}
            isDropTarget={isDraggingAny && hoveredPocketId === ''}
            pocketId=""
            onClick={() => { onViewChange?.('notes'); setActivePocket(''); }}
          />
          <NavItem
            label="Board"
            icon="✦"
            active={view === 'board'}
            onClick={() => onViewChange?.('board')}
          />

          {/* ── Files section ────────────────────────────────────────── */}
          <div style={{ height: 14 }} />
          <div
            style={{
              display:        'flex',
              alignItems:     'center',
              justifyContent: 'space-between',
              padding:        '0 10px 4px',
            }}
          >
            <SectionLabel label="Pockets" />
            {/* New top-level folder button */}
            <motion.button
              type="button"
              whileHover={{ color: 'var(--primary)' }}
              onClick={() => setNewPocketOpen(true)}
              title="New top-level folder"
              style={{
                border:     'none',
                background: 'transparent',
                cursor:     'pointer',
                color:      'var(--soft)',
                fontSize:   10,
                fontFamily: 'var(--font-ui)',
                padding:    '0 2px',
                lineHeight: 1,
              }}
            >
              +
            </motion.button>
          </div>

          {/* New top-level folder inline input */}
          <AnimatePresence>
            {newPocketOpen && (
              <motion.div
                initial={{ height: 0, opacity: 0, y: -4 }}
                animate={{ height: 'auto', opacity: 1, y: 0 }}
                exit={{ height: 0, opacity: 0, y: -4 }}
                transition={{ type: 'spring', stiffness: 380, damping: 30 }}
                style={{ overflow: 'hidden', padding: '0 6px' }}
              >
                <input
                  ref={pocketInputRef}
                  value={newPocketName}
                  onChange={(e) => setNewPocketName(e.target.value)}
                  placeholder="Folder name…"
                  onKeyDown={(e) => {
                    if (e.key === 'Enter')  { e.preventDefault(); submitNewPocket(); }
                    if (e.key === 'Escape') { e.preventDefault(); setNewPocketName(''); setNewPocketOpen(false); }
                  }}
                  onBlur={() => {
                    if (newPocketName.trim()) submitNewPocket();
                    else setNewPocketOpen(false);
                  }}
                  style={{
                    width:        '100%',
                    margin:       '4px 0',
                    padding:      '6px 10px',
                    fontSize:     11,
                    borderRadius: 8,
                    border:       '0.5px solid var(--primary)',
                    background:   'var(--card)',
                    color:        'var(--strong)',
                    fontFamily:   'var(--font-ui)',
                    outline:      'none',
                  }}
                />
              </motion.div>
            )}
          </AnimatePresence>

          {/* ── File tree (when vault is loaded) / flat pocket list (fallback) ── */}
          {vaultTree ? (
            /* Vault is open — render the recursive file tree */
            <FileTree nodes={vaultTree.children} vaultPath={vaultPath ?? ''} />
          ) : (
            /* No vault yet — render the classic flat Pocket list as fallback */
            <AnimatePresence initial={false}>
              {pockets.map((p: Pocket) => {
                const isActive     = activePocket === p.id;
                const isDeleting   = confirmDeletePocket === p.id;
                const isDropTarget = isDraggingAny && hoveredPocketId === p.id;
                return (
                  <motion.div
                    key={p.id}
                    initial={{ opacity: 0, height: 0 }}
                    animate={{ opacity: 1, height: 'auto' }}
                    exit={{ opacity: 0, height: 0, marginBottom: 0 }}
                    transition={{ duration: 0.18, ease: [0.4, 0, 0.2, 1] }}
                    style={{ overflow: 'hidden' }}
                  >
                    <motion.div
                      animate={{ scale: isDropTarget ? 1.025 : 1 }}
                      transition={{ type: 'spring', stiffness: 600, damping: 35 }}
                      style={{ transformOrigin: 'left center' }}
                    >
                      <motion.div
                        data-pocket-id={p.id}
                        whileHover={{
                          background: pocketGlow(p.color, 0.15),
                          color:      'var(--primary)',
                        }}
                        onClick={() => setActivePocket(p.id)}
                        className={`sidebar-pocket-item${isDropTarget ? ' sidebar-pocket-item--droptarget' : ''}`}
                        style={{
                          display:      'flex',
                          alignItems:   'center',
                          gap:           8,
                          // Pocket color always visible as a 2.5px left border —
                          // this replaces the tiny dot as the primary color signal.
                          borderLeft:   `2.5px solid ${p.color}`,
                          padding:      '6px 10px 6px 8px',
                          borderRadius: '0 var(--r-sm) var(--r-sm) 0',
                          cursor:       'pointer',
                          fontSize:      11,
                          marginBottom:  2,
                          color:         isDropTarget || isActive ? 'var(--primary)' : 'var(--muted)',
                          background:    isDropTarget
                            ? pocketGlow(p.color, 0.22)
                            : isActive
                              ? pocketGlow(p.color, 0.12)
                              : pocketGlow(p.color, 0.04),
                          fontWeight:    isActive ? 600 : 400,
                          transition:   'background 0.12s, color 0.12s, border-color 0.12s',
                        }}
                      >
                        {/* Color dot — visible only while dragging for drop-target pulse */}
                        {isDraggingAny && (
                          <motion.div
                            animate={isDropTarget
                              ? { scale: [1, 1.55, 1], transition: { repeat: Infinity, duration: 0.85, ease: 'easeInOut' } }
                              : { scale: 1,             transition: { type: 'spring', stiffness: 400, damping: 20 } }
                            }
                            style={{
                              width: 7, height: 7, borderRadius: '50%',
                              background: p.color,
                              boxShadow:  isDropTarget
                                ? `0 0 10px ${pocketGlow(p.color, 0.8)}`
                                : `0 0 6px ${pocketGlow(p.color, 0.5)}`,
                              flexShrink: 0,
                            }}
                          />
                        )}
                        {/* Emoji trigger — replaces the static inline emoji prefix */}
                        <EmojiPicker
                          emoji={p.emoji}
                          defaultEmoji="📂"
                          onSelect={(em) => setPocketEmoji(p.id, em)}
                        />
                        <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {p.name}
                        </span>
                        <button
                          type="button"
                          className="sidebar-pocket-delete"
                          onClick={(e) => onDeletePocket(p.id, e)}
                          title={isDeleting ? 'Click again to delete' : 'Delete pocket'}
                          style={{
                            opacity: isDeleting ? 1 : undefined,
                            color:   isDeleting ? '#FF5252' : undefined,
                            background: isDeleting ? 'rgba(255,82,82,0.1)' : undefined,
                            fontSize: 9, fontWeight: 700, padding: '2px 5px', borderRadius: 5,
                          }}
                        >
                          {isDeleting ? 'del?' : '✕'}
                        </button>
                      </motion.div>
                    </motion.div>
                  </motion.div>
                );
              })}
            </AnimatePresence>
          )}
        </div>

        {/* ── Zone 3: Vault info + dark-mode toggle (fixed bottom) ─────── */}
        <div
          style={{
            flexShrink: 0,
            padding:    '8px 10px',
            borderTop:  '0.5px solid var(--divider)',
            fontSize:   9,
            color:      'var(--muted)',
          }}
        >
          <motion.button
            type="button"
            onClick={() => setVaultOpen((v) => !v)}
            whileHover={{ color: 'var(--primary)' }}
            transition={springHover}
            style={{
              display:    'flex',
              alignItems: 'center',
              gap:        6,
              width:      '100%',
              border:     'none',
              background: 'transparent',
              cursor:     'pointer',
              padding:    '4px 2px',
              color:      'inherit',
              fontFamily: 'var(--font-ui)',
              fontSize:   9,
            }}
          >
            <span style={{ fontSize: 10 }}>(o_o)</span>
            <span style={{ fontWeight: 700, color: 'var(--primary)' }}>Phing</span>
            <span style={{ marginLeft: 'auto', opacity: 0.6 }}>{vaultOpen ? '▾' : '▸'}</span>
            <span style={{ opacity: 0.7 }}>{t.vault}</span>
          </motion.button>

          <AnimatePresence initial={false}>
            {vaultOpen && (
              <motion.div
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: 'auto', opacity: 1 }}
                exit={{ height: 0, opacity: 0 }}
                transition={{ duration: 0.22, ease: [0.4, 0, 0.2, 1] }}
                style={{ overflow: 'hidden' }}
              >
                <div style={{ padding: '8px 2px 6px' }}>
                  <div className="sidebar-vault__path" title={vaultPath ?? 'No vault selected'}>
                    {vaultPath ? truncatePath(vaultPath) : 'No vault — choose below'}
                  </div>
                  <button
                    type="button"
                    className="sidebar-vault__btn"
                    onClick={async () => {
                      const path = await vaultService.pickVaultDirectory();
                      if (path) await applyVault(path);
                    }}
                  >
                    Change vault
                  </button>
                  <button
                    type="button"
                    className="sidebar-vault__btn"
                    onClick={() => { void defaultVaultPath().then((path) => applyVault(path)); }}
                  >
                    Use default (~/Documents/Phing)
                  </button>
                </div>
              </motion.div>
            )}
          </AnimatePresence>

          {/* Dark-mode pill toggle */}
          <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 6 }}>
            <motion.div
              onClick={toggleDark}
              whileHover={{ scale: 1.08 }}
              whileTap={{ scale: 0.94 }}
              style={{
                width:        34,
                height:       19,
                background:   'var(--primary-s)',
                border:       '1.5px solid var(--primary)',
                borderRadius: 100,
                cursor:       'pointer',
                display:      'flex',
                alignItems:   'center',
                padding:      2,
              }}
            >
              <motion.div
                animate={{ x: isDark ? 15 : 0 }}
                transition={{ type: 'spring', stiffness: 500, damping: 30 }}
                style={{
                  width:          13,
                  height:         13,
                  background:     'var(--primary)',
                  borderRadius:   '50%',
                  display:        'flex',
                  alignItems:     'center',
                  justifyContent: 'center',
                  fontSize:       7,
                  color:          'white',
                }}
              >
                ✦
              </motion.div>
            </motion.div>
          </div>
        </div>
      </div>
    </div>
  );
};

// ─── Sub-components ────────────────────────────────────────────────────────────

const SectionLabel = ({ label }: { label: string }) => (
  <div
    style={{
      fontSize:      8,
      fontWeight:    700,
      color:         'var(--muted)',
      letterSpacing: '0.8px',
      textTransform: 'uppercase',
      padding:       '0 10px',
      marginBottom:  4,
    }}
  >
    {label}
  </div>
);

const NavItem = ({
  label, icon, active, onClick, isDropTarget = false, pocketId,
}: {
  label:         string;
  icon:          string;
  active:        boolean;
  onClick:       () => void;
  isDropTarget?: boolean;
  /** When set, the element carries data-pocket-id for drag detection. */
  pocketId?:     string;
}) => (
  <motion.div
    whileHover={{ background: 'var(--primary-s)', color: 'var(--primary)' }}
    transition={springHover}
    onClick={onClick}
    // data-pocket-id is the hook for NoteCard's elementsFromPoint detection.
    {...(pocketId !== undefined ? { 'data-pocket-id': pocketId } : {})}
    className={isDropTarget ? 'sidebar-pocket-item--droptarget' : undefined}
    style={{
      display:      'flex',
      alignItems:   'center',
      gap:          7,
      borderLeft:   `2px solid ${isDropTarget || active ? 'var(--primary)' : 'transparent'}`,
      padding:      '6px 10px 6px 8px',
      borderRadius: '0 var(--r-sm) var(--r-sm) 0',
      cursor:       'pointer',
      fontSize:     11,
      marginBottom: 1,
      color:        isDropTarget || active ? 'var(--primary)' : 'var(--muted)',
      background:   isDropTarget ? 'var(--primary-s)' : active ? 'var(--primary-g)' : 'transparent',
      fontWeight:   active ? 600 : 400,
      transition:   'background 0.12s, color 0.12s, border-color 0.12s',
    }}
  >
    <span>{icon}</span> {label}
  </motion.div>
);

export default Sidebar;
