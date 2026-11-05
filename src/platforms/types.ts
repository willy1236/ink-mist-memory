import type { HookInput } from '../shell/types.js';

/**
 * 一個 agent 平台的 hook 轉接層：把該平台的 hook 輸入轉成核心事件，把注入內容包成該平台要的輸出。
 * 比對、去重、截斷、逾時與失敗處理都在核心，轉接層只管格式。
 */
export interface Platform {
  /** `--platform` 的值。 */
  name: string;
  /** 該平台單次 hook 注入的字元上限。 */
  maxChars: number;
  /**
   * 讀取 hook 輸入（已 JSON.parse 的物件）。寬鬆處理：欄位缺漏時給預設值、不丟例外，
   * 外殼層級失敗時也用它取欄位寫紀錄。缺事件名稱時 `nativeEvent` 為 undefined；
   * 事件不在核心支援範圍時 `event` 為 undefined。
   */
  readInput(raw: Record<string, unknown>): HookInput;
  /** 把要注入給 agent 的文字包成該平台 hook 的 stdout 輸出。 */
  formatOutput(input: HookInput, context: string): string;
}
