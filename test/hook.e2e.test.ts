import { describe, expect, it } from 'vitest';
import { parseMemoryRoot } from '../src/shell/cli.js';
import { failureNotice } from '../src/shell/notice.js';
import { sessionState } from '../src/shell/session-state.js';
import { handlerModule, readLogs, runCli, tempDir } from './helpers.js';

const promptInput = JSON.stringify({ hook_event_name: 'UserPromptSubmit', session_id: 's', cwd: 'D:/x', prompt: 'p' });

describe('dist/hook.js', () => {
  it('無法解析的輸入：exit 0、輸出失敗通知並寫紀錄', async () => {
    const root = tempDir();
    const r = await runCli('not json', ['--memory-root', root], { INK_MIST_SESSION_DIR: tempDir() });
    expect(r.code).toBe(0);
    expect(JSON.parse(r.stdout).hookSpecificOutput.additionalContext).toBe(failureNotice(root));
    expect(readLogs(root)[0]).toMatchObject({ failure: expect.stringContaining('外殼錯誤') });
  });

  it('依 hook_event_name 分派；未登記的事件輸出失敗通知，exit 0，並記下耗時', async () => {
    const root = tempDir();
    const input = JSON.stringify({ hook_event_name: 'Stop', session_id: 's', cwd: 'D:/x', prompt: 'p' });
    const r = await runCli(input, ['--memory-root', root], { INK_MIST_SESSION_DIR: tempDir() });
    expect(r.code).toBe(0);
    const out = JSON.parse(r.stdout).hookSpecificOutput;
    expect(out.hookEventName).toBe('Stop');
    expect(out.additionalContext).toBe(failureNotice(root));
    const log = readLogs(root)[0]!;
    expect(log).toMatchObject({ session_id: 's', prompt: 'p' });
    console.log(`hook.js 牆鐘耗時 ${r.ms} ms；紀錄中 duration_ms（含啟動）${String(log.duration_ms)} ms`);
    expect(r.ms).toBeLessThan(3000);
  });

  it('處理函式準時回傳：輸出注入內容並記去重，從 spawn 起計時', async () => {
    const root = tempDir();
    const sessions = tempDir();
    const h = handlerModule(
      tempDir(),
      `return { sections: [], candidates: [{ id: 'a', file: 'areas/a.md', text: '- [stated] A', signal: 'cwd' }], isIndex: false, notes: [] };`,
    );
    const r = await runCli(promptInput, ['--memory-root', root], {
      INK_MIST_SESSION_DIR: sessions,
      INK_MIST_HANDLERS: JSON.stringify({ 'prompt-submit': h }),
    });
    expect(r.code).toBe(0);
    expect(JSON.parse(r.stdout).hookSpecificOutput.additionalContext).toContain('[areas/a.md]\n- [stated] A');
    expect(sessionState('s', sessions).get().injectedIds).toEqual(['a']);
    console.log(`成功路徑（含 worker）牆鐘耗時 ${r.ms} ms`);
    expect(r.ms).toBeLessThan(3000);
  });

  it('處理函式卡死：從 spawn 起 3 秒內 exit 0 並輸出失敗通知', async () => {
    const root = tempDir();
    const h = handlerModule(tempDir(), `for (;;) {}`);
    const r = await runCli(promptInput, ['--memory-root', root], {
      INK_MIST_SESSION_DIR: tempDir(),
      INK_MIST_HANDLERS: JSON.stringify({ 'prompt-submit': h }),
    });
    expect(r.code).toBe(0);
    expect(JSON.parse(r.stdout).hookSpecificOutput.additionalContext).toBe(failureNotice(root));
    console.log(`處理函式卡死時牆鐘耗時 ${r.ms} ms`);
    expect(r.ms).toBeLessThan(3000);
  });

  it('外殼自身卡住（stdin 未關閉）：watchdog 在 3 秒內輸出失敗通知並寫紀錄', async () => {
    const root = tempDir();
    const r = await runCli(undefined, ['--memory-root', root], { INK_MIST_SESSION_DIR: tempDir() });
    expect(r.code).toBe(0);
    expect(JSON.parse(r.stdout).hookSpecificOutput.additionalContext).toBe(failureNotice(root));
    expect(readLogs(root)[0]).toMatchObject({ failure: expect.stringContaining('外殼逾時') });
    console.log(`watchdog 牆鐘耗時 ${r.ms} ms`);
    expect(r.ms).toBeLessThan(3000);
  });
});

describe('記憶庫路徑', () => {
  it('--memory-root 優先，其次 INK_MIST_MEMORY_ROOT，都沒有時為 undefined', () => {
    const env = { INK_MIST_MEMORY_ROOT: 'D:/env/m' };
    expect(parseMemoryRoot(['--memory-root', 'D:/save/x'], env)).toBe('D:/save/x');
    expect(parseMemoryRoot([], env)).toBe('D:/env/m');
    expect(parseMemoryRoot(['--memory-root'], env)).toBe('D:/env/m');
    expect(parseMemoryRoot([], {})).toBeUndefined();
    expect(parseMemoryRoot([], { INK_MIST_MEMORY_ROOT: '' })).toBeUndefined();
  });

  it('用環境變數指定記憶庫', async () => {
    const root = tempDir();
    const r = await runCli('not json', [], { INK_MIST_MEMORY_ROOT: root, INK_MIST_SESSION_DIR: tempDir() });
    expect(JSON.parse(r.stdout).hookSpecificOutput.additionalContext).toBe(failureNotice(root));
    expect(readLogs(root)).toHaveLength(1);
  });

  it('沒有設定時輸出「路徑未設定」的失敗通知，exit 0', async () => {
    const r = await runCli(promptInput, [], { INK_MIST_MEMORY_ROOT: '', INK_MIST_SESSION_DIR: tempDir() });
    expect(r.code).toBe(0);
    expect(JSON.parse(r.stdout).hookSpecificOutput).toEqual({
      hookEventName: 'UserPromptSubmit',
      additionalContext: failureNotice(undefined),
    });
  });
});
