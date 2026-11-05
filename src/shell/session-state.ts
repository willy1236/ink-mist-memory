import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { ReadonlySessionState } from './types.js';

/** 覆寫 session 狀態目錄的環境變數（測試時指向暫存資料夾）。 */
export const SESSION_DIR_ENV = 'INK_MIST_SESSION_DIR';

const RETENTION_MS = 30 * 24 * 60 * 60 * 1000;
const LOCK_STALE_MS = 2000;
const LOCK_WAIT_MS = 1000;

export function defaultSessionDir(): string {
  const fromEnv = process.env[SESSION_DIR_ENV];
  if (fromEnv) return fromEnv;
  const base = process.env.LOCALAPPDATA ?? path.join(os.homedir(), '.local', 'state');
  return path.join(base, 'ink-mist-memory', 'sessions');
}

interface StoredState {
  injectedIds: string[];
  indexInjected: boolean;
}

const EMPTY: StoredState = { injectedIds: [], indexInjected: false };

export interface SessionState {
  get(): ReadonlySessionState;
  markInjected(ids: readonly string[]): void;
  markIndexInjected(): void;
  reset(): void;
}

/** session_id 轉成安全的檔名。 */
function fileNameFor(sessionId: string): string {
  const safe = sessionId.replace(/[^A-Za-z0-9_-]/g, '_') || '_empty';
  return `${safe}.json`;
}

function sleepSync(ms: number): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

function readState(file: string): StoredState {
  try {
    const raw = JSON.parse(fs.readFileSync(file, 'utf8')) as Partial<StoredState>;
    return {
      injectedIds: Array.isArray(raw.injectedIds) ? raw.injectedIds.filter((x) => typeof x === 'string') : [],
      indexInjected: raw.indexInjected === true,
    };
  } catch {
    return { ...EMPTY, injectedIds: [] };
  }
}

/** 先寫暫存檔再改名，讀的一方不會看到寫一半的檔；Windows 上改名撞到占用時重試。 */
function writeState(file: string, state: StoredState): void {
  const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(state));
  const deadline = Date.now() + LOCK_WAIT_MS;
  for (;;) {
    try {
      fs.renameSync(tmp, file);
      return;
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      if ((code === 'EPERM' || code === 'EBUSY' || code === 'EACCES') && Date.now() < deadline) {
        sleepSync(10);
        continue;
      }
      fs.rmSync(tmp, { force: true });
      throw err;
    }
  }
}

/** 以 lock 檔序列化同一 session 的讀改寫，讓先後完成的兩次 hook 不會互相蓋掉。 */
function withLock<T>(file: string, fn: () => T): T {
  const lock = `${file}.lock`;
  const deadline = Date.now() + LOCK_WAIT_MS;
  for (;;) {
    try {
      fs.closeSync(fs.openSync(lock, 'wx'));
      break;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'EEXIST') throw err;
      try {
        if (Date.now() - fs.statSync(lock).mtimeMs > LOCK_STALE_MS) {
          fs.rmSync(lock, { force: true });
          continue;
        }
      } catch {
        continue; // lock 剛被釋放
      }
      if (Date.now() >= deadline) throw new Error(`session 狀態鎖定逾時：${lock}`, { cause: err });
      sleepSync(10);
    }
  }
  try {
    return fn();
  } finally {
    fs.rmSync(lock, { force: true });
  }
}

/** 取得單一 session 的狀態存取器。寫入方法只由外殼呼叫。 */
export function sessionState(sessionId: string, dir = defaultSessionDir()): SessionState {
  const file = path.join(dir, fileNameFor(sessionId));
  const update = (fn: (s: StoredState) => StoredState) => {
    fs.mkdirSync(dir, { recursive: true });
    withLock(file, () => writeState(file, fn(readState(file))));
  };
  return {
    get: () => readState(file),
    markInjected: (ids) =>
      update((s) => ({ ...s, injectedIds: [...new Set([...s.injectedIds, ...ids])] })),
    markIndexInjected: () => update((s) => ({ ...s, indexInjected: true })),
    reset: () => update(() => ({ injectedIds: [], indexInjected: false })),
  };
}

/** 清除超過 30 天未更新的 session 狀態檔。回傳刪除的檔名。 */
export function cleanupSessionStates(dir = defaultSessionDir(), now = Date.now()): string[] {
  let names: string[];
  try {
    names = fs.readdirSync(dir);
  } catch {
    return [];
  }
  const removed: string[] = [];
  for (const name of names) {
    const full = path.join(dir, name);
    try {
      if (now - fs.statSync(full).mtimeMs > RETENTION_MS) {
        fs.rmSync(full, { force: true });
        removed.push(name);
      }
    } catch {
      // 檔案可能剛被其他 hook 刪掉
    }
  }
  return removed;
}
