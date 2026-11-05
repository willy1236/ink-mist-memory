import type { Entry, Memory } from '../memory/index.js';
import type { HandlerContext } from '../shell/types.js';

/** 訊號的比對結果：只有條目時可直接回傳陣列；要寫注入紀錄的提醒時回傳物件，管線會在提醒前加上訊號名稱。 */
export type SignalResult = Entry[] | { entries: Entry[]; notes?: string[] };

/**
 * 比對訊號。每個訊號一個檔，放在 `signals/`，以 default export 提供，由管線自動載入。
 * `level` 越小優先序越高：工作目錄 1、名稱與 aliases 2、任務類型 3。
 */
export interface Signal {
  /** 寫進注入紀錄的命中訊號名稱。 */
  name: string;
  level: number;
  /** 回傳命中的條目與提醒；不得有副作用。 */
  match(ctx: HandlerContext, memory: Memory): SignalResult;
}
