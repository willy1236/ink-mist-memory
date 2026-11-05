import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach } from 'vitest';
import type { InjectedEntry } from '../src/shell/types.js';

const created: string[] = [];

afterEach(() => {
  while (created.length) fs.rmSync(created.pop()!, { recursive: true, force: true });
});

/** 建立測試結束自動刪除的暫存資料夾。 */
export function tempDir(prefix = 'imm-'): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  created.push(dir);
  return dir;
}

/** 在暫存資料夾寫一個處理函式模組（純 JS，worker 直接載入），回傳路徑。 */
export function handlerModule(dir: string, body: string): string {
  const file = path.join(dir, `handler-${Math.random().toString(36).slice(2)}.mjs`);
  fs.writeFileSync(file, `export default async function handler(ctx) {\n${body}\n}\n`);
  return file;
}

export function entry(i: number, text = `- [stated] 條目 ${i}`): InjectedEntry {
  return { id: `id-${i}`, file: `areas/f${i}.md`, text, signal: 'cwd' };
}

export function readLogs(memoryRoot: string): Record<string, unknown>[] {
  const dir = path.join(memoryRoot, '_injection-log');
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .flatMap((f) => fs.readFileSync(path.join(dir, f), 'utf8').split('\n').filter(Boolean))
    .map((line) => JSON.parse(line) as Record<string, unknown>);
}

const HOOK = path.resolve('dist/hook.js');

/** 執行編譯後的 hook 入口。`stdin` 為 undefined 時不關閉 stdin，模擬外殼卡住。 */
export function runCli(stdin: string | undefined, args: string[], env: NodeJS.ProcessEnv = {}) {
  return new Promise<{ code: number | null; stdout: string; ms: number }>((resolve) => {
    const began = Date.now();
    const child = spawn(process.execPath, [HOOK, ...args], { env: { ...process.env, ...env } });
    let stdout = '';
    child.stdout.on('data', (d: Buffer) => (stdout += d.toString('utf8')));
    child.on('exit', (code) => resolve({ code, stdout, ms: Date.now() - began }));
    if (stdin !== undefined) child.stdin.end(stdin);
  });
}

/** 在暫存資料夾建立記憶庫，`files` 為相對路徑 → 內容。 */
export function memoryStore(files: Record<string, string>): string {
  const root = tempDir();
  for (const [rel, content] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
    fs.writeFileSync(path.join(root, rel), content);
  }
  return root;
}
