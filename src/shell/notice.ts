import path from 'node:path';

import { LOG_DIR_NAME } from './log.js';

function posix(...parts: string[]): string {
  return path.resolve(...parts).replaceAll('\\', '/');
}

/**
 * 注入失敗時給 agent 的固定通知，指向舊版讀取規則檔與可查失敗原因的日誌目錄（絕對路徑）。
 * 沒有設定記憶庫路徑時無從指向，改為說明沒有注入記憶與該怎麼設定。
 */
export function failureNotice(memoryRoot: string | undefined): string {
  if (memoryRoot === undefined) {
    return (
      '記憶自動注入失敗：沒有設定記憶庫路徑（hook 指令的 --memory-root 或環境變數 INK_MIST_MEMORY_ROOT），' +
      '這次沒有注入任何記憶。請在回覆中提一句「記憶庫路徑未設定」。'
    );
  }
  const legacy = posix(memoryRoot, 'AGENTS.legacy-read.md');
  const logDir = posix(memoryRoot, LOG_DIR_NAME);
  return (
    `記憶自動注入失敗：請改照 ${legacy} 自行讀記憶，並在回覆中提一句「這次記憶自動注入失敗」。` +
    `具體失敗原因可至 ${logDir} 搜尋，使用者問起原因時再去查。`
  );
}
