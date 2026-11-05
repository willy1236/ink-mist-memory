import type { Platform } from '../platforms/index.js';
import type { LogRecord } from './log.js';
import { failureNotice } from './notice.js';

export interface ShellFailure {
  /** 未設定時失敗通知改為說明路徑未設定。 */
  memoryRoot: string | undefined;
  /** 用它從輸入取欄位、決定失敗通知的輸出格式。 */
  platform: Platform;
  startedAt: number;
  /** 已解析的 hook 輸入（可能不完整或為空物件）。 */
  raw: Record<string, unknown>;
  /** runHook 是否已開始輸出；是的話不再輸出失敗通知，以免 stdout 出現兩段 JSON。 */
  outputStarted: boolean;
  reason: string;
}

/** 外殼層級失敗（輸入錯誤、外殼逾時、未捕捉例外）時要寫的紀錄與要輸出的內容。 */
export function shellFailure(f: ShellFailure, now = Date.now()): { record: LogRecord; output?: string } {
  const input = f.platform.readInput(f.raw);
  const { prompt } = input;
  const record: LogRecord = {
    time: new Date(now).toISOString(),
    event: input.nativeEvent ?? 'UserPromptSubmit',
    session_id: input.sessionId,
    cwd: input.cwd,
    ...(prompt !== undefined && { prompt }),
    entries: [],
    index: false,
    notes: [],
    failure: f.outputStarted ? `輸出後${f.reason}；已輸出的條目未記入去重，也不在本筆紀錄中` : f.reason,
    duration_ms: now - f.startedAt,
  };
  if (f.outputStarted) return { record };
  const output = f.platform.formatOutput(input, failureNotice(f.memoryRoot));
  return { record, output };
}

export interface FailAndExitDeps {
  /** 未設定時沒有地方寫紀錄，只輸出失敗通知。 */
  memoryRoot: string | undefined;
  platform: Platform;
  startedAt: number;
  /** 呼叫當下的 hook 輸入與是否已開始輸出。 */
  current: () => { raw: Record<string, unknown>; outputStarted: boolean };
  writeLog: (record: LogRecord) => void;
  /** 寫出失敗通知，完成後呼叫 done。 */
  writeOutput: (text: string, done: () => void) => void;
  exit: () => void;
}

/**
 * 建立外殼層級的失敗處理：第一次呼叫寫紀錄、尚未輸出時再輸出失敗通知，然後結束。
 * 之後的呼叫（如 watchdog 在通知卡住未送出時觸發）不再寫紀錄或輸出，直接結束行程。
 */
export function createFailAndExit(deps: FailAndExitDeps): (reason: string) => void {
  let exiting = false;
  return (reason) => {
    if (exiting) {
      deps.exit();
      return;
    }
    exiting = true;
    const { raw, outputStarted } = deps.current();
    const { record, output } = shellFailure({
      memoryRoot: deps.memoryRoot,
      platform: deps.platform,
      startedAt: deps.startedAt,
      raw,
      outputStarted,
      reason,
    });
    if (deps.memoryRoot !== undefined) deps.writeLog(record);
    if (output === undefined) deps.exit();
    else deps.writeOutput(output, deps.exit);
  };
}
