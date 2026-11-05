/** 一條記憶條目：帶來源標籤的頂層列表項目連同其下所有子項。 */
export interface Entry {
  /** 以「檔案＋正規化內容」算出的識別；內容改過即為新條目。 */
  id: string;
  /** 所屬檔案，相對記憶庫根目錄、以 `/` 分隔。 */
  file: string;
  /** 所在的二級標題文字；檔案開頭、二級標題之前的條目為 null。 */
  heading: string | null;
  /** 所在二級標題對應的任務類型（表格中的名稱）；不在任務類型標題下為 null。 */
  taskType: string | null;
  /** 條目原文（含列表符號與子項）。 */
  text: string;
}

export interface MemoryFile {
  /** 相對記憶庫根目錄、以 `/` 分隔。 */
  path: string;
  /** frontmatter 的 `name`。 */
  name: string;
  /** 顯示與名稱比對用：資料夾型 `_index.md` 為資料夾名，其餘同 `name`。 */
  displayName: string;
  description: string;
  /** 資料夾型的子檔一律為空（設了也忽略）。 */
  aliases: string[];
  /** 資料夾型的子檔一律為空（設了也忽略）。 */
  repos: string[];
  version: string | null;
  /** 所屬資料夾型 areas 的資料夾名（`_index.md` 與子檔皆有）；不在資料夾內為 null。子檔的 name 不參與比對。 */
  folder: string | null;
  /** 是否為資料夾型 `areas/<name>/_index.md`，代表整個資料夾。 */
  isFolderIndex: boolean;
  entries: Entry[];
}

export interface TaskType {
  name: string;
  keywords: string[];
}

export interface Memory {
  files: MemoryFile[];
  /** 任務類型表格；`AGENTS.md` 讀不到或找不到表格時為 null（解析失敗）。 */
  taskTypes: TaskType[] | null;
  /** `AGENTS.md`「讀取通則」一節的內容；找不到時為 null。 */
  readingRules: string | null;
  /** 局部錯誤的提醒，供寫入注入紀錄。 */
  notes: string[];
}
