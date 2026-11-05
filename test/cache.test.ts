import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { loadMemory, loadMemoryCached } from '../src/memory/index.js';
import { memoryStore, tempDir } from './helpers.js';

const AGENTS = '# 共享記憶\n\n## 0. 讀取通則\n- 規則\n\n| 任務類型 | 提示關鍵字 |\n| --- | --- |\n| 部署 | 部署 |\n';
const file = (body: string) => `---\nname: a\ndescription: d\nversion: 2026-11-01T00:00:00Z\n---\n\n${body}\n`;

describe('loadMemoryCached', () => {
  it('結果與 loadMemory 相同，第二次取快取', () => {
    const root = memoryStore({ 'AGENTS.md': AGENTS, 'topics/a.md': file('- [stated] 一') });
    const cache = tempDir();
    const first = loadMemoryCached(root, cache);
    expect(first).toEqual(loadMemory(root));
    expect(fs.readdirSync(cache)).toHaveLength(1);
    expect(loadMemoryCached(root, cache)).toEqual(first);
  });

  it('記憶檔改動、新增或 AGENTS.md 改動後重新解析', () => {
    const root = memoryStore({ 'AGENTS.md': AGENTS, 'topics/a.md': file('- [stated] 一') });
    const cache = tempDir();
    loadMemoryCached(root, cache);
    fs.writeFileSync(path.join(root, 'topics/a.md'), file('- [stated] 一改過了'));
    expect(loadMemoryCached(root, cache).files[0]!.entries[0]!.text).toBe('- [stated] 一改過了');
    fs.writeFileSync(path.join(root, 'topics/b.md'), file('- [stated] 二').replace('name: a', 'name: b'));
    expect(loadMemoryCached(root, cache).files.map((f) => f.path)).toEqual(['topics/a.md', 'topics/b.md']);
    fs.writeFileSync(path.join(root, 'AGENTS.md'), AGENTS.replace('| 部署 | 部署 |', '| 部署 | 部署、上線 |'));
    expect(loadMemoryCached(root, cache).taskTypes).toEqual([{ name: '部署', keywords: ['部署', '上線'] }]);
  });

  it('快取檔損壞或寫不進去時照常解析', () => {
    const root = memoryStore({ 'AGENTS.md': AGENTS, 'topics/a.md': file('- [stated] 一') });
    const cache = tempDir();
    loadMemoryCached(root, cache);
    for (const f of fs.readdirSync(cache)) fs.writeFileSync(path.join(cache, f), '{壞掉');
    expect(loadMemoryCached(root, cache)).toEqual(loadMemory(root));
    const blocker = path.join(tempDir(), 'not-a-dir');
    fs.writeFileSync(blocker, '');
    expect(loadMemoryCached(root, blocker)).toEqual(loadMemory(root));
  });
});
