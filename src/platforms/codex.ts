import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { jsonContextHook } from './json-context-hook.js';
import type { Platform } from './types.js';

/** Codex 內建記憶功能的資料夾；整理 agent 以此為工作目錄執行，新安裝用 `memories_v2`。 */
const MEMORY_DIRS = ['memories', 'memories_v2'];

function normalize(path: string): string {
  const abs = resolve(path).replace(/\\/g, '/').replace(/\/+$/, '');
  return process.platform === 'win32' ? abs.toLowerCase() : abs;
}

/** 工作目錄在 Codex 記憶資料夾內時，是 Codex 記憶功能派出的整理 agent。 */
function isMemoryAgent(cwd: string): boolean {
  if (cwd === '') return false;
  const home = process.env.CODEX_HOME || join(homedir(), '.codex');
  const dir = normalize(cwd);
  return MEMORY_DIRS.some((name) => {
    const root = normalize(join(home, name));
    return dir === root || dir.startsWith(`${root}/`);
  });
}

export const codex: Platform = {
  name: 'codex',
  // 搭配 README 的 additionalContextLimit，為中文記憶保留完整條目的空間。
  maxChars: 10000,
  ...jsonContextHook,
  readInput(raw) {
    const input = jsonContextHook.readInput(raw);
    return isMemoryAgent(input.cwd) ? { ...input, skip: 'Codex 記憶整理 agent，不注入' } : input;
  },
};
