import fs from 'node:fs';
import path from 'node:path';

export const LOG_DIR_NAME = '_injection-log';
const RETENTION_DAYS = 30;
const LOG_FILE = /^(\d{4})-(\d{2})-(\d{2})\.jsonl$/;

export interface LogRecord {
  time: string;
  event: string;
  session_id: string;
  cwd: string;
  prompt?: string;
  source?: string;
  entries: { id: string; file: string; signal: string }[];
  index: boolean;
  notes: string[];
  failure?: string;
  duration_ms: number;
  /**
   * 處理函式成功時各階段完成的時間點，皆從入口被呼叫起算（ms）：
   * 呼叫 worker、worker 上線、模組載入完成、處理函式回傳。用來看預算花在哪一段。
   */
  timing?: { worker_called_ms: number; worker_online_ms: number; module_loaded_ms: number; handler_done_ms: number };
}

function pad(n: number): string {
  return String(n).padStart(2, '0');
}

/** 以本機日期命名的每日紀錄檔名。 */
export function logFileName(date: Date): string {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}.jsonl`;
}

/** 寫一筆紀錄；失敗時回傳錯誤訊息而不丟例外，讓注入照常。 */
export function writeLog(memoryRoot: string, record: LogRecord, now = new Date()): string | undefined {
  try {
    const dir = path.join(memoryRoot, LOG_DIR_NAME);
    fs.mkdirSync(dir, { recursive: true });
    fs.appendFileSync(path.join(dir, logFileName(now)), JSON.stringify(record) + '\n');
    return undefined;
  } catch (err) {
    return err instanceof Error ? err.message : String(err);
  }
}

/** 清除檔名日期早於 30 天前的紀錄檔。不丟例外。回傳刪除的檔名。 */
export function cleanupLogs(memoryRoot: string, now = new Date()): string[] {
  const dir = path.join(memoryRoot, LOG_DIR_NAME);
  let names: string[];
  try {
    names = fs.readdirSync(dir);
  } catch {
    return [];
  }
  const cutoff = new Date(now.getFullYear(), now.getMonth(), now.getDate() - RETENTION_DAYS);
  const removed: string[] = [];
  for (const name of names) {
    const m = LOG_FILE.exec(name);
    if (!m) continue;
    const day = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
    if (day < cutoff) {
      try {
        fs.rmSync(path.join(dir, name), { force: true });
        removed.push(name);
      } catch {
        // 忽略
      }
    }
  }
  return removed;
}
