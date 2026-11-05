import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { failureNotice } from '../src/shell/notice.js';
import { handlerModule, memoryStore, readLogs, runCli, tempDir } from './helpers.js';

const AGENTS = '# 共享記憶\n\n## 0. 讀取通則\n- 規則\n\n| 任務類型 | 提示關鍵字 |\n| --- | --- |\n| 部署 | 部署 |\n';
const REPO = 'D:/github/proj';
const PROMPT_HANDLER = path.resolve('dist/handlers/user-prompt-submit.js');

function fm(name: string, extra = ''): string {
  return `---\nname: ${name}\ndescription: ${name} 的描述\n${extra}version: 2026-11-01T00:00:00Z\n---\n`;
}

function projFile(lines: string[]): string {
  return `${fm('proj', `repos: [${REPO}]\n`)}\n${lines.join('\n')}\n`;
}

function store(files: Record<string, string>): string {
  return memoryStore({ 'AGENTS.md': AGENTS, ...files });
}

function prompt(sessionId: string, cwd: string, text = '幫我看一下') {
  return JSON.stringify({ hook_event_name: 'UserPromptSubmit', session_id: sessionId, cwd, prompt: text });
}

/** 依序送出提示，回傳每次的 additionalContext（沒有輸出時為 ''）。 */
async function send(root: string, sessions: string, inputs: string[], env: NodeJS.ProcessEnv = {}): Promise<string[]> {
  const out: string[] = [];
  for (const input of inputs) {
    const r = await runCli(input, ['--memory-root', root], { INK_MIST_SESSION_DIR: sessions, ...env });
    expect(r.code).toBe(0);
    out.push(r.stdout === '' ? '' : (JSON.parse(r.stdout).hookSpecificOutput.additionalContext as string));
  }
  return out;
}

const count = (text: string, needle: string) => text.split(needle).length - 1;

describe('UserPromptSubmit 處理函式（dist/hook.js）', () => {
  it('在 repo 內：注入該專案條目並附所屬檔案；同 session 再送不重複、也不給索引', async () => {
    const root = store({
      'areas/proj.md': projFile(['- [stated] 決策一', '- [inferred] 習慣二']),
      'topics/other.md': `${fm('other')}\n- [stated] 無關\n`,
    });
    const sessions = tempDir();
    const [first, second] = await send(root, sessions, [prompt('s', `${REPO}/src`), prompt('s', REPO)]);
    expect(first).toContain('[areas/proj.md]\n- [stated] 決策一');
    expect(first).toContain('[areas/proj.md]\n- [inferred] 習慣二');
    expect(first).not.toContain('無關');
    expect(second).toBe('');
    const logs = readLogs(root);
    expect(logs[0]).toMatchObject({ event: 'UserPromptSubmit', cwd: `${REPO}/src`, index: false });
    expect(logs[0]!.entries).toEqual([
      expect.objectContaining({ file: 'areas/proj.md', signal: 'cwd' }),
      expect.objectContaining({ file: 'areas/proj.md', signal: 'cwd' }),
    ]);
    expect(logs[1]!.entries).toEqual([]);
  });

  it('超過 30 條：只注入 30 條，被捨棄的條目下次命中照常注入', async () => {
    const lines = Array.from({ length: 35 }, (_, i) => `- [stated] 條目${String(i + 1).padStart(2, '0')}`);
    const root = store({ 'areas/proj.md': projFile(lines) });
    const [first, second] = await send(root, tempDir(), [prompt('s', REPO), prompt('s', REPO)]);
    expect(count(first!, '[areas/proj.md]')).toBe(30);
    expect(first).toContain('條目30');
    expect(first).not.toContain('條目31');
    expect(count(second!, '[areas/proj.md]')).toBe(5);
    expect(second).toContain('條目31');
    expect(second).toContain('條目35');
  });

  it('總長超過 10,000 字元：依順序少取，注入總長不超過 10,000 字元', async () => {
    const lines = Array.from({ length: 20 }, (_, i) => `- [stated] 長條目${i} ${'字'.repeat(900)}`);
    const root = store({ 'areas/proj.md': projFile(lines) });
    const [first] = await send(root, tempDir(), [prompt('s', REPO)]);
    expect(first!.length).toBeLessThanOrEqual(10000);
    expect(first).toContain('長條目0 ');
    expect(first).not.toContain('長條目19 ');
    expect(readLogs(root)[0]!.notes).toEqual([expect.stringContaining('捨棄')]);
  });

  it('沒命中：注入精簡索引，同一 session 只一次；提示含 history 檔名也不注入該檔', async () => {
    const root = store({
      'areas/proj.md': projFile(['- [stated] 決策一']),
      'history/2026-01-01-old.md': `${fm('2026-01-01-old')}\n- [stated] 過去的事\n`,
    });
    const sessions = tempDir();
    const [first, second] = await send(root, sessions, [
      prompt('s', 'D:/elsewhere', '看一下 history/2026-01-01-old.md'),
      prompt('s', 'D:/elsewhere'),
    ]);
    expect(first).toContain('精簡索引');
    expect(first).toContain('- proj（areas/proj.md）：proj 的描述');
    expect(first).not.toContain('過去的事');
    expect(first).not.toContain('2026-01-01-old');
    expect(second).toBe('');
    expect(readLogs(root).map((l) => l.index)).toEqual([true, false]);
  });

  it('解析記憶庫的提醒寫進注入紀錄', async () => {
    const root = store({ 'areas/proj.md': projFile(['- [stated] 決策一']), 'topics/bad.md': '沒有 frontmatter\n' });
    await send(root, tempDir(), [prompt('s', REPO)]);
    expect(readLogs(root)[0]!.notes).toEqual([expect.stringContaining('topics/bad.md')]);
  });

  it('內容改過的條目視為新條目再注入', async () => {
    const root = store({ 'areas/proj.md': projFile(['- [stated] 決策一']) });
    const sessions = tempDir();
    const [first] = await send(root, sessions, [prompt('s', REPO)]);
    fs.writeFileSync(path.join(root, 'areas/proj.md'), projFile(['- [stated] 決策一（改過）']));
    const [second] = await send(root, sessions, [prompt('s', REPO)]);
    expect(first).toContain('決策一');
    expect(second).toContain('決策一（改過）');
  });

  it('兩個 session 並行時去重互不影響', async () => {
    const root = store({ 'areas/proj.md': projFile(['- [stated] 決策一']) });
    const sessions = tempDir();
    const [a1] = await send(root, sessions, [prompt('A', REPO)]);
    const results = await Promise.all([send(root, sessions, [prompt('B', REPO)]), send(root, sessions, [prompt('A', REPO)])]);
    expect(a1).toContain('決策一');
    expect(results[0][0]).toContain('決策一');
    expect(results[1][0]).toBe('');
  });

  it('session 開始的處理函式崩潰後，同一 session 送出提示時先前注入過的條目會重新注入', async () => {
    const root = store({ 'areas/proj.md': projFile(['- [stated] 決策一']) });
    const sessions = tempDir();
    const env = {
      INK_MIST_HANDLERS: JSON.stringify({
        'session-start': handlerModule(tempDir(), `process.exit(1);`),
        'prompt-submit': PROMPT_HANDLER,
      }),
    };
    const start = JSON.stringify({ hook_event_name: 'SessionStart', session_id: 's', cwd: REPO, source: 'clear' });
    const [first, crashed, again] = await send(root, sessions, [prompt('s', REPO), start, prompt('s', REPO)], env);
    expect(first).toContain('決策一');
    expect(crashed).toBe(failureNotice(root));
    expect(again).toContain('決策一');
  });

  it('記憶庫不存在：輸出失敗通知', async () => {
    const root = `${tempDir()}/missing`;
    const [out] = await send(root, tempDir(), [prompt('s', REPO)]);
    expect(out).toBe(failureNotice(root));
  });
});
