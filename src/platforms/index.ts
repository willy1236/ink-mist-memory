import { claudeCode } from './claude-code.js';
import type { Platform } from './types.js';

export type { Platform } from './types.js';
export { claudeCode };

/** 支援的平台；新平台加一個轉接層檔並列在這裡。 */
export const PLATFORMS: readonly Platform[] = [claudeCode];

export const DEFAULT_PLATFORM = claudeCode;

/** 依名稱取平台；找不到時 undefined。 */
export function findPlatform(name: string): Platform | undefined {
  return PLATFORMS.find((p) => p.name === name);
}
