import type { CoreEvent } from '../shell/types.js';
import type { Platform } from './types.js';

const EVENTS = new Map<string, CoreEvent>([
  ['SessionStart', 'session-start'],
  ['UserPromptSubmit', 'prompt-submit'],
]);

function str(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

/** Claude Code 與 Codex 共用的 hook JSON 格式。 */
export const jsonContextHook: Pick<Platform, 'readInput' | 'formatOutput'> = {
  readInput(raw) {
    const nativeEvent = str(raw.hook_event_name);
    const event = nativeEvent === undefined ? undefined : EVENTS.get(nativeEvent);
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
