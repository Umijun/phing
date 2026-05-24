import React, { useRef, useState } from 'react';
import { motion } from 'framer-motion';
import { useNoteStore } from '../store/noteStore';
import { useVaultStore } from '../store/vaultStore';
import { isTauri } from '../lib/tauri';

// ─── Props ────────────────────────────────────────────────────────────────────

interface OnboardingProps {
  onComplete: () => void;
}

// ─── Component ────────────────────────────────────────────────────────────────

const Onboarding = ({ onComplete }: OnboardingProps) => {
  const { profile, updateProfile, openVaultPicker } = useNoteStore();
  const vaultPath = useVaultStore((s) => s.vaultPath);

  const [name, setName]         = useState(profile.name);
  const [subtitle, setSubtitle] = useState(profile.subtitle);
  const [avatarSrc, setAvatarSrc] = useState(profile.avatarUrl ?? '');
  const [picking, setPicking]   = useState(false);

  const avatarInputRef = useRef<HTMLInputElement>(null);

  // ── Avatar upload ──────────────────────────────────────────────────────────
  const handleAvatarChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const url = URL.createObjectURL(file);
    setAvatarSrc(url);
  };

  // ── Vault picker ───────────────────────────────────────────────────────────
  const handlePickVault = async () => {
    if (!isTauri()) {
      // Browser fallback — allow continuing without a vault
      onComplete();
      return;
    }
    setPicking(true);
    try {
      await openVaultPicker();
    } finally {
      setPicking(false);
    }
  };

  // ── Complete onboarding ────────────────────────────────────────────────────
  const handleBegin = () => {
    // Persist name / subtitle / avatar
    updateProfile({
      name:      name.trim() || 'Scholar',
      subtitle:  subtitle.trim(),
      avatarUrl: avatarSrc || undefined,
    });
    onComplete();
  };

  const canBegin = name.trim().length > 0;

  return (
    <div className="onboarding-root">
      <motion.div
        className="onboarding-card"
        initial={{ opacity: 0, y: 28, scale: 0.96 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={{ type: 'spring', stiffness: 320, damping: 28 }}
      >
        {/* ── Logo / wordmark ──────────────────────────────────────────────── */}
        <div className="onboarding-logo">✦ phing</div>
        <div className="onboarding-headline">your quiet corner for thinking</div>
        <div className="onboarding-sub">
          let's set you up in thirty seconds, then we'll leave you in peace.
        </div>

        {/* ── Avatar row ───────────────────────────────────────────────────── */}
        <div className="onboarding-avatar-row">
          <button
            type="button"
            className="onboarding-avatar"
            title="Upload a profile photo"
            onClick={() => avatarInputRef.current?.click()}
          >
            {avatarSrc
              ? <img src={avatarSrc} alt="avatar" />
              : <span style={{ fontSize: 28 }}>🌸</span>}
          </button>
          <input
            ref={avatarInputRef}
            type="file"
            accept="image/*"
            style={{ display: 'none' }}
            onChange={handleAvatarChange}
          />
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 10 }}>
            {/* Name */}
            <div className="onboarding-section">
              <label className="onboarding-label" htmlFor="ob-name">your name</label>
              <input
                id="ob-name"
                className="onboarding-input"
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g. Alex"
                maxLength={48}
                autoFocus
              />
            </div>
            {/* Subtitle */}
            <div className="onboarding-section">
              <label className="onboarding-label" htmlFor="ob-sub">a short line about you</label>
              <input
                id="ob-sub"
                className="onboarding-input"
                type="text"
                value={subtitle}
                onChange={(e) => setSubtitle(e.target.value)}
                placeholder="e.g. student of law & late-night ramen"
                maxLength={80}
              />
            </div>
          </div>
        </div>

        {/* ── Vault picker ─────────────────────────────────────────────────── */}
        <div className="onboarding-section" style={{ marginTop: 8 }}>
          <label className="onboarding-label">notes vault</label>
          <div style={{ display: 'flex', flexDirection: 'row', alignItems: 'center', gap: 10, minWidth: 0 }}>
            <div
              className="onboarding-vault-path"
              title={vaultPath ?? 'No folder selected'}
            >
              {vaultPath ?? 'no folder selected yet'}
            </div>
            <button
              type="button"
              className="onboarding-btn onboarding-btn--ghost"
              style={{ width: 'auto', flexShrink: 0 }}
              onClick={handlePickVault}
              disabled={picking}
            >
              {picking ? 'opening…' : '📁 choose'}
            </button>
          </div>
          {!isTauri() && (
            <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 6, fontStyle: 'italic' }}>
              running in browser — vault sync not available
            </div>
          )}
        </div>

        {/* ── Begin button ─────────────────────────────────────────────────── */}
        <button
          type="button"
          className="onboarding-btn"
          style={{ marginTop: 8, width: '100%' }}
          disabled={!canBegin}
          onClick={handleBegin}
        >
          begin writing ✦
        </button>

        {/* ── Skip link ────────────────────────────────────────────────────── */}
        <button
          type="button"
          className="onboarding-btn onboarding-btn--ghost"
          style={{ marginTop: 8, width: '100%' }}
          onClick={handleBegin}
        >
          skip for now
        </button>
      </motion.div>
    </div>
  );
};

export default Onboarding;
