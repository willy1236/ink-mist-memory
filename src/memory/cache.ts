import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { listMemoryFiles, loadMemory } from './load.js';
import type { Memory } from './types.js';

export const CACHE_DIR_ENV = 'INK_MIST_CACHE_DIR';

export function defaultCacheDir(): string {
  const fromEnv = process.env[CACHE_DIR_ENV];
  if (fromEnv) return fromEnv;
  const base = process.env.LOCALAPPDATA ?? path.join(os.homedir(), '.local', 'state');
  return path.join(base, 'ink-mist-memory', 'cache');
}

interface Stored {
  fingerprint: string;
  memory: Memory;
}

function statKey(file: string): string {
  const s = fs.statSync(file, { throwIfNoEntry: false });
  return s ? `${s.mtimeMs}:${s.size}` : '-';
}

/**
 * 記憶庫現況的指紋：`AGENTS.md` 與每個記憶檔的路徑、mtime、大小，加上本程式檔的 mtime，
 * 重新建置後舊快取自動失效。只 stat 不讀內容。
 */
function fingerprint(root: string): string {
  const parts = [
    `code ${statKey(fileURLToPath(import.meta.url))}`,
    `AGENTS.md ${statKey(path.join(root, 'AGENTS.md'))}`,
    ...listMemoryFiles(root).map((rel) => `${rel} ${statKey(path.join(root, rel))}`),
  ];
  return createHash('sha256').update(parts.join('\n')).digest('hex');
}

function readStored(file: string): Stored | undefined {
  try {
    const data = JSON.parse(fs.readFileSync(file, 'utf8')) as Stored;
    return typeof data.fingerprint === 'string' && typeof data.memory === 'object' ? data : undefined;
  } catch {
    return undefined;
  }
}

function writeStored(file: string, stored: Stored): void {
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(stored));
    fs.renameSync(tmp, file);
  } catch {
    // 寫不進快取只影響下次速度，不影響這次結果
  }
}

/**
 * 同 `loadMemory`，但記憶庫自上次解析後沒變動時直接取快取，省下逐檔解析 Markdown 的時間。
 * 判斷是否變動只 stat 檔案；任何記憶檔、`AGENTS.md` 或程式本身變動都會重新解析並更新快取。
 * 快取讀寫失敗時照常解析，不丟例外。
 */
export function loadMemoryCached(root: string, cacheDir = defaultCacheDir()): Memory {
  const fp = fingerprint(root);
  const file = path.join(cacheDir, `${createHash('sha256').update(path.resolve(root)).digest('hex').slice(0, 16)}.json`);
  const stored = readStored(file);
  if (stored?.fingerprint === fp) return stored.memory;
  const memory = loadMemory(root);
  writeStored(file, { fingerprint: fp, memory });
  return memory;
}
