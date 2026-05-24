import { create } from 'zustand';

export { decodeNote, encodeNote, stripLegacyBody } from '../lib/frontmatter';

interface VaultStore {
  vaultPath: string | null;
  setVaultPath: (path: string | null) => void;
}

export const useVaultStore = create<VaultStore>((set) => ({
  vaultPath:
    typeof localStorage !== 'undefined' ? localStorage.getItem('phing_vault_path') : null,
  setVaultPath: (path) => {
    if (path) localStorage.setItem('phing_vault_path', path);
    else localStorage.removeItem('phing_vault_path');
    set({ vaultPath: path });
  },
}));
