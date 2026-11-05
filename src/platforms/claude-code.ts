import type { CoreEvent } from '../shell/types.js';
import type { Platform } from './types.js';

const EVENTS: Record<string, CoreEvent> = {
  SessionStart: 'session-start',
  UserPromptSubmit: 'prompt-submit',
};

function str(v: unknown): string | undefined {
  return typeof v === 'string' ? v : undefined;
}

/**
 * Claude Code：輸入欄位為 `hook_event_name`、`session_id`、`cwd`、`prompt`、`source`；
 * 輸出 `hookSpecificOutput.additionalContext`，上限 10,000 字元，超過時 agent 只看得到前 2,000 字元預覽。
 */
export const claudeCode: Platform = {
  name: 'claude-code',
  maxChars: 10000,
  readInput(raw) {
    const nativeEvent = str(raw.hook_event_name);
    const event = nativeEvent === undefined ? undefined : EVENTS[nativeEvent];
    const prompt = str(raw.prompt);
    const source = str(raw.source);
    return {
      ...(event !== undefined && { event }),
      ...(nativeEvent !== undefined && { nativeEvent }),
      sessionId: str(raw.session_id) ?? '',
      cwd: str(raw.cwd) ?? '',
      ...(prompt !== undefined && { prompt }),
      ...(source !== undefined && { source }),
    };
  },
  formatOutput(input, context) {
    // 事件名不明（輸入壞掉時的失敗通知）時以送出提示的事件輸出
    return JSON.stringify({
      hookSpecificOutput: { hookEventName: input.nativeEvent ?? 'UserPromptSubmit', additionalContext: context },
    });
  },
};
