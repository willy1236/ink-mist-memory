import fs from 'node:fs';
import { claudeCode } from '../src/platforms/index.js';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { failureNotice } from '../src/shell/notice.js';
import { runHook, type RunHookOptions } from '../src/shell/run-hook.js';
import { sessionState } from '../src/shell/session-state.js';
import type { HookInput } from '../src/shell/types.js';
import { handlerModule, readLogs, tempDir } from './helpers.js';

function setup() {
  const memoryRoot = tempDir();
  const sessionDir = tempDir();
  const out: string[] = [];
  const opts: RunHookOptions = {
    memoryRoot,
    sessionDir,
    write: async (t) => {
      out.push(t);
    },
  };
  const context = (r?: { output?: string }) =>
    r?.output === undefined
      ? undefined
      : (JSON.parse(r.output) as { hookSpecificOutput: { hookEventName: string; additionalContext: string } })
          .hookSpecificOutput;
  return { memoryRoot, sessionDir, out, opts, context, dir: tempDir() };
}

const prompt = (p = 'hello'): HookInput => ({ event: 'prompt-submit', nativeEvent: 'UserPromptSubmit', sessionId: 's1', cwd: 'D:/repo', prompt: p });
const start: HookInput = { event: 'session-start', nativeEvent: 'SessionStart', sessionId: 's1', cwd: 'D:/repo', source: 'startup' };

const result = (over: string) =>
  `return Object.assign({ sections: [], candidates: [], isIndex: false, notes: [] }, ${over});`;
const entriesJs = (n: number, textLen = 10) =>
  `Array.from({ length: ${n} }, (_, i) => ({ id: 'id-' + i, file: 'areas/f.md', text: '- [stated] ' + 'x'.repeat(${textLen}), signal: 'cwd' }))`;

describe('runHook', () => {
  it('處理函式準時回傳時輸出其注入內容（hookSpecificOutput.additionalContext）', async () => {
    const t = setup();
    const h = handlerModule(t.dir, result(`{ sections: ['段落 ' + ctx.prompt + ' ' + ctx.memoryRoot.length] }`));
    const r = await runHook(prompt('abc'), h, t.opts);
    expect(t.context(r)).toEqual({
      hookEventName: 'UserPromptSubmit',
      additionalContext: `段落 abc ${t.memoryRoot.length}`,
    });
    expect(t.out).toEqual([r.output]);
    expect(r.record.failure).toBeUndefined();
  });

  it.each([
    ['丟例外', `throw new Error('boom');`, 'boom'],
    ['讓 worker 崩潰', `process.exit(3);`, 'exit code 3'],
    ['非同步未捕捉例外', `setTimeout(() => { throw new Error('late'); }); await new Promise(() => {});`, 'late'],
    ['回傳格式錯誤', `return { sections: 'x' };`, '格式錯誤'],
    ['記憶體失控', `const a = []; for (;;) a.push(new Array(1e6).fill(1));`, 'worker'],
  ])('處理函式%s時輸出失敗通知並記錄原因', async (_name, body, reason) => {
    const t = setup();
    const r = await runHook(prompt(), handlerModule(t.dir, body), t.opts);
    expect(t.context(r)?.additionalContext).toBe(failureNotice(t.memoryRoot));
    expect(readLogs(t.memoryRoot)[0]).toMatchObject({ failure: expect.stringContaining(reason) });
  });

  it('超過 3 秒（從入口被呼叫起算）時輸出失敗通知並記錄逾時', async () => {
    const t = setup();
    const h = handlerModule(t.dir, `await new Promise((r) => setTimeout(r, 5000)); ${result('{}')}`);
    const began = Date.now();
    const r = await runHook(prompt(), h, { ...t.opts, startedAt: began - 2000 });
    expect(Date.now() - began).toBeLessThan(1500);
    expect(t.context(r)?.additionalContext).toBe(failureNotice(t.memoryRoot));
    expect(r.record.failure).toContain('逾時');
  });

  it('成功時紀錄各階段完成的時間點，依序遞增且不超過總耗時', async () => {
    const t = setup();
    const h = handlerModule(t.dir, result('{}'));
    const r = await runHook(prompt(), h, t.opts);
    const tm = r.record.timing;
    expect(tm).toBeDefined();
    const points = [tm!.worker_called_ms, tm!.worker_online_ms, tm!.module_loaded_ms, tm!.handler_done_ms];
    expect(points.every(Number.isInteger)).toBe(true);
    expect([...points].sort((a, b) => a - b)).toEqual(points);
    expect(tm!.handler_done_ms).toBeLessThanOrEqual(r.record.duration_ms);
    expect(readLogs(t.memoryRoot)[0]).toMatchObject({ timing: tm });
  });

  it('失敗時不記 timing', async () => {
    const t = setup();
    const r = await runHook(prompt(), handlerModule(t.dir, `throw new Error('x');`), t.opts);
    expect(r.record.timing).toBeUndefined();
  });

  it('逾時紀錄說明停在哪個階段與各階段耗時', async () => {
    const t = setup();
    const h = handlerModule(t.dir, `await new Promise((r) => setTimeout(r, 5000)); ${result('{}')}`);
    const r = await runHook(prompt(), h, { ...t.opts, startedAt: Date.now() - 2000 });
    expect(r.record.failure).toMatch(/行程啟動到呼叫 worker 花了 \d+ ms；模組已載入，處理函式執行中（已等 \d+ ms；上線 \+\d+ ms，模組載入完成 \+\d+ ms）/);
  });

  it('呼叫 worker 前時限就用完時，紀錄指出是啟動階段耗盡', async () => {
    const t = setup();
    const r = await runHook(prompt(), handlerModule(t.dir, result('{}')), { ...t.opts, startedAt: Date.now() - 3000 });
    expect(r.record.failure).toContain('時限在啟動 worker 前已用完');
  });

  it('失敗通知以絕對路徑指向 AGENTS.legacy-read.md', () => {
    expect(failureNotice('rel/root')).toContain(path.resolve('rel/root/AGENTS.legacy-read.md').replaceAll('\\', '/'));
  });

  it('失敗通知提示日誌目錄的絕對路徑', () => {
    expect(failureNotice('rel/root')).toContain(
      `可至 ${path.resolve('rel/root/_injection-log').replaceAll('\\', '/')} 搜尋`,
    );
  });

  it('沒有對應的處理函式時輸出失敗通知', async () => {
    const t = setup();
    const r = await runHook(prompt(), undefined, t.opts);
    expect(t.context(r)?.additionalContext).toBe(failureNotice(t.memoryRoot));
  });

  it('部分成功（failed 有值）時在內容後附失敗通知', async () => {
    const t = setup();
    const h = handlerModule(t.dir, result(`{ sections: ['A'], failed: 'conduct.md 讀不到' }`));
    const r = await runHook(start, h, t.opts);
    expect(t.context(r)?.additionalContext).toBe(`A\n\n${failureNotice(t.memoryRoot)}`);
    expect(r.record.failure).toBe('conduct.md 讀不到');
  });

  it('送出提示時依候選順序截到 30 條', async () => {
    const t = setup();
    const r = await runHook(prompt(), handlerModule(t.dir, result(`{ candidates: ${entriesJs(40)} }`)), t.opts);
    expect(r.record.entries).toHaveLength(30);
    expect(r.record.entries.at(-1)?.id).toBe('id-29');
    expect(sessionState('s1', t.sessionDir).get().injectedIds).toHaveLength(30);
  });

  it('送出提示時總長不超過 10,000 字元，且預留失敗通知的長度', async () => {
    const t = setup();
    const h = handlerModule(t.dir, result(`{ candidates: ${entriesJs(25, 600)}, failed: 'partial' }`));
    const r = await runHook(prompt(), h, t.opts);
    const text = t.context(r)!.additionalContext;
    expect(text.length).toBeLessThanOrEqual(claudeCode.maxChars);
    expect(text.endsWith(failureNotice(t.memoryRoot))).toBe(true);
    expect(r.record.entries.length).toBeGreaterThan(0);
    expect(r.record.entries.length).toBeLessThan(25);
    expect(r.record.notes.join()).toContain('捨棄');
  });

  it('單條過長的候選寫專屬提醒，其餘照常注入', async () => {
    const t = setup();
    const h = handlerModule(
      t.dir,
      result(`{ candidates: [{ id: 'big', file: 'areas/big.md', text: 'x'.repeat(12000), signal: 'cwd' }, ...${entriesJs(2)}] }`),
    );
    const r = await runHook(prompt(), h, t.opts);
    expect(r.record.entries.map((e) => e.id)).toEqual(['id-0', 'id-1']);
    expect(r.record.notes.join()).toContain('條目過長');
  });

  it('固定段落佔掉預算時，放不下的短條目不誤報為過長', async () => {
    const t = setup();
    const h = handlerModule(t.dir, result(`{ sections: ['s'.repeat(9850)], candidates: ${entriesJs(3)} }`));
    const r = await runHook(prompt(), h, t.opts);
    expect(r.record.entries).toEqual([]);
    expect(r.record.notes.join()).not.toContain('條目過長');
    expect(r.record.notes.join()).toContain('捨棄 3 條');
    expect(r.record.notes.join()).toContain('同時回傳固定段落與候選條目');
  });

  it('session 開始的內容不截斷，超過 10,000 字元時只寫提醒', async () => {
    const t = setup();
    const h = handlerModule(t.dir, result(`{ sections: ['p'.repeat(8000), 'c'.repeat(4000)] }`));
    const r = await runHook(start, h, t.opts);
    expect(t.context(r)!.additionalContext.length).toBe(12002);
    expect(r.record.notes.join()).toContain('超過 10000 字元');
  });

  it('只把實際輸出的條目記進去重狀態，處理函式拿到唯讀快照', async () => {
    const t = setup();
    sessionState('s1', t.sessionDir).markInjected(['old']);
    const h = handlerModule(
      t.dir,
      result(`{ sections: [JSON.stringify(ctx.state)], candidates: ${entriesJs(2)}, isIndex: true }`),
    );
    const r = await runHook(prompt(), h, t.opts);
    expect(t.context(r)!.additionalContext.startsWith('{"injectedIds":["old"],"indexInjected":false}')).toBe(true);
    expect(sessionState('s1', t.sessionDir).get()).toEqual({
      injectedIds: ['old', 'id-0', 'id-1'],
      indexInjected: true,
    });
  });

  it('輸出完成時已逾時則不記去重', async () => {
    const t = setup();
    const h = handlerModule(t.dir, result(`{ candidates: ${entriesJs(2)} }`));
    const r = await runHook(prompt(), h, {
      ...t.opts,
      timeoutMs: 1500,
      write: () => new Promise((res) => setTimeout(res, 1600)),
    });
    expect(r.output).toBeDefined();
    expect(sessionState('s1', t.sessionDir).get().injectedIds).toEqual([]);
    expect(r.record.notes.join()).toContain('未記入去重');
  });

  it('逾時時候選條目不記去重', async () => {
    const t = setup();
    const h = handlerModule(t.dir, `await new Promise((r) => setTimeout(r, 2000)); ${result(`{ candidates: ${entriesJs(2)} }`)}`);
    await runHook(prompt(), h, { ...t.opts, timeoutMs: 500 });
    expect(sessionState('s1', t.sessionDir).get().injectedIds).toEqual([]);
  });

  it('全部已注入時處理函式回傳空結果，不輸出也照寫紀錄', async () => {
    const t = setup();
    const r = await runHook(prompt(), handlerModule(t.dir, result('{}')), t.opts);
    expect(r.output).toBeUndefined();
    expect(t.out).toEqual([]);
    expect(readLogs(t.memoryRoot)).toHaveLength(1);
  });

  it('每次呼叫寫一筆紀錄，含事件、session、cwd、提示、條目與命中訊號、提醒', async () => {
    const t = setup();
    const h = handlerModule(t.dir, result(`{ candidates: ${entriesJs(1)}, notes: ['x.md 缺 name'] }`));
    await runHook(prompt('找 foo'), h, t.opts);
    expect(readLogs(t.memoryRoot)).toEqual([
      expect.objectContaining({
        event: 'UserPromptSubmit',
        session_id: 's1',
        cwd: 'D:/repo',
        prompt: '找 foo',
        entries: [{ id: 'id-0', file: 'areas/f.md', signal: 'cwd' }],
        notes: ['x.md 缺 name'],
        time: expect.any(String),
      }),
    ]);
  });

  it('寫紀錄失敗時注入照常輸出', async () => {
    const t = setup();
    fs.writeFileSync(path.join(t.memoryRoot, '_injection-log'), 'blocker');
    const r = await runHook(prompt(), handlerModule(t.dir, result(`{ sections: ['ok'] }`)), t.opts);
    expect(t.context(r)?.additionalContext).toBe('ok');
  });

  it('每次呼叫清除超過 30 天的紀錄', async () => {
    const t = setup();
    const dir = path.join(t.memoryRoot, '_injection-log');
    fs.mkdirSync(dir);
    fs.writeFileSync(path.join(dir, '2000-01-01.jsonl'), '');
    await runHook(prompt(), handlerModule(t.dir, result('{}')), t.opts);
    expect(fs.existsSync(path.join(dir, '2000-01-01.jsonl'))).toBe(false);
  });

  it('SessionStart 先重置該 session 狀態，處理函式崩潰或逾時也不影響', async () => {
    for (const body of [`process.exit(1);`, `await new Promise(() => {});`]) {
      const t = setup();
      sessionState('s1', t.sessionDir).markInjected(['a']);
      sessionState('s1', t.sessionDir).markIndexInjected();
      sessionState('other', t.sessionDir).markInjected(['b']);
      const h = handlerModule(t.dir, `${body} return null;`);
      await runHook(start, h, { ...t.opts, timeoutMs: 800 });
      expect(sessionState('s1', t.sessionDir).get()).toEqual({ injectedIds: [], indexInjected: false });
      expect(sessionState('other', t.sessionDir).get().injectedIds).toEqual(['b']);
    }
  });

  it('送出提示不重置狀態', async () => {
    const t = setup();
    sessionState('s1', t.sessionDir).markInjected(['a']);
    await runHook(prompt(), handlerModule(t.dir, result('{}')), t.opts);
    expect(sessionState('s1', t.sessionDir).get().injectedIds).toEqual(['a']);
  });
});
