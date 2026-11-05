import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { describe, expect, it } from 'vitest';
import { isUnder } from '../src/match/files.js';
import { buildIndex, INDEX_HEADER, loadSignals, runPipeline } from '../src/match/pipeline.js';
import cwdSignal from '../src/match/signals/cwd.js';
import type { Signal } from '../src/match/types.js';
import { loadMemory, type Entry, type Memory } from '../src/memory/index.js';
import type { HandlerContext } from '../src/shell/types.js';
import { memoryStore, tempDir } from './helpers.js';

const AGENTS = '# 共享記憶\n\n## 0. 讀取通則\n- 規則\n\n| 任務類型 | 提示關鍵字 |\n| --- | --- |\n| 部署 | 部署 |\n';

function fm(name: string, extra = '', version: string | null = '2026-11-01T00:00:00Z'): string {
  return `---\nname: ${name}\ndescription: ${name} 的描述\n${extra}${version ? `version: ${version}\n` : ''}---\n`;
}

function store(files: Record<string, string>): string {
  return memoryStore({ 'AGENTS.md': AGENTS, ...files });
}

function ctx(memoryRoot: string, cwd: string, state: Partial<HandlerContext['state']> = {}): HandlerContext {
  return {
    sessionId: 's',
    cwd,
    prompt: '幫我看一下',
    memoryRoot,
    state: { injectedIds: [], indexInjected: false, ...state },
  };
}

function texts(r: { candidates: { text: string }[] }): string[] {
  return r.candidates.map((c) => c.text);
}

/** 測試用訊號：命中所有路徑符合 `pick` 的檔案的全部條目。 */
function fileSignal(name: string, level: number, pick: (p: string) => boolean): Signal {
  return { name, level, match: (_c, m) => m.files.filter((f) => pick(f.path)).flatMap((f) => f.entries) };
}

describe('isUnder', () => {
  it('以路徑段為界、統一 / 且不分大小寫', () => {
    expect(isUnder('D:/github/foo', 'D:/github/foo')).toBe(true);
    expect(isUnder('d:\\GitHub\\foo\\src', 'D:/github/foo/')).toBe(true);
    expect(isUnder('D:/github/foobar', 'D:/github/foo')).toBe(false);
    expect(isUnder('D:/github', 'D:/github/foo')).toBe(false);
    expect(isUnder('D:/github/foo', '')).toBe(false);
  });
});

describe('工作目錄訊號', () => {
  const files = {
    'areas/foo.md': `${fm('foo', 'repos: [D:/github/foo]\n')}\n## 決策\n- [stated] foo 一\n  - 子項跟著父項\n- [inferred] foo 二\n`,
    'areas/foobar.md': `${fm('foobar', 'repos: [D:/github/foobar]\n')}\n- [stated] foobar 一\n`,
    'areas/proj/_index.md': `${fm('proj', 'repos:\n  - D:/github/proj\n  - E:/other/proj\n')}\n- [ref] 子檔清單\n`,
    'areas/proj/a.md': `${fm('a')}\n- [stated] proj a 一\n`,
    'areas/proj/b.md': `${fm('b')}\n- [stated] proj b 一\n`,
    'topics/t.md': `${fm('t')}\n- [stated] 無關\n`,
  };

  it('工作目錄位於 repos 下時注入該檔全部條目（連同子項）；foobar 不命中 foo', () => {
    const root = store(files);
    const r = runPipeline(ctx(root, 'D:\\GitHub\\Foo\\src'), loadMemory(root), [cwdSignal]);
    expect(texts(r)).toEqual(['- [stated] foo 一\n  - 子項跟著父項', '- [inferred] foo 二']);
    expect(r.candidates.every((c) => c.signal === 'cwd' && c.file === 'areas/foo.md')).toBe(true);
    expect(r.isIndex).toBe(false);
  });

  it('資料夾型 areas 的 repo 內：注入資料夾內各子檔的條目；任一 repos 皆可', () => {
    const root = store(files);
    const r = runPipeline(ctx(root, 'e:/other/proj'), loadMemory(root), [cwdSignal]);
    expect(texts(r)).toEqual(['- [ref] 子檔清單', '- [stated] proj a 一', '- [stated] proj b 一']);
  });
});

describe('取捨排序', () => {
  it('訊號優先序 → version 新到舊（缺的最後，相同依路徑）→ 檔內順序；同一條目取最高級', () => {
    const root = store({
      'areas/old.md': `${fm('old', '', '2026-01-01T00:00:00Z')}\n- [stated] old 一\n- [stated] old 二\n`,
      'areas/new.md': `${fm('new', '', '2026-10-01T00:00:00Z')}\n- [stated] new 一\n`,
      'areas/none.md': `${fm('none', '', null)}\n- [stated] none 一\n`,
      'areas/b-same.md': `${fm('b-same')}\n- [stated] b 一\n`,
      'areas/a-same.md': `${fm('a-same')}\n- [stated] a 一\n`,
      'topics/low.md': `${fm('low', '', '2027-01-01T00:00:00Z')}\n- [stated] low 一\n`,
    });
    const signals = [
      fileSignal('task', 3, (p) => p === 'topics/low.md' || p === 'areas/none.md'),
      fileSignal('cwd', 1, (p) => p.startsWith('areas/') && p !== 'areas/none.md'),
      fileSignal('name', 2, (p) => p === 'areas/none.md' || p === 'areas/old.md'),
    ];
    const r = runPipeline(ctx(root, 'D:/x'), loadMemory(root), signals);
    expect(r.candidates.map((c) => [c.text.slice(11), c.signal])).toEqual([
      ['a 一', 'cwd'],
      ['b 一', 'cwd'],
      ['new 一', 'cwd'],
      ['old 一', 'cwd'],
      ['old 二', 'cwd'],
      ['none 一', 'name'],
      ['low 一', 'task'],
    ]);
  });

  it('去掉本 session 已注入的條目；全都注入過時不回傳任何內容（也不給索引）', () => {
    const root = store({ 'areas/a.md': `${fm('a')}\n- [stated] 一\n- [stated] 二\n` });
    const memory = loadMemory(root);
    const all = memory.files[0]!.entries.map((e: Entry) => e.id);
    const some = runPipeline(ctx(root, 'D:/x', { injectedIds: [all[0]!] }), memory, [fileSignal('cwd', 1, () => true)]);
    expect(texts(some)).toEqual(['- [stated] 二']);
    const none = runPipeline(ctx(root, 'D:/x', { injectedIds: all }), memory, [fileSignal('cwd', 1, () => true)]);
    expect(none).toMatchObject({ sections: [], candidates: [], isIndex: false });
  });

  it('訊號可連同條目回傳提醒，提醒進結果的 notes', () => {
    const root = store({ 'areas/a.md': `${fm('a')}
- [stated] 一
` });
    const withNotes: Signal = {
      name: 'n',
      level: 2,
      match: (_c, m) => ({ entries: m.files[0]!.entries, notes: ['訊號自己的提醒'] }),
    };
    const r = runPipeline(ctx(root, 'D:/x'), loadMemory(root), [withNotes]);
    expect(texts(r)).toEqual(['- [stated] 一']);
    expect(r.notes).toEqual(['訊號 n：訊號自己的提醒']);
  });

  it('物件格式可不帶 notes；沒有條目陣列、條目元素格式錯誤或 notes 不是字串陣列時當成該訊號失敗，其餘訊號照常', () => {
    const root = store({ 'areas/a.md': `${fm('a')}
- [stated] 一
` });
    const plain: Signal = { name: 'p', level: 2, match: (_c, m) => ({ entries: m.files[0]!.entries }) };
    const broken = { name: 'x', level: 3, match: () => ({ notes: ['只有提醒'] }) } as unknown as Signal;
    const bad = (name: string, result: (m: Memory) => unknown) =>
      ({ name, level: 1, match: (_c: HandlerContext, m: Memory) => result(m) }) as unknown as Signal;
    const signals = [
      bad('notStr', (m) => ({ entries: m.files[0]!.entries, notes: 'abc' })),
      bad('notStrItem', (m) => ({ entries: m.files[0]!.entries, notes: [1] })),
      bad('nullItem', () => [null]),
      bad('partialItem', () => [{ id: 'a', file: 'x' }]),
      bad('mixedItems', (m) => [...m.files[0]!.entries, null]),
      broken,
      plain,
    ];
    const r = runPipeline(ctx(root, 'D:/x'), loadMemory(root), signals);
    expect(r.candidates.map((c) => c.signal)).toEqual(['p']); // 格式錯的訊號連同其條目一併捨棄
    const reason = { notes: 'notes 不是字串陣列', item: '條目缺 id、file 或 text', array: '沒有條目陣列' };
    expect(r.notes).toEqual(
      ([['notStr', reason.notes], ['notStrItem', reason.notes], ['nullItem', reason.item], ['partialItem', reason.item],
        ['mixedItems', reason.item], ['x', reason.array]] as const)
        .map(([n, why]) => expect.stringMatching(new RegExp(`^訊號 ${n} 執行失敗.*${why}`))),
    );
  });

  it('訊號丟例外時寫提醒，其餘訊號照常', () => {
    const root = store({ 'areas/a.md': `${fm('a')}\n- [stated] 一\n` });
    const bad: Signal = { name: 'bad', level: 2, match: () => { throw new Error('壞了'); } };
    const r = runPipeline(ctx(root, 'D:/x'), loadMemory(root), [bad, fileSignal('cwd', 1, () => true)]);
    expect(texts(r)).toEqual(['- [stated] 一']);
    expect(r.notes).toEqual([expect.stringContaining('訊號 bad 執行失敗')]);
  });
});

describe('比對範圍', () => {
  it('history／reports 的條目任何訊號都命中不到', () => {
    const root = store({
      'areas/a.md': `${fm('a')}
- [stated] 一
`,
      'history/2026-01-01-x.md': `${fm('x')}
- [stated] 過去
`,
      'reports/2026-01-01-y.md': `${fm('y')}
- [stated] 報告
`,
    });
    const r = runPipeline(ctx(root, 'D:/x'), loadMemory(root), [fileSignal('all', 2, () => true)]);
    expect(texts(r)).toEqual(['- [stated] 一']);
  });
});

describe('精簡索引', () => {
  const files = {
    'profile.md': `${fm('profile')}\n- [stated] p\n`,
    'areas/proj/_index.md': `${fm('proj-index')}\n- [ref] 清單\n`,
    'areas/proj/a.md': `${fm('a')}\n- [stated] a\n`,
    'history/2026-01-01-x.md': `${fm('x')}\n- [stated] 過去\n`,
  };

  it('完全沒命中且未注入過索引：回傳索引，資料夾型以資料夾名與 _index.md 描述列一項', () => {
    const root = store(files);
    const r = runPipeline(ctx(root, 'D:/x'), loadMemory(root), [cwdSignal]);
    expect(r.isIndex).toBe(true);
    expect(r.candidates).toEqual([]);
    expect(r.sections).toEqual([
      `${INDEX_HEADER}\n\n- proj（areas/proj/）：proj-index 的描述\n- profile（profile.md）：profile 的描述`,
    ]);
  });

  it('本 session 已注入過索引：不回傳任何內容', () => {
    const root = store(files);
    const r = runPipeline(ctx(root, 'D:/x', { indexInjected: true }), loadMemory(root), [cwdSignal]);
    expect(r).toMatchObject({ sections: [], candidates: [], isIndex: false });
  });

  it('記憶庫沒有任何記憶檔時索引為空', () => {
    expect(buildIndex(loadMemory(store({})))).toBe('');
  });
});

describe('loadSignals', () => {
  it('自動載入 signals/ 下的訊號（含工作目錄訊號）', async () => {
    const { signals, notes } = await loadSignals();
    expect(signals.map((s) => s.name)).toContain('cwd');
    expect(notes).toEqual([]);
  });

  it('依 level 排序；不是訊號或載入失敗的檔寫提醒並略過', async () => {
    const dir = tempDir();
    const write = (f: string, src: string) => fs.writeFileSync(path.join(dir, f), src);
    write('b.js', `export default { name: 'b', level: 3, match: () => [] };`);
    write('a.js', `export default { name: 'a', level: 1, match: () => [] };`);
    write('c.js', `export const x = 1;`);
    write('d.js', `throw new Error('boom');`);
    write('readme.md', `不是程式`);
    const { signals, notes } = await loadSignals(pathToFileURL(`${dir}/`));
    expect(signals.map((s) => s.name)).toEqual(['a', 'b']);
    expect(notes).toEqual([expect.stringContaining('c.js'), expect.stringContaining('d.js')]);
  });
});
