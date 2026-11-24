import { describe, expect, it } from 'vitest';
import { claudeCode, codex, findPlatform } from '../src/platforms/index.js';
import { parsePlatformName } from '../src/shell/cli.js';
import { failureNotice } from '../src/shell/notice.js';
import { memoryStore, readLogs, runCli, tempDir } from './helpers.js';

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

const codexInput = {
  session_id: 'codex-test',
  transcript_path: null,
  cwd: 'D:/work/my-app',
  model: 'test-model',
  permission_mode: 'default',
};
const codexPrompt = {
  ...codexInput,
  hook_event_name: 'UserPromptSubmit',
  prompt: '查看專案慣例',
  turn_id: 'turn-1',
};

describe('codex 轉接層', () => {
  it('讀取 SessionStart 與 UserPromptSubmit 所需欄位', () => {
    expect(codex.readInput({ ...codexInput, hook_event_name: 'SessionStart', source: 'compact' })).toEqual({
      event: 'session-start', nativeEvent: 'SessionStart', sessionId: codexInput.session_id, cwd: codexInput.cwd,
      source: 'compact',
    });
    expect(codex.readInput(codexPrompt)).toEqual({
      event: 'prompt-submit', nativeEvent: 'UserPromptSubmit', sessionId: codexInput.session_id, cwd: codexInput.cwd,
      prompt: codexPrompt.prompt,
    });
  });

  it('以原生事件名輸出 additionalContext', () => {
    for (const hookEventName of ['SessionStart', 'UserPromptSubmit']) {
      const input = codex.readInput({ ...codexInput, hook_event_name: hookEventName });
      expect(JSON.parse(codex.formatOutput(input, '相關記憶'))).toEqual({
        hookSpecificOutput: { hookEventName, additionalContext: '相關記憶' },
      });
    }
  });
});

describe('--platform', () => {
  it('解析參數並依名稱取平台', () => {
    expect(parsePlatformName(['--platform', 'claude-code'])).toBe('claude-code');
    expect(parsePlatformName(['--platform', 'codex'])).toBe('codex');
    expect(parsePlatformName(['--memory-root', 'D:/m'])).toBeUndefined();
    expect(findPlatform('claude-code')).toBe(claudeCode);
    expect(findPlatform('codex')).toBe(codex);
    expect(findPlatform('nope')).toBeUndefined();
  });

  it('以 --platform codex 注入與工作目錄相符的記憶', async () => {
    const root = memoryStore({
      'AGENTS.md': '# 共享記憶\n',
      'areas/my-app.md': `---\nname: my-app\ndescription: 專案慣例\nrepos: [${codexInput.cwd}]\n---\n\n- [stated] 保留完整測試資料\n`,
    });
    const r = await runCli(JSON.stringify(codexPrompt), ['--platform', 'codex', '--memory-root', root], {
      INK_MIST_SESSION_DIR: tempDir(),
      INK_MIST_CACHE_DIR: tempDir(),
    });
    expect(r.code).toBe(0);
    expect(JSON.parse(r.stdout)).toEqual({
      hookSpecificOutput: {
        hookEventName: 'UserPromptSubmit',
        additionalContext: expect.stringContaining('[areas/my-app.md]\n- [stated] 保留完整測試資料'),
      },
    });
  });

  it.each([
    ['SessionStart', { hook_event_name: 'SessionStart', source: 'startup' }],
    ['UserPromptSubmit', { hook_event_name: 'UserPromptSubmit', prompt: '## Memory Writing Agent: Phase 2 (Consolidation)' }],
  ])('Codex 記憶整理 agent 不注入，只寫紀錄：%s', async (event, fields) => {
    const codexHome = tempDir();
    const root = memoryStore({
      'AGENTS.md': '# 共享記憶\n\n## 讀取通則\n\n通則\n',
      'preferences.md': '---\nname: preferences\ndescription: 偏好\nversion: 2026-01-01T00:00:00Z\n---\n\n- [stated] 正體中文\n',
    });
    const input = JSON.stringify({ ...codexInput, ...fields, cwd: `${codexHome}/memories` });
    const r = await runCli(input, ['--platform', 'codex', '--memory-root', root], {
      CODEX_HOME: codexHome,
      INK_MIST_SESSION_DIR: tempDir(),
      INK_MIST_CACHE_DIR: tempDir(),
    });
    expect(r.code).toBe(0);
    expect(r.stdout).toBe('');
    expect(readLogs(root)[0]).toMatchObject({ event, entries: [], notes: ['Codex 記憶整理 agent，不注入'] });
  });

  it('Codex 記憶資料夾以外的工作目錄照常處理', () => {
    const prev = process.env.CODEX_HOME;
    process.env.CODEX_HOME = 'D:/codex-home';
    try {
      expect(codex.readInput({ ...codexPrompt, cwd: 'D:\\Codex-Home\\memories_v2\\skills' }).skip).toBeDefined();
      expect(codex.readInput({ ...codexPrompt, cwd: 'D:/codex-home/memories-old' }).skip).toBeUndefined();
      expect(codex.readInput({ ...codexPrompt, cwd: 'D:/codex-home' }).skip).toBeUndefined();
      expect(claudeCode.readInput({ ...codexPrompt, cwd: 'D:/codex-home/memories' }).skip).toBeUndefined();
    } finally {
      if (prev === undefined) delete process.env.CODEX_HOME;
      else process.env.CODEX_HOME = prev;
    }
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
