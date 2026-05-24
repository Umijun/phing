import { homeDir, join } from '@tauri-apps/api/path';
import { isTauri } from './tauri';

export async function defaultVaultPath(): Promise<string> {
  if (!isTauri()) return '~/Documents/Phing';
  const home = await homeDir();
  return join(home, 'Documents', 'Phing');
}

export function truncatePath(path: string, maxLen = 26): string {
  if (path.length <= maxLen) return path;
  return `…${path.slice(-(maxLen - 1))}`;
}
