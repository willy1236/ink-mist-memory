/** 核心處理的事件，與平台無關；各平台的原生事件名由轉接層對應過來。 */
export type CoreEvent = 'session-start' | 'prompt-submit';

/** 從 stdin 讀到、由平台轉接層正規化過的 hook 輸入。 */
export interface HookInput {
  /** 對應的核心事件；平台事件不在核心支援範圍時為 undefined。 */
  event?: CoreEvent;
  /** 平台原生的事件名稱，寫進紀錄與輸出；輸入缺事件名稱時為 undefined。 */
  nativeEvent?: string;
  sessionId: string;
  cwd: string;
  prompt?: string;
  /** session 開始的來源；`resume` 代表接續完整對話，去重狀態延續。 */
  source?: string;
}

/** 一條要注入的記憶條目。`signal` 為命中訊號名稱。 */
export interface InjectedEntry {
  id: string;
  file: string;
  text: string;
  signal: string;
}

/** 處理函式看得到的 session 狀態（唯讀）。 */
export interface ReadonlySessionState {
  readonly injectedIds: readonly string[];
  readonly indexInjected: boolean;
}

/** 處理函式的輸入。 */
export interface HandlerContext {
  sessionId: string;
  cwd: string;
  prompt?: string;
  source?: string;
  memoryRoot: string;
  state: ReadonlySessionState;
}

/**
 * 處理函式的輸出。`candidates` 已依取捨順序排好。
 * 送出提示時 `sections`（精簡索引）與 `candidates` 應互斥：兩者同時出現時，
 * 單獨放得下、加上 sections 就放不下的候選會每次都擋住後面的條目，外殼會在紀錄寫提醒。
 */
export interface HandlerResult {
  sections: string[];
  candidates: InjectedEntry[];
  isIndex: boolean;
  notes: string[];
  /** 有值時外殼在輸出內容後附失敗通知（部分成功）。 */
  failed?: string;
}

/** 處理函式：在 worker 內執行，不得寫 stdout，也不得寫去重狀態。 */
export type Handler = (ctx: HandlerContext) => HandlerResult | Promise<HandlerResult>;

/**
 * 處理函式所在的模組（檔案路徑或 file URL），模組以 default export 提供 {@link Handler}。
 * 處理函式要在 worker 中執行，因此以模組位置而非函式本身傳入。
 */
export type HandlerRef = string | URL;
