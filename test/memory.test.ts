import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { describe, expect, it } from 'vitest';
import { listMemoryFiles, loadMemory, normalize } from '../src/memory/index.js';
import { tempDir } from './helpers.js';

const fm = (name: string, extra = '') => `---\nname: ${name}\ndescription: ${name} 的描述\n${extra}version: 2026-11-01T00:00:00Z\n---\n`;

const AGENTS = `# 共享記憶

## 5. 讀取通則
- 注入的條目直接採信
- [ref] 不是條目，這裡只是 AGENTS 內文

### 細節
巢狀小節也算本節。

## 6. 其他
不相關。

| 欄 | 說明 |
| --- | --- |
| a | b |

| 任務類型 | 提示關鍵字 | 說明 |
| --- | --- | --- |
| 寫程式 | 實作、\`code\`、 debug | x |
| Ｇｉｔ 操作 | commit、push | y |
| 部署 | CI/CD、上線 | z |
`;

function store(files: Record<string, string>): string {
  const root = tempDir();
  for (const [rel, content] of Object.entries({ 'AGENTS.md': AGENTS, ...files })) {
    fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
    fs.writeFileSync(path.join(root, rel), content);
  }
  return root;
}

describe('listMemoryFiles', () => {
  it('排除非記憶檔、必載檔與 history／reports／_injection-log／點開頭資料夾', () => {
    const excluded = [
      'AGENTS.md', 'AGENTS.legacy-read.md', 'use_with_agent.md', 'use_with_agent.claude-code.md',
      'use_with_agent.others.md', 'preferences.md', 'conduct.md', 'history/2026-01-01-x.md',
      'reports/2026-01-01-y.md', '_injection-log/2026-01-01.jsonl', '.obsidian/a.md', 'areas/notes.txt',
    ];
    const kept = ['profile.md', 'topics/food.md', 'areas/a.md', 'areas/f/_index.md', 'areas/f/x.md', 'people/p.md', 'areas/history/h.md'];
    const root = store(Object.fromEntries([...excluded, ...kept].map((f) => [f, fm('n')])));
    expect(listMemoryFiles(root)).toEqual([...kept].sort());
  });

  it('排除驗證紀錄的 verification/ 資料夾，子資料夾同名的 verification 不受影響', () => {
    const excluded = ['verification/tasks/t-1.yaml.md', 'verification/runs/t-1/report.md'];
    const kept = ['profile.md', 'areas/verification/v.md'];
    const root = store(Object.fromEntries([...excluded, ...kept].map((f) => [f, fm('n')])));
    expect(listMemoryFiles(root)).toEqual([...kept].sort());
  });
});

describe('loadMemory 條目', () => {
  it('條目＝帶標籤的頂層列表項目連同子項；子項、無標籤項目、表格、段落都不是條目', () => {
    const root = store({
      'areas/a.md': `${fm('a')}
- [stated] 第一條
  - 子項一
    - 孫項
  - [inferred] 帶標籤的子項不單獨成條目
- 無標籤父項
  - [stated] 無標籤父項下的帶標籤子項
段落文字 [stated] 不算。

| [stated] 表格 |
| --- |
| x |

* [ref] https://example.com — 星號列表也算
- [ref]: https://example.com/def
-
  [stated] 內容寫在下一行也算
-
      [stated] 縮排過深是程式碼區塊，不算
1. [inferred] 有序列表也算（依據：x）
`,
    });
    const file = loadMemory(root).files.find((f) => f.path === 'areas/a.md')!;
    expect(file.entries.map((e) => e.text)).toEqual([
      '- [stated] 第一條\n  - 子項一\n    - 孫項\n  - [inferred] 帶標籤的子項不單獨成條目',
      '* [ref] https://example.com — 星號列表也算',
      '- [ref]: https://example.com/def',
      '-\n  [stated] 內容寫在下一行也算',
      '1. [inferred] 有序列表也算（依據：x）',
    ]);
  });

  it('條目帶所屬檔案、二級標題、任務類型（含巢狀標題）與識別', () => {
    const root = store({
      'topics/t.md': `${fm('t')}
- [stated] 開頭
## 一般
- [stated] 一般標題下
## 任務：寫程式
- [stated] 任務標題下

說明文字
---
- [stated] 分隔線不被當成 setext 標題
### 巢狀
- [stated] 巢狀標題下
## 任務:\u3000ＧＩＴ 操作
- [stated] 前綴與類型名全半形、大小寫、空白不同
# 一級標題
- [stated] 一級標題後
`,
    });
    const entries = loadMemory(root).files[0]!.entries;
    expect(entries.map(({ file, heading, taskType }) => ({ file, heading, taskType }))).toEqual([
      { file: 'topics/t.md', heading: null, taskType: null },
      { file: 'topics/t.md', heading: '一般', taskType: null },
      { file: 'topics/t.md', heading: '任務：寫程式', taskType: '寫程式' },
      { file: 'topics/t.md', heading: '任務：寫程式', taskType: '寫程式' },
      { file: 'topics/t.md', heading: '任務：寫程式', taskType: '寫程式' },
      { file: 'topics/t.md', heading: '任務:　ＧＩＴ 操作', taskType: 'Ｇｉｔ 操作' },
      { file: 'topics/t.md', heading: null, taskType: null },
    ]);
    expect(new Set(entries.map((e) => e.id)).size).toBe(entries.length);
  });

  it('setext 二級標題（文字下一行接 ---）不當成標題並提醒；setext 一級標題（===）照常清掉二級標題', () => {
    const m = loadMemory(store({
      'topics/t.md': `${fm('t')}## 任務：寫程式\n- [stated] a\n\n說明文字\n第二行${'長'.repeat(40)}\n---\n- [stated] b\n\n大標\n===\n- [stated] c\n`,
    }));
    expect(m.files[0]!.entries.map((e) => e.taskType)).toEqual(['寫程式', '寫程式', null]);
    // 只取第一行、附檔案中的行號（frontmatter 佔 5 行）
    expect(m.notes).toEqual([expect.stringContaining('topics/t.md 第 9 行起的「說明文字」下一行接 ---，不當成二級標題')]);
  });

  it('識別由「檔案＋正規化內容」決定：行尾空白與換行格式不影響，內容或檔案不同就不同', () => {
    const body = (s: string) => `${fm('x')}\n${s}\n`;
    const id = (rel: string, s: string) => loadMemory(store({ [rel]: body(s) })).files[0]!.entries[0]!.id;
    const base = id('topics/x.md', '- [stated] 內容');
    expect(id('topics/x.md', '- [stated] 內容   ')).toBe(base);
    expect(loadMemory(store({ 'topics/x.md': body('- [stated] 內容').replaceAll('\n', '\r\n') })).files[0]!.entries[0]!.id).toBe(base);
    expect(id('topics/x.md', '- [stated] 內容改了')).not.toBe(base);
    expect(id('topics/y.md', '- [stated] 內容')).not.toBe(base);
  });
});

describe('loadMemory 檔案層級', () => {
  it('回傳 frontmatter 欄位；缺 version 照常回傳且 version 為 null', () => {
    const root = store({
      'areas/a.md': `---\nname: a\ndescription: 描述\naliases: [甲, A]\nrepos: D:/github/a\n---\n- [stated] x\n`,
    });
    const m = loadMemory(root);
    expect(m.files).toEqual([
      expect.objectContaining({
        path: 'areas/a.md', name: 'a', displayName: 'a', description: '描述',
        aliases: ['甲', 'A'], repos: ['D:/github/a'], version: null, folder: null, isFolderIndex: false,
      }),
    ]);
    expect(m.notes).toEqual([]);
  });

  it('frontmatter 無法解析、沒有 frontmatter 或缺 name 的檔跳過並提醒，其餘照常', () => {
    const m = loadMemory(store({
      'topics/bad.md': '---\nname: [unclosed\n---\n- [stated] x\n',
      'topics/none.md': '- [stated] x\n',
      'topics/noname.md': '---\ndescription: d\n---\n- [stated] x\n',
      'topics/ok.md': `${fm('ok')}- [stated] x\n`,
    }));
    expect(m.files.map((f) => f.path)).toEqual(['topics/ok.md']);
    expect(m.notes).toEqual([
      expect.stringMatching(/^topics\/bad\.md frontmatter 無法解析/),
      'topics/noname.md frontmatter 缺 name，已跳過',
      'topics/none.md 沒有 frontmatter，已跳過',
    ]);
  });

  it('資料夾型 areas：_index.md 以資料夾名與其 aliases、repos 代表整個資料夾；子檔設 aliases、repos 時忽略並提醒', () => {
    const m = loadMemory(store({
      'areas/shark/_index.md': `---\nname: _index\ndescription: 總覽\naliases: [鯊魚]\nrepos: [D:/github/shark]\n---\n- [[areas/shark/x]] — 子檔\n`,
      'areas/shark/x.md': `---\nname: x\ndescription: d\naliases: [子別名]\nrepos: [D:/y]\n---\n- [stated] x\n`,
      'areas/shark/sub/y.md': `${fm('y')}- [stated] y\n`,
      'areas/lonely/z.md': `${fm('z')}- [stated] z\n`,
    }));
    const byPath = Object.fromEntries(m.files.map((f) => [f.path, f]));
    expect(byPath['areas/shark/_index.md']).toMatchObject({
      displayName: 'shark', aliases: ['鯊魚'], repos: ['D:/github/shark'], folder: 'shark', isFolderIndex: true, entries: [],
    });
    expect(byPath['areas/shark/x.md']).toMatchObject({ aliases: [], repos: [], folder: 'shark', isFolderIndex: false });
    expect(byPath['areas/shark/x.md']!.entries).toHaveLength(1);
    expect(byPath['areas/shark/sub/y.md']).toMatchObject({ folder: 'shark', isFolderIndex: false });
    expect(m.notes).toEqual([
      'areas/lonely/ 缺 _index.md',
      'areas/shark/x.md 是資料夾型 areas 的子檔，設了 aliases、repos 不參與比對，請改寫在 _index.md',
    ]);
  });
});

describe('loadMemory AGENTS.md', () => {
  it('擷取「讀取通則」一節（去掉前置編號比對，含巢狀小節），不把 AGENTS.md 當記憶檔', () => {
    const m = loadMemory(store({}));
    expect(m.readingRules).toBe('- 注入的條目直接採信\n- [ref] 不是條目，這裡只是 AGENTS 內文\n\n### 細節\n巢狀小節也算本節。');
    expect(m.files).toEqual([]);
  });

  it.each(['## 讀取通則', '## 6 讀取通則', '## §6、讀取通則', '## 六、讀取通則'])('標題「%s」也認得', (h) => {
    const root = store({});
    fs.writeFileSync(path.join(root, 'AGENTS.md'), `${h}\n內容\n`);
    expect(loadMemory(root).readingRules).toBe('內容');
  });

  it('讀取通則內的 setext 二級標題（文字下一行接 ---）不截斷該節', () => {
    const root = store({});
    fs.writeFileSync(path.join(root, 'AGENTS.md'), '## 讀取通則\n前段\n\n說明\n---\n後段\n## 其他\nx\n');
    expect(loadMemory(root).readingRules).toBe('前段\n\n說明\n---\n後段');
  });

  it('任務類型表格取第一個表頭含兩欄的表格，關鍵字只以頓號切開', () => {
    expect(loadMemory(store({})).taskTypes).toEqual([
      { name: '寫程式', keywords: ['實作', 'code', 'debug'] },
      { name: 'Ｇｉｔ 操作', keywords: ['commit', 'push'] },
      { name: '部署', keywords: ['CI/CD', '上線'] },
    ]);
  });

  it('關鍵字含逗號或分號時整串當一個關鍵字並提醒', () => {
    const root = store({});
    fs.writeFileSync(path.join(root, 'AGENTS.md'), '| 任務類型 | 提示關鍵字 |\n| --- | --- |\n| 部署 | 上線, release、ship |\n');
    const m = loadMemory(root);
    expect(m.taskTypes).toEqual([{ name: '部署', keywords: ['上線, release', 'ship'] }]);
    expect(m.notes).toContain('任務類型「部署」的關鍵字「上線, release」含逗號或分號；關鍵字只以頓號分隔，這裡會整串當成一個關鍵字');
  });

  it('沒有兩欄表頭的表格時回傳解析失敗與提醒；找不到讀取通則也提醒', () => {
    const root = store({ 'topics/t.md': `${fm('t')}## 任務：寫程式\n- [stated] x\n` });
    fs.writeFileSync(path.join(root, 'AGENTS.md'), '## 其他\n\n| 任務類型 | 說明 |\n| --- | --- |\n| a | b |\n');
    const m = loadMemory(root);
    expect(m.taskTypes).toBeNull();
    expect(m.readingRules).toBeNull();
    expect(m.files[0]!.entries[0]!.taskType).toBeNull();
    expect(m.notes).toEqual([
      'AGENTS.md 找不到「讀取通則」一節',
      expect.stringContaining('任務類型表格解析失敗'),
    ]);
  });

  it('帶「任務：」前綴但不在表內的二級標題產生提醒', () => {
    const m = loadMemory(store({ 'topics/t.md': `${fm('t')}## 任務：煮飯\n- [stated] x\n## 任務:寫程式\n- [stated] y\n` }));
    expect(m.files[0]!.entries.map((e) => e.taskType)).toEqual([null, '寫程式']);
    expect(m.notes).toEqual(['topics/t.md 的標題「任務：煮飯」帶「任務：」前綴，但不在任務類型表內']);
  });

  it('AGENTS.md 不存在時兩者皆為 null 並提醒，記憶檔照常解析', () => {
    const root = store({ 'topics/t.md': `${fm('t')}- [stated] x\n` });
    fs.rmSync(path.join(root, 'AGENTS.md'));
    const m = loadMemory(root);
    expect([m.taskTypes, m.readingRules, m.files.length]).toEqual([null, null, 1]);
    expect(m.notes[0]).toMatch(/^AGENTS\.md 讀不到/);
  });
});

describe('loadMemory 錯誤與效能', () => {
  it('記憶庫路徑不存在時丟例外', () => {
    expect(() => loadMemory(path.join(tempDir(), 'missing'))).toThrow('記憶庫路徑不存在');
  });

  it('normalize 去前後空白、轉小寫、全形轉半形', () => {
    expect(normalize('　Ｓｈａｒｋ：ＡＢ　')).toBe('shark:ab');
  });

  // 設 INK_MIST_REAL_STORE 指向實際記憶庫時才跑
  const realStore = process.env.INK_MIST_REAL_STORE ?? '';
  it.runIf(realStore !== '' && fs.existsSync(realStore))('以實際記憶庫全庫解析（新行程、含模組載入）在 3 秒內完成', () => {
    const mod = pathToFileURL(path.resolve('dist/memory/index.js')).href;
    const script = `import { performance } from 'node:perf_hooks';
const t0 = performance.now();
const { loadMemory } = await import(${JSON.stringify(mod)});
const t1 = performance.now();
const m = loadMemory(${JSON.stringify(realStore)});
const t2 = performance.now();
console.log(JSON.stringify({ total: Math.round(t2), importMs: Math.round(t1 - t0), parseMs: Math.round(t2 - t1),
  files: m.files.length, entries: m.files.reduce((n, f) => n + f.entries.length, 0), notes: m.notes.length }));`;
    const out = JSON.parse(execFileSync(process.execPath, ['--input-type=module', '-e', script], { encoding: 'utf8' })) as {
      total: number;
    };
    console.log('記憶庫全庫解析耗時', out);
    expect(out.total).toBeLessThan(3000);
  });
});
