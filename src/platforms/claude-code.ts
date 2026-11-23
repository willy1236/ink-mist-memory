import { jsonContextHook } from './json-context-hook.js';
import type { Platform } from './types.js';

/**
 * Claude Code：輸入欄位為 `hook_event_name`、`session_id`、`cwd`、`prompt`、`source`；
 * 輸出 `hookSpecificOutput.additionalContext`，上限 10,000 字元，超過時 agent 只看得到前 2,000 字元預覽。
 */
export const claudeCode: Platform = {
  name: 'claude-code',
  maxChars: 10000,
  ...jsonContextHook,
};
