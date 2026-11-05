import type { Memory, MemoryFile } from '../memory/index.js';

/** 命中的檔案展開成實際要注入的檔案：資料夾型 `_index.md` 代表整個資料夾的所有檔案。 */
export function expandFolders(memory: Memory, hits: readonly MemoryFile[]): MemoryFile[] {
  const folders = new Set(hits.filter((f) => f.isFolderIndex).map((f) => f.folder));
  const picked = new Set(hits);
  return memory.files.filter((f) => picked.has(f) || (f.folder !== null && folders.has(f.folder)));
}

/** 路徑比對用的正規化：統一 `/`、去結尾 `/`、不分大小寫。 */
export function normalizePath(p: string): string {
  return p.trim().replaceAll('\\', '/').replace(/\/{2,}/g, '/').replace(/\/+$/, '').toLowerCase();
}

/** `dir` 等於 `base` 或位於其下；以路徑段為界，`D:/github/foobar` 不在 `D:/github/foo` 之下。 */
export function isUnder(dir: string, base: string): boolean {
  const d = normalizePath(dir);
  const b = normalizePath(base);
  if (b === '') return false;
  return d === b || d.startsWith(`${b}/`);
}
