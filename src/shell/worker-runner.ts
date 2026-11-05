import { Worker } from 'node:worker_threads';
import { pathToFileURL } from 'node:url';
import type { HandlerContext, HandlerRef } from './types.js';

/**
 * 在 worker 內載入處理函式模組並執行。以內嵌腳本建立 worker，
 * 不依賴 worker 腳本檔的位置（src 與 dist 皆可用）。
 */
const WORKER_SOURCE = `
const { parentPort, workerData } = require('node:worker_threads');
import(workerData.moduleUrl)
  .then(async (mod) => {
    parentPort.postMessage({ stage: 'loaded' });
    const fn = mod.default;
    if (typeof fn !== 'function') throw new Error('處理函式模組沒有 default export 函式');
    const result = await fn(workerData.ctx);
    parentPort.postMessage({ ok: true, result });
  })
  .catch((err) => {
    parentPort.postMessage({ ok: false, error: String((err && err.stack) || err) });
  });
`;

export const WORKER_HEAP_MB = 256;

/** worker 各階段完成的時間點，皆為呼叫 runInWorker 起算的毫秒數。 */
export interface WorkerTiming {
  online_ms: number;
  module_loaded_ms: number;
  done_ms: number;
}

export type WorkerOutcome =
  | { kind: 'ok'; result: unknown; timing: WorkerTiming }
  | { kind: 'error'; reason: string }
  /** `detail` 說明逾時當下停在哪個階段與各階段耗時。 */
  | { kind: 'timeout'; detail: string };

type Stage = 'spawning' | 'loading' | 'running';

const STAGE_LABEL: Record<Stage, string> = {
  spawning: 'worker 執行緒尚未上線',
  loading: 'worker 已上線，處理函式模組尚未載入完成',
  running: '模組已載入，處理函式執行中',
};

function toUrl(ref: HandlerRef): string {
  if (ref instanceof URL) return ref.href;
  return /^file:/i.test(ref) ? ref : pathToFileURL(ref).href;
}

/** 執行處理函式；崩潰、丟例外或超過 `timeoutMs` 都轉成對應結果，不丟例外。 */
export function runInWorker(ref: HandlerRef, ctx: HandlerContext, timeoutMs: number): Promise<WorkerOutcome> {
  if (timeoutMs <= 0) return Promise.resolve({ kind: 'timeout', detail: '時限在啟動 worker 前已用完' });
  return new Promise((resolve) => {
    let settled = false;
    let worker: Worker | undefined;
    const t0 = Date.now();
    let stage: Stage = 'spawning';
    const marks: string[] = [];
    const at: Partial<Record<Stage, number>> = {};
    const advance = (next: Stage, label: string) => {
      stage = next;
      at[next] = Date.now() - t0;
      marks.push(`${label} +${at[next]} ms`);
    };
    const timeoutDetail = () => `${STAGE_LABEL[stage]}（已等 ${Date.now() - t0} ms${marks.length > 0 ? `；${marks.join('，')}` : ''}）`;
    const finish = (outcome: WorkerOutcome) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      void worker?.terminate().catch(() => undefined);
      resolve(outcome);
    };
    const timer = setTimeout(() => finish({ kind: 'timeout', detail: timeoutDetail() }), timeoutMs);
    try {
      worker = new Worker(WORKER_SOURCE, {
        eval: true,
        workerData: { moduleUrl: toUrl(ref), ctx },
        // 記憶體失控時讓 worker 及早以 error 結束，而不是拖到逾時後仍卡住行程結束
        resourceLimits: { maxOldGenerationSizeMb: WORKER_HEAP_MB },
        stdout: true, // 處理函式不得寫 stdout；萬一寫了也不混進 hook 輸出
        stderr: true,
      });
    } catch (err) {
      finish({ kind: 'error', reason: `無法啟動 worker：${String(err)}` });
      return;
    }
    worker.stdout.resume();
    worker.stderr.resume();
    worker.on('online', () => advance('loading', '上線'));
    worker.on('message', (msg: { stage?: 'loaded'; ok?: boolean; result?: unknown; error?: string }) => {
      if (msg.stage === 'loaded') {
        advance('running', '模組載入完成');
        return;
      }
      if (!msg.ok) {
        finish({ kind: 'error', reason: msg.error ?? '未知錯誤' });
        return;
      }
      const done = Date.now() - t0;
      finish({
        kind: 'ok',
        result: msg.result,
        timing: { online_ms: at.loading ?? done, module_loaded_ms: at.running ?? done, done_ms: done },
      });
    });
    worker.on('error', (err) => finish({ kind: 'error', reason: `worker 崩潰：${err.stack ?? String(err)}` }));
    worker.on('exit', (code) => finish({ kind: 'error', reason: `worker 未回傳結果即結束（exit code ${code}）` }));
  });
}
