import { describe, expect, it } from 'vitest';
import { failureNotice } from '../src/shell/notice.js';
import { sessionState } from '../src/shell/session-state.js';
import { handlerModule, memoryStore, readLogs, runCli, tempDir } from './helpers.js';

const PREFS = '---\nname: preferences\ndescription: 偏好\n---\n\n- [stated] 預設用正體中文回應\n';
const CONDUCT = '---\nname: conduct\ndescription: 紀律\n---\n\n- [stated] 動手前先確認現況\n';
const AGENTS = '# 共享記憶\n\n## 0. 讀取通則\n- 回覆不提「根據記憶」\n\n## 1. 結構\n不相關的內容\n';

function startInput(source: string, sessionId = 's1') {
  return JSON.stringify({ hook_event_name: 'SessionStart', session_id: sessionId, cwd: 'D:/x', source });
}

function context(stdout: string): string {
  return JSON.parse(stdout).hookSpecificOutput.additionalContext as string;
}

/** 先放一些已注入狀態，用來確認 session 開始會重置。 */
function dirtySessions(sessionId = 's1'): string {
  const dir = tempDir();
  const s = sessionState(sessionId, dir);
  s.markInjected(['old']);
  s.markIndexInjected();
  return dir;
}

describe('SessionStart 處理函式（dist/hook.js）', () => {
  it('resume：照常注入必載內容，但延續去重狀態', async () => {
    const root = memoryStore({ 'preferences.md': PREFS, 'conduct.md': CONDUCT, 'AGENTS.md': AGENTS });
    const sessions = dirtySessions();
    const r = await runCli(startInput('resume'), ['--memory-root', root], { INK_MIST_SESSION_DIR: sessions });
    expect(context(r.stdout)).toContain('預設用正體中文回應');
    expect(sessionState('s1', sessions).get()).toEqual({ injectedIds: ['old'], indexInjected: true });
  });

  it.each(['startup', 'fork', 'clear', 'compact'])(
    '%s：依序注入兩份必載檔全文與讀取通則，重置去重狀態並寫紀錄',
    async (source) => {
      const root = memoryStore({ 'preferences.md': PREFS, 'conduct.md': CONDUCT, 'AGENTS.md': AGENTS });
      const sessions = dirtySessions();
      const r = await runCli(startInput(source), ['--memory-root', root], { INK_MIST_SESSION_DIR: sessions });
      expect(r.code).toBe(0);
      const text = context(r.stdout);
      const iPrefs = text.indexOf('預設用正體中文回應');
      const iConduct = text.indexOf('動手前先確認現況');
      const iRules = text.indexOf('回覆不提「根據記憶」');
      expect(iPrefs).toBeGreaterThanOrEqual(0);
      expect(iConduct).toBeGreaterThan(iPrefs);
      expect(iRules).toBeGreaterThan(iConduct);
      expect(text).toContain('name: preferences'); // 全文，含 frontmatter
      expect(text).not.toContain('不相關的內容');
      expect(text).not.toContain(failureNotice(root));
      expect(sessionState('s1', sessions).get()).toEqual({ injectedIds: [], indexInjected: false });
      const logs = readLogs(root);
      expect(logs).toHaveLength(1);
      expect(logs[0]).toMatchObject({ event: 'SessionStart', session_id: 's1', source, notes: [] });
      expect(logs[0]!.failure).toBeUndefined();
      expect(r.ms).toBeLessThan(3000);
    },
  );

  it('任一讀不到：注入讀得到的部分並附失敗通知', async () => {
    const root = memoryStore({ 'preferences.md': PREFS, 'AGENTS.md': '# 沒有讀取通則\n' });
    const r = await runCli(startInput('startup'), ['--memory-root', root], { INK_MIST_SESSION_DIR: tempDir() });
    const text = context(r.stdout);
    expect(text).toContain('預設用正體中文回應');
    expect(text.endsWith(failureNotice(root))).toBe(true);
    const log = readLogs(root)[0]!;
    expect(log.failure).toContain('conduct.md');
    expect(log.failure).toContain('讀取通則');
  });

  it('記憶庫不存在：只注入失敗通知', async () => {
    const root = `${tempDir()}/missing`;
    const r = await runCli(startInput('startup'), ['--memory-root', root], { INK_MIST_SESSION_DIR: tempDir() });
    expect(r.code).toBe(0);
    expect(context(r.stdout)).toBe(failureNotice(root));
  });

  it.each([
    ['丟例外', `throw new Error('boom');`],
    ['崩潰', `process.exit(1);`],
    ['逾時', `for (;;) {}`],
  ])('處理函式%s：注入失敗通知，去重狀態仍已重置', async (_label, body) => {
    const root = memoryStore({ 'preferences.md': PREFS, 'conduct.md': CONDUCT, 'AGENTS.md': AGENTS });
    const sessions = dirtySessions();
    const r = await runCli(startInput('startup'), ['--memory-root', root], {
      INK_MIST_SESSION_DIR: sessions,
      INK_MIST_HANDLERS: JSON.stringify({ 'session-start': handlerModule(tempDir(), body) }),
    });
    expect(r.code).toBe(0);
    expect(context(r.stdout)).toBe(failureNotice(root));
    expect(sessionState('s1', sessions).get()).toEqual({ injectedIds: [], indexInjected: false });
  });

  it('三者總長超過 10,000 字元：照常全文注入，紀錄中有提醒', async () => {
    const big = `${PREFS}${'- [stated] 很長的偏好\n'.repeat(800)}`;
    const root = memoryStore({ 'preferences.md': big, 'conduct.md': CONDUCT, 'AGENTS.md': AGENTS });
    const r = await runCli(startInput('startup'), ['--memory-root', root], { INK_MIST_SESSION_DIR: tempDir() });
    expect(context(r.stdout).length).toBeGreaterThan(10000);
    expect(readLogs(root)[0]!.notes).toEqual([expect.stringContaining('超過 10000 字元')]);
  });

  it('只重置該 session_id 的狀態', async () => {
    const root = memoryStore({ 'preferences.md': PREFS, 'conduct.md': CONDUCT, 'AGENTS.md': AGENTS });
    const sessions = dirtySessions('other');
    await runCli(startInput('startup', 's1'), ['--memory-root', root], { INK_MIST_SESSION_DIR: sessions });
    expect(sessionState('other', sessions).get().injectedIds).toEqual(['old']);
  });
});
