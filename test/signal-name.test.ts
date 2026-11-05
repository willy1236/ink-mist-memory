import { describe, expect, it } from 'vitest';
import { runPipeline } from '../src/match/pipeline.js';
import cwdSignal from '../src/match/signals/cwd.js';
import nameSignal from '../src/match/signals/name.js';
import { loadMemory } from '../src/memory/index.js';
import type { HandlerContext } from '../src/shell/types.js';
import { memoryStore } from './helpers.js';

const AGENTS = '# 共享記憶\n\n## 0. 讀取通則\n- 規則\n\n| 任務類型 | 提示關鍵字 |\n| --- | --- |\n| 部署 | 部署 |\n';

function fm(name: string, extra = ''): string {
  return `---\nname: ${name}\ndescription: ${name} 的描述\n${extra}version: 2026-11-01T00:00:00Z\n---\n`;
}

const FILES = {
  'AGENTS.md': AGENTS,
  'areas/shark.md': `${fm('shark', 'aliases: [鯊魚]\nrepos: [D:/github/shark]\n')}\n- [stated] shark 一\n`,
  'areas/xingyubot.md': `${fm('XingyuBot')}\n- [stated] bot 一\n`,
  'areas/proj/_index.md': `${fm('proj-index', 'aliases: [專案P]\n')}\n- [ref] 子檔清單\n`,
  'areas/proj/child.md': `${fm('childname', 'aliases: [子別名]\n')}\n- [stated] proj child 一\n`,
  'topics/t.md': `${fm('t-topic')}\n- [stated] 無關\n`,
};

function run(prompt: string, cwd = 'D:/elsewhere', signals = [nameSignal]) {
  const root = memoryStore(FILES);
  const ctx: HandlerContext = {
    sessionId: 's',
    cwd,
    prompt,
    memoryRoot: root,
    state: { injectedIds: [], indexInjected: false },
  };
  return runPipeline(ctx, loadMemory(root), signals);
}

function files(r: ReturnType<typeof run>): string[] {
  return [...new Set(r.candidates.map((c) => c.file))].sort();
}

describe('名稱與 aliases 訊號', () => {
  it('提示含 name 或 alias 時注入該檔條目', () => {
    expect(files(run('鯊魚的 inventory 在哪'))).toEqual(['areas/shark.md']);
    expect(files(run('部署 shark'))).toEqual(['areas/shark.md']);
    expect(run('鯊魚').candidates.every((c) => c.signal === 'name')).toBe(true);
  });

  it('子字串比對，不分大小寫與全半形', () => {
    expect(files(run('幫 xingyubot 加指令'))).toEqual(['areas/xingyubot.md']);
    expect(files(run('ＸＩＮＧＹＵＢＯＴ壞了'))).toEqual(['areas/xingyubot.md']);
    expect(files(run('看一下ＳＨＡＲＫserver'))).toEqual(['areas/shark.md']);
  });

  it('資料夾名或 _index.md 的 alias 命中整個資料夾', () => {
    const all = ['areas/proj/_index.md', 'areas/proj/child.md'];
    expect(files(run('proj 的設定'))).toEqual(all);
    expect(files(run('專案p 的設定'))).toEqual(all);
  });

  it('資料夾型子檔的 name 與它設的 aliases 不參與比對', () => {
    expect(run('childname 子別名').candidates).toEqual([]);
  });

  it('沒提到任何名稱時不命中', () => {
    expect(run('幫我看一下').candidates).toEqual([]);
  });

  it('同一條目同時被工作目錄命中時以工作目錄的優先序計', () => {
    const r = run('鯊魚', 'D:/github/shark', [nameSignal, cwdSignal]);
    expect(r.candidates.map((c) => [c.file, c.signal])).toEqual([['areas/shark.md', 'cwd']]);
  });
});
