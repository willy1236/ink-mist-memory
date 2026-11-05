#!/usr/bin/env node
/**
 * hook 入口：`node dist/hook.js --memory-root <路徑> [--platform <平台>]`，從 stdin 讀 hook JSON，
 * 由平台轉接層轉成核心事件後分派處理函式。記憶庫路徑也可改用環境變數 `INK_MIST_MEMORY_ROOT`，
 * 未指定平台時為 Claude Code。一律以 exit code 0 結束。
 */
import { performance } from 'node:perf_hooks';
import { handlers } from './handlers/registry.js';
import { DEFAULT_PLATFORM, findPlatform, PLATFORMS } from './platforms/index.js';
import { parseMemoryRoot, parsePlatformName } from './shell/cli.js';
import { createFailAndExit } from './shell/fail.js';
import { writeLog } from './shell/log.js';
import { runHook, TIMEOUT_MS } from './shell/run-hook.js';

/**
 * 外殼自身卡住時的最後防線：在 3 秒前這麼久強制輸出失敗通知。
 * `performance.timeOrigin` 不含行程建立的約 50 ms，一併算進預留。
 */
const WATCHDOG_MARGIN_MS = 100;
/** 測試用：以 JSON `{ "<核心事件>": "<模組路徑>" }` 覆寫處理函式表。 */
const HANDLERS_ENV = 'INK_MIST_HANDLERS';

const startedAt = performance.timeOrigin;

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks).toString('utf8');
}

const argv = process.argv.slice(2);
const memoryRoot = parseMemoryRoot(argv);
const platformName = parsePlatformName(argv);
const found = platformName === undefined ? DEFAULT_PLATFORM : findPlatform(platformName);
// 平台名稱打錯時仍要輸出失敗通知，以預設平台的格式輸出
const platform = found ?? DEFAULT_PLATFORM;
let raw: Record<string, unknown> = {};
let outputStarted = false;

function write(text: string): Promise<void> {
  outputStarted = true;
  return new Promise((resolve, reject) => {
    process.stdout.write(text, (err) => (err ? reject(err) : resolve()));
  });
}

const failAndExit = createFailAndExit({
  memoryRoot,
  startedAt,
  platform,
  current: () => ({ raw, outputStarted }),
  writeLog: (record) => {
    if (memoryRoot !== undefined) writeLog(memoryRoot, record);
  },
  writeOutput: (text, done) => {
    outputStarted = true;
    process.stdout.write(text, done);
  },
  exit: () => process.exit(0),
});

/** 外殼目前進行到哪一步，供 watchdog 觸發時說明卡在哪。 */
let shellStage = '讀取 stdin';

const watchdog = setTimeout(
  () => failAndExit(`外殼逾時（超過 3 秒）：停在${shellStage}`),
  Math.max(0, startedAt + TIMEOUT_MS - WATCHDOG_MARGIN_MS - Date.now()),
);
watchdog.unref();

async function main(): Promise<void> {
  try {
    const text = await readStdin();
    shellStage = '解析 hook 輸入';
    const parsed: unknown = JSON.parse(text);
    if (typeof parsed !== 'object' || parsed === null) throw new Error('hook 輸入不是 JSON 物件');
    raw = parsed as Record<string, unknown>;
    if (memoryRoot === undefined) throw new Error('沒有設定記憶庫路徑');
    if (!found) {
      throw new Error(`不支援的平台 ${platformName}，可用：${PLATFORMS.map((p) => p.name).join('、')}`);
    }
    const read = platform.readInput(raw);
    if (read.nativeEvent === undefined) throw new Error('hook 輸入缺事件名稱');
    const input = { ...read, cwd: read.cwd === '' ? process.cwd() : read.cwd };
    shellStage = '外殼流程（處理函式之外：重置狀態、組字、輸出或寫紀錄）';
    const override = process.env[HANDLERS_ENV];
    const table = override ? (JSON.parse(override) as Record<string, string>) : handlers;
    const handler = input.event === undefined ? undefined : table[input.event];
    await runHook(input, handler, { memoryRoot, startedAt, write, platform });
    process.exit(0);
  } catch (err) {
    failAndExit(`外殼錯誤：${err instanceof Error ? err.message : String(err)}`);
  }
}

process.on('uncaughtException', (err) => failAndExit(`外殼錯誤：${err.message}`));
void main();
