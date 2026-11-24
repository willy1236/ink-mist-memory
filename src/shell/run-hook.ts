import { DEFAULT_PLATFORM, type Platform } from '../platforms/index.js';
import { cleanupLogs, writeLog, type LogRecord } from './log.js';
import { failureNotice } from './notice.js';
import { fitWithinLimit, SEPARATOR } from './fit.js';
import { cleanupSessionStates, defaultSessionDir, sessionState } from './session-state.js';
import { runInWorker } from './worker-runner.js';
import type { HandlerContext, HandlerRef, HandlerResult, HookInput, InjectedEntry, ReadonlySessionState } from './types.js';

export const TIMEOUT_MS = 3000;
export const MAX_ENTRIES = 30;
/**
 * 預留給輸出與寫紀錄的時間：worker 須在 3 秒前這麼久完成。
 * 計時起點 `performance.timeOrigin` 不含行程建立的約 50 ms，一併算進預留。
 */
export const OUTPUT_MARGIN_MS = 200;
export const ENTRY_HEADER = '以下是與這次提示相關的記憶條目，每條前面標示所屬檔案：';

export interface RunHookOptions {
  memoryRoot: string;
  /** 入口被呼叫的時間（epoch ms），3 秒從此起算。預設為現在。 */
  startedAt?: number;
  timeoutMs?: number;
  sessionDir?: string;
  /** 輸出 hook JSON；resolve 代表輸出完成。預設寫 stdout。 */
  write?: (text: string) => Promise<void>;
  /** 決定輸出格式與字元上限的平台。預設為 Claude Code。 */
  platform?: Platform;
}

export interface RunHookReport {
  /** 實際輸出的 JSON 字串；沒有內容要注入時為 undefined。 */
  output?: string;
  record: LogRecord;
}

function writeStdout(text: string): Promise<void> {
  return new Promise((resolve, reject) => {
    process.stdout.write(text, (err) => (err ? reject(err) : resolve()));
  });
}

function errorText(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function isEntry(x: unknown): x is InjectedEntry {
  const e = x as InjectedEntry;
  return (
    typeof e === 'object' && e !== null &&
    typeof e.id === 'string' && typeof e.file === 'string' &&
    typeof e.text === 'string' && typeof e.signal === 'string'
  );
}

function isStringArray(x: unknown): x is string[] {
  return Array.isArray(x) && x.every((s) => typeof s === 'string');
}

function validateResult(x: unknown): HandlerResult | undefined {
  const r = x as HandlerResult;
  if (typeof r !== 'object' || r === null) return undefined;
  if (!isStringArray(r.sections) || !isStringArray(r.notes)) return undefined;
  if (!Array.isArray(r.candidates) || !r.candidates.every(isEntry)) return undefined;
  if (typeof r.isIndex !== 'boolean') return undefined;
  if (r.failed !== undefined && typeof r.failed !== 'string') return undefined;
  return r;
}

function joinParts(parts: string[]): string {
  return parts.filter((p) => p !== '').join(SEPARATOR);
}

/**
 * hook 共用外殼：重置（session 開始）→ worker 執行處理函式 → 截斷 → 輸出 →
 * 確認未逾時後記去重 → 清舊檔 → 寫紀錄。不丟例外，所有錯誤都轉成失敗通知。
 */
export async function runHook(
  input: HookInput,
  handler: HandlerRef | undefined,
  opts: RunHookOptions,
): Promise<RunHookReport> {
  const startedAt = opts.startedAt ?? Date.now();
  const deadline = startedAt + (opts.timeoutMs ?? TIMEOUT_MS);
  const sessionDir = opts.sessionDir ?? defaultSessionDir();
  const write = opts.write ?? writeStdout;
  const platform = opts.platform ?? DEFAULT_PLATFORM;
  const maxChars = platform.maxChars;
  const { memoryRoot } = opts;
  const notes: string[] = [];
  const failures: string[] = [];
  const isSessionStart = input.event === 'session-start';

  if (input.skip !== undefined) {
    const record: LogRecord = {
      time: new Date().toISOString(),
      event: input.nativeEvent ?? input.event ?? '',
      session_id: input.sessionId,
      cwd: input.cwd,
      ...(input.source !== undefined && { source: input.source }),
      entries: [],
      index: false,
      notes: [input.skip],
      duration_ms: Date.now() - startedAt,
    };
    writeLog(memoryRoot, record);
    return { record };
  }

  const state = sessionState(input.sessionId, sessionDir);
  // resume 還原完整對話，之前注入的內容仍在 context，去重要延續
  if (isSessionStart && input.source !== 'resume') {
    try {
      state.reset();
    } catch (err) {
      failures.push(`session 狀態重置失敗：${errorText(err)}`);
    }
  }

  // 處理函式
  let result: HandlerResult | undefined;
  let timing: LogRecord['timing'];
  if (!handler) {
    failures.push(`沒有對應事件 ${input.nativeEvent ?? input.event} 的處理函式`);
  } else {
    let snapshot: ReadonlySessionState;
    try {
      snapshot = state.get();
    } catch {
      snapshot = { injectedIds: [], indexInjected: false };
    }
    const ctx: HandlerContext = {
      sessionId: input.sessionId,
      cwd: input.cwd,
      memoryRoot,
      state: snapshot,
      ...(input.prompt !== undefined && { prompt: input.prompt }),
      ...(input.source !== undefined && { source: input.source }),
    };
    const beforeWorker = Date.now() - startedAt;
    const outcome = await runInWorker(handler, ctx, deadline - OUTPUT_MARGIN_MS - Date.now());
    if (outcome.kind === 'timeout') {
      failures.push(`處理函式逾時（超過 3 秒）：行程啟動到呼叫 worker 花了 ${beforeWorker} ms；${outcome.detail}`);
    } else if (outcome.kind === 'error') {
      failures.push(outcome.reason);
    } else {
      const called = Math.round(beforeWorker);
      timing = {
        worker_called_ms: called,
        worker_online_ms: called + outcome.timing.online_ms,
        module_loaded_ms: called + outcome.timing.module_loaded_ms,
        handler_done_ms: called + outcome.timing.done_ms,
      };
      result = validateResult(outcome.result);
      if (!result) failures.push('處理函式回傳格式錯誤');
    }
  }

  // 組字與截斷
  let used: InjectedEntry[] = [];
  let sectionsText = '';
  let entriesText = '';
  if (result) {
    notes.push(...result.notes);
    if (result.failed) failures.push(result.failed);
    sectionsText = joinParts(result.sections);
    if (isSessionStart) {
      const fit = fitWithinLimit(ENTRY_HEADER, result.candidates, Infinity, Infinity);
      entriesText = fit.text;
      used = fit.used;
    } else {
      if (sectionsText !== '' && result.candidates.length > 0) {
        notes.push('處理函式同時回傳固定段落與候選條目，條目可用的字元預算被固定段落壓縮');
      }
      const notice = failureNotice(memoryRoot);
      const reserve = notice.length + SEPARATOR.length;
      if (sectionsText.length > maxChars - reserve) {
        notes.push(`固定段落 ${sectionsText.length} 字元超過上限，已截斷`);
        sectionsText = sectionsText.slice(0, maxChars - reserve);
      }
      const remaining = maxChars - (sectionsText === '' ? 0 : sectionsText.length + SEPARATOR.length);
      const fit = fitWithinLimit(ENTRY_HEADER, result.candidates, MAX_ENTRIES, remaining, reserve, maxChars - reserve);
      entriesText = fit.text;
      used = fit.used;
      for (const e of fit.oversized) notes.push(`條目過長，單條就超過上限而無法注入：${e.file}（${e.id}）`);
      if (fit.dropped.length > 0) notes.push(`超過上限，捨棄 ${fit.dropped.length} 條候選`);
    }
  }
  let body = joinParts([sectionsText, entriesText]);
  if (failures.length > 0) body = joinParts([body, failureNotice(memoryRoot)]);
  if (isSessionStart && body.length > maxChars) {
    notes.push(`session 開始的注入內容 ${body.length} 字元，超過 ${maxChars} 字元，請精簡必載檔`);
  }

  // 輸出
  let output: string | undefined;
  let written = false;
  if (body !== '') {
    output = platform.formatOutput(input, body);
    try {
      await write(output);
      written = true;
    } catch (err) {
      failures.push(`輸出失敗：${errorText(err)}`);
    }
  }

  // 去重：只有確認輸出完成且未逾時才記
  if (written && result) {
    if (Date.now() > deadline) {
      notes.push('輸出完成時已超過 3 秒，本次條目未記入去重');
    } else {
      try {
        if (used.length > 0) state.markInjected(used.map((e) => e.id));
        if (result.isIndex && sectionsText !== '') state.markIndexInjected();
      } catch (err) {
        notes.push(`去重狀態寫入失敗：${errorText(err)}`);
      }
    }
  }

  // 清舊檔與寫紀錄；失敗都不影響注入
  cleanupLogs(memoryRoot);
  cleanupSessionStates(sessionDir);
  const record: LogRecord = {
    time: new Date().toISOString(),
    event: input.nativeEvent ?? input.event ?? '',
    session_id: input.sessionId,
    cwd: input.cwd,
    ...(input.prompt !== undefined && { prompt: input.prompt }),
    ...(input.source !== undefined && { source: input.source }),
    entries: written ? used.map(({ id, file, signal }) => ({ id, file, signal })) : [],
    index: written && !!result?.isIndex && sectionsText !== '',
    notes,
    ...(failures.length > 0 && { failure: failures.join('；') }),
    duration_ms: Date.now() - startedAt,
    ...(timing !== undefined && { timing }),
  };
  writeLog(memoryRoot, record);
  return { ...(output !== undefined && { output }), record };
}
