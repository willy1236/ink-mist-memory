import { describe, expect, it } from 'vitest';
import { claudeCode, findPlatform } from '../src/platforms/index.js';
import { parsePlatformName } from '../src/shell/cli.js';
import { failureNotice } from '../src/shell/notice.js';
import { memoryStore, readLogs, runCli } from './helpers.js';

describe('claudeCode 轉接層', () => {
  it('原生事件對應到核心事件，欄位改成正規化名稱', () => {
    expect(claudeCode.readInput({ hook_event_name: 'SessionStart', session_id: 's', cwd: 'D:/a', source: 'resume' }))
      .toEqual({ event: 'session-start', nativeEvent: 'SessionStart', sessionId: 's', cwd: 'D:/a', source: 'resume' });
    expect(claudeCode.readInput({ hook_event_name: 'UserPromptSubmit', session_id: 's', cwd: 'D:/a', prompt: 'p' }))
      .toEqual({ event: 'prompt-submit', nativeEvent: 'UserPromptSubmit', sessionId: 's', cwd: 'D:/a', prompt: 'p' });
  });

  it('不支援的事件只留原生名稱，缺欄位時給預設值', () => {
    expect(claudeCode.readInput({ hook_event_name: 'sessionStart' })).toEqual({ nativeEvent: 'sessionStart', sessionId: '', cwd: '' });
    expect(claudeCode.readInput({})).toEqual({ sessionId: '', cwd: '' });
  });

  it('輸出 hookSpecificOutput，事件名不明時用 UserPromptSubmit', () => {
    expect(JSON.parse(claudeCode.formatOutput({ nativeEvent: 'SessionStart', sessionId: '', cwd: '' }, 'x'))).toEqual({
      hookSpecificOutput: { hookEventName: 'SessionStart', additionalContext: 'x' },
    });
    expect(JSON.parse(claudeCode.formatOutput({ sessionId: '', cwd: '' }, 'x')).hookSpecificOutput.hookEventName)
      .toBe('UserPromptSubmit');
  });
});

describe('--platform', () => {
  it('解析參數並依名稱取平台', () => {
    expect(parsePlatformName(['--platform', 'claude-code'])).toBe('claude-code');
    expect(parsePlatformName(['--memory-root', 'D:/m'])).toBeUndefined();
    expect(findPlatform('claude-code')).toBe(claudeCode);
    expect(findPlatform('nope')).toBeUndefined();
  });

  it('不支援的平台輸出失敗通知並寫紀錄', async () => {
    const root = memoryStore({ 'AGENTS.md': '# x\n' });
    const input = JSON.stringify({ hook_event_name: 'UserPromptSubmit', session_id: 's', cwd: 'D:/a', prompt: 'p' });
    const r = await runCli(input, ['--platform', 'nope', '--memory-root', root]);
    expect(r.code).toBe(0);
    expect(JSON.parse(r.stdout).hookSpecificOutput.additionalContext).toBe(failureNotice(root));
    expect(readLogs(root)[0]).toMatchObject({ event: 'UserPromptSubmit', failure: expect.stringContaining('不支援的平台 nope') });
  });
});
