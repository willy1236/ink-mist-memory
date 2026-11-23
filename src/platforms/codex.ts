import { jsonContextHook } from './json-context-hook.js';
import type { Platform } from './types.js';

export const codex: Platform = {
  name: 'codex',
  // 搭配 README 的 additionalContextLimit，為中文記憶保留完整條目的空間。
  maxChars: 10000,
  ...jsonContextHook,
};
