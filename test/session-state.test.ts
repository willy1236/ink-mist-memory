import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { describe, expect, it } from 'vitest';
import { cleanupSessionStates, sessionState } from '../src/shell/session-state.js';
import { tempDir } from './helpers.js';

const distModule = pathToFileURL(path.resolve('dist/shell/session-state.js')).href;

function markFromChild(dir: string, sessionId: string, ids: string[]): Promise<number | null> {
  const code = `import(${JSON.stringify(distModule)}).then(m => m.sessionState(${JSON.stringify(sessionId)}, ${JSON.stringify(dir)}).markInjected(${JSON.stringify(ids)}))`;
  return new Promise((resolve) => {
    spawn(process.execPath, ['-e', code], { stdio: 'inherit' }).on('exit', resolve);
  });
}

describe('sessionState', () => {
  it('新 session 為空狀態', () => {
    expect(sessionState('s1', tempDir()).get()).toEqual({ injectedIds: [], indexInjected: false });
  });

  it('記錄已注入條目與索引旗標，reset 後清空', () => {
    const s = sessionState('s1', tempDir());
    s.markInjected(['a', 'b']);
    s.markInjected(['b', 'c']);
    s.markIndexInjected();
    expect(s.get()).toEqual({ injectedIds: ['a', 'b', 'c'], indexInjected: true });
    s.reset();
    expect(s.get()).toEqual({ injectedIds: [], indexInjected: false });
  });

  it('依 session_id 分開保存，重置一個不影響另一個', () => {
    const dir = tempDir();
    const a = sessionState('A', dir);
    const b = sessionState('B', dir);
    a.markInjected(['x']);
    b.markInjected(['y']);
    b.reset();
    expect(a.get().injectedIds).toEqual(['x']);
    expect(b.get().injectedIds).toEqual([]);
  });

  it('session_id 含路徑字元時仍寫在狀態目錄內', () => {
    const dir = tempDir();
    sessionState('../evil/id', dir).markInjected(['x']);
    expect(fs.readdirSync(dir)).toEqual(['___evil_id.json']);
  });

  it('多個行程同時寫同一 session，結果為聯集', async () => {
    const dir = tempDir();
    const ids = Array.from({ length: 6 }, (_, i) => [`p${i}-1`, `p${i}-2`]);
    const codes = await Promise.all(ids.map((group) => markFromChild(dir, 'same', group)));
    expect(codes.every((c) => c === 0)).toBe(true);
    expect([...sessionState('same', dir).get().injectedIds].sort()).toEqual(ids.flat().sort());
    expect(fs.readdirSync(dir)).toEqual(['same.json']);
  });

  it('兩個 session 並行寫入互不影響', async () => {
    const dir = tempDir();
    await Promise.all([markFromChild(dir, 'A', ['a1']), markFromChild(dir, 'B', ['b1'])]);
    expect(sessionState('A', dir).get().injectedIds).toEqual(['a1']);
    expect(sessionState('B', dir).get().injectedIds).toEqual(['b1']);
  });

  it('清除超過 30 天未更新的狀態檔', () => {
    const dir = tempDir();
    sessionState('old', dir).markInjected(['x']);
    sessionState('new', dir).markInjected(['y']);
    const old = path.join(dir, 'old.json');
    const past = new Date(Date.now() - 31 * 24 * 3600 * 1000);
    fs.utimesSync(old, past, past);
    expect(cleanupSessionStates(dir)).toEqual(['old.json']);
    expect(fs.readdirSync(dir)).toEqual(['new.json']);
  });
});
