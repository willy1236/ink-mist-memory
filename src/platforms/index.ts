import { claudeCode } from './claude-code.js';
import { codex } from './codex.js';
import type { Platform } from './types.js';

export type { Platform } from './types.js';
export { claudeCode, codex };

/** 支援的平台；新平台加一個轉接層檔並列在這裡。 */
export const PLATFORMS: readonly Platform[] = [claudeCode, codex];

export const DEFAULT_PLATFORM = claudeCode;

/** 依名稱取平台；找不到時 undefined。 */
export function findPlatform(name: string): Platform | undefined {
  return PLATFORMS.find((p) => p.name === name);
}
