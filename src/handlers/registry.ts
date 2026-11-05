import type { CoreEvent, HandlerRef } from '../shell/types.js';

/**
 * 核心事件 → 處理函式模組。模組以 default export 提供處理函式，於 worker 中載入。
 */
export const handlers: Partial<Record<CoreEvent, HandlerRef>> = {
  'session-start': new URL('./session-start.js', import.meta.url),
  'prompt-submit': new URL('./user-prompt-submit.js', import.meta.url),
};
