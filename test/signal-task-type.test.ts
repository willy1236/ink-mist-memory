import { describe, expect, it } from 'vitest';
import { runPipeline } from '../src/match/pipeline.js';
import cwdSignal from '../src/match/signals/cwd.js';
import nameSignal from '../src/match/signals/name.js';
import taskTypeSignal from '../src/match/signals/task-type.js';
import { loadMemory } from '../src/memory/index.js';
import type { HandlerContext } from '../src/shell/types.js';
import { memoryStore } from './helpers.js';

const TABLE = '| 任務類型 | 提示關鍵字 |\n| --- | --- |\n| commit | commit、提交 |\n| 部署 | 部署、deploy |\n';
const AGENTS = `# 共享記憶\n\n## 0. 讀取通則\n- 規則\n\n${TABLE}`;

function fm(name: string, extra = ''): string {
  return `---\nname: ${name}\ndescription: ${name} 的描述\n${extra}version: 2026-11-01T00:00:00Z\n---\n`;
}

const FILES = {
  'areas/shark.md':
    `${fm('shark', 'repos: [D:/github/shark]\n')}\n## 決策\n- [stated] shark 決策\n\n` +
    `## 任務：部署\n- [stated] shark 部署一\n\n### 細節\n- [stated] shark 部署巢狀\n\n## 任務：commit\n- [stated] shark commit\n`,
  'areas/proj/_index.md': `${fm('proj', 'repos: [D:/github/proj]\n')}\n- [ref] 子檔清單\n`,
  'areas/proj/sub.md': `${fm('sub')}\n## 任務：部署\n- [stated] proj 部署\n`,
  'topics/git.md': `${fm('git')}\n## 任務：commit\n- [stated] git commit 規範\n\n## 其他\n- [stated] git 其他\n`,
  'topics/ops.md': `${fm('ops')}\n## 任務：部署\n- [stated] 通用部署\n\n### 細節\n- [stated] 通用部署巢狀\n`,
};

function run(prompt: string, opts: { cwd?: string; agents?: string; signals?: typeof taskTypeSignal[] } = {}) {
  const root = memoryStore({ 'AGENTS.md': opts.agents ?? AGENTS, ...FILES });
  const ctx: HandlerContext = {
    sessionId: 's',
    cwd: opts.cwd ?? 'D:/elsewhere',
    prompt,
    memoryRoot: root,
    state: { injectedIds: [], indexInjected: false },
  };
  return runPipeline(ctx, loadMemory(root), opts.signals ?? [taskTypeSignal]);
}

function texts(r: ReturnType<typeof run>): string[] {
  return r.candidates.map((c) => c.text.replace('- [stated] ', ''));
}

describe('任務類型訊號', () => {
  it('提示含關鍵字時注入各檔該任務類型標題下的條目，含巢狀標題；不在任何 repos 下、沒提名稱時只注入這些', () => {
    const all = [cwdSignal, nameSignal, taskTypeSignal];
    expect(texts(run('幫我部署一下', { signals: all }))).toEqual(['通用部署', '通用部署巢狀']);
    expect(texts(run('準備提交'))).toEqual(['git commit 規範']);
    expect(run('部署').candidates.every((c) => c.signal === 'task-type')).toBe(true);
  });

  it('關鍵字子字串比對，不分大小寫與全半形', () => {
    expect(texts(run('please DEPLOY it'))).toEqual(['通用部署', '通用部署巢狀']);
    expect(texts(run('ｃｏｍｍｉｔ吧'))).toEqual(['git commit 規範']);
    expect(texts(run('recommitted'))).toEqual(['git commit 規範']);
  });

  it('多個任務類型同時命中時都注入', () => {
    expect(texts(run('commit 完再 deploy')).sort()).toEqual(['git commit 規範', '通用部署', '通用部署巢狀'].sort());
  });

  it('帶 repos 的檔案只在工作目錄屬於該專案時命中；資料夾型看 _index.md 的 repos', () => {
    expect(texts(run('部署'))).not.toContain('shark 部署一');
    expect(texts(run('部署'))).not.toContain('proj 部署');
    expect(texts(run('部署', { cwd: 'D:/github/shark/src' }))).toEqual(expect.arrayContaining(['shark 部署一', '通用部署']));
    expect(texts(run('部署', { cwd: 'D:/github/shark/src' }))).not.toContain('proj 部署');
    expect(texts(run('部署', { cwd: 'D:/github/proj' }))).toEqual(expect.arrayContaining(['proj 部署', '通用部署']));
  });

  it('沒有關鍵字時不命中', () => {
    expect(run('幫我看一下').candidates).toEqual([]);
  });

  it('任務類型表格解析失敗時停用本訊號、寫提醒，其餘訊號照常', () => {
    const r = run('shark 部署', { agents: '# 共享記憶\n\n## 0. 讀取通則\n- 規則\n', signals: [taskTypeSignal, nameSignal] });
    expect(r.notes).toContain('訊號 task-type：本訊號停用');
    expect(r.notes.some((n) => n.startsWith('任務類型表格解析失敗'))).toBe(true);
    expect(r.candidates.every((c) => c.signal === 'name')).toBe(true);
    expect(texts(r)).toContain('shark 決策');
  });

  it('同一條目也被工作目錄命中時以工作目錄的優先序計', () => {
    const r = run('部署', { cwd: 'D:/github/shark', signals: [taskTypeSignal, cwdSignal] });
    expect(r.candidates.filter((c) => c.text.includes('shark 部署')).every((c) => c.signal === 'cwd')).toBe(true);
  });
});
