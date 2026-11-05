# 墨嵐記憶自動注入 任務拆解

規格書：[docs/specs/memory-injection.md](../specs/memory-injection.md)

## 現況與前提

- 技術棧：TypeScript on Node.js，pnpm 管理套件，ESLint（typescript-eslint）、vitest。比對器編譯成 JS，由 hook 以 `node` 直接執行，不經 pnpm 啟動以壓低啟動時間。
- 既有相關機制：
  - 記憶庫 `~/70_Memory/`：markdown 檔加 YAML frontmatter，規則在 `AGENTS.md`；Syncthing 同步、Obsidian 編輯，不是 git repo。
  - Claude Code 全域設定 `~/.claude/settings.json` 已有兩組 `SessionStart` hook（herdr-agent-state、impeccable）與一組 `PostToolUse` hook，新 hook 要並存不覆蓋。
  - Claude Code 全域指示 `~/.claude/CLAUDE.md` 內有「墨嵐-記憶模組」區塊，內容同 `70_Memory/use_with_agent.md`。
  - Claude Code hook：`SessionStart` 的 `source` 有 `startup`、`resume`、`clear`、`compact`、`fork`；hook 輸入含 `session_id`、`cwd`，`UserPromptSubmit` 另含 `prompt`；`additionalContext` 與 stdout 上限 10,000 字元。
  - session 紀錄：Claude Code 在 `~/.claude/projects/`，Codex 在 `~/.codex/sessions/`。
- 這次會動到的既有部位：
  - `~/.claude/settings.json`（新增 `SessionStart`、`UserPromptSubmit` hook）
  - `~/.claude/CLAUDE.md` 的墨嵐區塊
  - `70_Memory/` 的 `AGENTS.md`、`use_with_agent.md` 與全部記憶檔
  - 其他 agent 的全域指示：Codex（`~/.codex/AGENTS.md`，目前為空檔）、Copilot、pi、Antigravity（設定在 `~/.gemini/` 下）目前都沒有墨嵐指示，切換時是新增；Claude 桌面 app 為介面設定
- 已定案的技術前提：
  - 第一版只接 Claude Code；比對邏輯只有一份，各 agent 只接一層薄 hook；之後的 MCP 入口放同一個 repo。
  - 不用 embedding 或本地 AI。
  - 比對器程式放 `~/github/ink-mist-memory`。
  - 記憶庫主副本放在 `~/work/70_Memory_next/`，在 Syncthing 與 Obsidian 範圍外；T-09 的兩份副本與 T-10 的測試組放在 `~/work/` 下的同層資料夾。
  - `history/`、`reports/` 不在整理範圍內。
  - 語言由使用者交給拆卡者決定，選 TypeScript：使用者偏好 TypeScript；之後接 pi 時 extension 也是 TypeScript，可直接引用核心。

## 實作順序總覽

| # | 卡號 | 標題 | 依賴 | 並行組 | 備註 |
|---|---|---|---|---|---|
| 1 | T-01 | [共用][地基] hook 執行框架：提供逾時、失敗通知、注入紀錄、輸出截斷與 session 狀態 | 無 | A | 含 repo 初始化；T-03～T-06 依賴 |
| 2 | T-07 | 新版 AGENTS.md：agent 照同一份讀取通則、寫入標準與任務類型表做事 | 無 | A | 只在記憶庫副本上做 |
| 3 | T-02 | [共用] 記憶庫解析：提供記憶檔、條目、任務類型標題與表格的結構化讀取 | T-01 | B | T-03～T-06 依賴 |
| 4 | T-08 | 既有記憶整理：記憶庫內容符合新標準，交使用者審 | T-07 | B | 只在記憶庫副本上做 |
| 5 | T-03 | 新開 session 時，agent 自動拿到必載記憶與讀取通則 | T-01、T-02 | — | 骨架切片 |
| 6 | T-04 | 在專案 repo 內送出提示時，agent 自動拿到該專案的記憶條目 | T-03 | — | 建立送出提示的整條管線 |
| 7 | T-05 | 提示提到名稱或 alias 時，agent 自動拿到該檔的記憶條目 | T-04 | C | |
| 8 | T-06 | 提示含任務類型關鍵字時，agent 自動拿到該類規範 | T-04 | C | |
| 9 | T-09 | 寫法一致驗證：Claude Code 與 Codex 寫同一批事實，位置與標籤一致 | T-08 | C | 在另兩份副本上做 |
| 10 | T-10 | 固定測試組通過：過去漏讀記憶的提示，改版後 agent 一開始就照做 | T-05、T-06、T-09 | — | |
| 11 | T-11 | 正式切換：所有 agent 同時改用新版記憶與注入 | T-09、T-10 | — | 含備份與回滾 |

並行組 A：T-01 動 repo，T-07 動記憶庫副本，互不重疊。並行組 B：T-02 動 repo，T-08 動記憶庫副本。並行組 C：T-05、T-06 各自在 `signals/` 新增一個檔，不改共用程式；T-09 只動另外兩份副本，不碰 repo 與主副本。

## 任務卡

### T-01 [共用][地基] hook 執行框架：提供逾時、失敗通知、注入紀錄、輸出截斷與 session 狀態

**使用者價值**：T-03～T-06 都要逾時、失敗通知、紀錄、截斷與 session 狀態。集中在一處，兩條 hook 路徑的失敗行為與紀錄格式才會一致，並行開發時也不會同時改同一段。

**範圍**
- 包含：repo 初始化（pnpm、TypeScript、ESLint、vitest、build script）；hook 入口的共用外殼；注入紀錄；session 狀態存取。
- 不包含：任何比對邏輯（T-03～T-06）；記憶檔解析（T-02）；把 hook 加進全域 `~/.claude/settings.json`（T-11）。

**驗收條件**
- [x] `pnpm build` 產出可用 `node` 直接執行的入口；`pnpm test`、`pnpm lint` 可跑。
- [x] 處理函式在 3 秒內回傳時，輸出其注入內容；3 秒從入口被呼叫起算，含程式啟動。
- [x] 處理函式丟例外、讓子流程崩潰或超過 3 秒時，輸出失敗通知並寫一筆含失敗原因的紀錄。
- [x] 所有情況都以 exit code 0 結束；注入內容與失敗通知一律以 JSON 的 `hookSpecificOutput.additionalContext` 輸出，因為 Claude Code 只在 exit 0 時把輸出加進 context。
- [x] 送出提示時，外殼依處理函式回傳的候選順序截到 30 條與 10,000 字元以內；session 開始的內容不截斷，超過 10,000 字元時只寫提醒。
- [x] 只有在確認輸出完成且未逾時之後，才把實際輸出的條目記進去重狀態；逾時或被截掉的條目不記。
- [x] 每次呼叫寫一筆紀錄到 `<記憶庫>/_injection-log/`；寫紀錄失敗時注入照常輸出。
- [x] 每次呼叫時清除超過 30 天的紀錄。
- [x] session 狀態依 `session_id` 分開保存；兩個 session 並行讀寫互不影響；可對單一 session 重置；超過 30 天未更新的狀態檔一併清除。
- [x] `SessionStart` 時，父行程在啟動子流程之前先重置該 session 的狀態；子流程之後崩潰或逾時也不影響重置結果。
- [x] 記憶庫路徑由命令列參數 `--memory-root <路徑>` 指定，未指定時預設 `~/70_Memory`。

**實作設計**
- 後端：
  - 入口：讀 stdin 的 hook JSON，依其中的 `hook_event_name` 分派給處理函式；命令列只帶 `--memory-root`，不帶子命令。實際比對放在子行程或 worker 執行，父行程計時；子流程崩潰或逾時，父行程仍能輸出失敗通知並寫紀錄。
  - 失敗通知固定一段文字：注入失敗，請改照 `<memoryRoot>/AGENTS.legacy-read.md`（以絕對路徑組出）自行讀記憶，並在回覆提一句注入失敗。
  - 執行順序（父行程）：`SessionStart` 先重置 session 狀態 → 啟動子流程執行處理函式 → 收到排好序的候選 → 截到條數與字元上限 → 輸出 → 確認未逾時後才記去重 → 寫紀錄。處理函式不得寫入去重狀態。
  - 組字與截斷：由外殼把每條組成「所屬檔案開頭、接條目原文（可多行）」的文字，以組好的文字長度計數；預留失敗通知的長度，依候選順序逐條累加到條數上限或上限字元為止，回傳實際採用與被捨棄的條目。
  - 注入紀錄：每日一個 JSONL 檔，欄位為時間、事件、`session_id`、`cwd`、提示、注入條目與其命中訊號、提醒、失敗原因。
  - session 狀態：每個 `session_id` 一個小檔，放在記憶庫外的本機暫存目錄（如 `%LOCALAPPDATA%/ink-mist-memory/sessions/`），內容為已注入條目識別集合與索引已注入旗標。規格「session 開始崩潰時由下一次提示補做重置」由「父行程在啟動子流程前先重置」滿足，不另設待重置標記。
- 介面：
  - `runHook(event, handler)`：handler 收到 `{ sessionId, cwd, prompt?, source?, memoryRoot, state: { injectedIds, indexInjected } }`（state 唯讀），回傳 `{ sections: string[], candidates: InjectedEntry[], isIndex: boolean, notes: string[], failed?: string }`。`failed` 有值時，外殼在輸出內容後附失敗通知，用於部分成功。外殼負責計時、截斷、輸出、記去重、紀錄。
  - `InjectedEntry`：`{ id, file, text, signal }`，`signal` 為命中訊號名稱；`candidates` 已依取捨順序排好。
  - `fitWithinLimit(header, entries, maxCount, maxChars = 10000, reserve)` → `{ text, used, dropped }`：`header` 為條目前的固定說明文字，`reserve` 為預留給失敗通知的長度。
  - `sessionState(sessionId)`：`get()`、`markInjected(ids)`、`markIndexInjected()`、`reset()`；寫入方法只由外殼呼叫。
  - 錯誤行為：外殼本身不得丟例外到 hook 呼叫端；任何錯誤都轉成失敗通知。
  - 呼叫端須知：處理函式不得寫 stdout；session 狀態檔的寫入要能承受同一 session 兩次 hook 先後完成。
- 邊界：記憶庫路徑由 `--memory-root` 注入，紀錄目錄跟著記憶庫，session 狀態目錄可由環境變數覆寫，測試時都指向暫存資料夾；不另開 port。

**依賴**：無

**風險 / 實作注意**：Windows 上 `node` 啟動約數十到一百多毫秒，子行程再加一次；實測總耗時，必要時改用 worker thread。`~/.claude/settings.json` 的 hook `timeout` 要設得比 3 秒長，讓外殼自己的逾時先生效。

**進度**：全部完成（2026-11-06）
- commit：87e20c0..ec1b24e
- 實作決定：子流程用 worker_threads（實測含 node 啟動約 80～150 ms）；`runHook(input, handlerModule, opts)` 以模組位置傳處理函式（模組 default export），事件對應登記在 `src/handlers/registry.ts`；處理函式卡住時 worker 在 3 秒前 200 ms 逾時，另有入口 watchdog 在 3 秒前 100 ms 強制輸出失敗通知；worker heap 限 256 MB；單條就超過 10,000 字元的候選跳過並寫提醒，只是這次放不下的照取捨順序停止；送出提示時固定段落與候選應互斥，同時出現時寫提醒；環境變數 `INK_MIST_HANDLERS` 供 e2e 測試覆寫處理函式表。
- 已知限制：watchdog 在內容已輸出後才觸發時，該筆紀錄不含已注入的條目；處理函式造成 node 原生崩潰時會連父行程一起倒、不會有失敗通知。
- 2026-11-08 載入逾時修正：正式使用後一天 179 次注入有 14 次逾時，13 次停在「處理函式模組尚未載入完成」。原因是處理函式在每次 hook 的新 worker 冷載入約 215 個模組檔（204 個在 node_modules），閒置時就要 340 ms，磁碟忙時拉長到 2.5 s 以上。
  - 決定：build 在 tsc、prune 之後以 esbuild 把 `dist/handlers/` 的處理函式與 `dist/match/signals/` 的訊號檔各自原地打包成單檔（`scripts/bundle-handlers.mjs`），全部成功才覆蓋，失敗時 dist 維持 tsc 版本。打包後實測載入約 30 ms、hook 總耗時約 300 ms。
  - 訊號目錄改寫成 `new URL('../match/signals/', import.meta.url)`，未打包與打包進 handlers 都解析到 `dist/match/signals/`；訊號檔改直接 import `memory/normalize.js`，不經 `memory/index.js` 拉進 markdown 解析相依。
  - 不採用：worker 常駐（每次 hook 是新行程，要常駐得另做 daemon）；放寬 3 秒（規格要求）。
  - 注入紀錄成功時加 `timing` 欄位：呼叫 worker、worker 上線、模組載入完成、處理函式回傳各自從入口起算的 ms，用來看預算花在哪段。
  - `dist` 不進 git，hook 直接跑本 repo 的 `dist/hook.js`；合併後要在本 repo 跑 `pnpm build` 才生效。

### T-07 新版 AGENTS.md：agent 照同一份讀取通則、寫入標準與任務類型表做事

**使用者價值**：各 agent 讀寫記憶時照同一份清楚的規則，寫法一致，也有讀取通則可以注入。

**範圍**
- 包含：建立記憶庫主副本 `~/work/70_Memory_next/`；在副本上產出新版 `AGENTS.md`、`AGENTS.legacy-read.md`、`use_with_agent.claude-code.md`、`use_with_agent.others.md`，刪除副本中的 `use_with_agent.md`。
- 不包含：既有記憶檔的內容整理（T-08）；套用到正式庫與各 agent（T-11）。

**驗收條件**
- [x] 副本中的 `AGENTS.md` 有「讀取通則」一節，涵蓋規格〈Session 開始〉列的五點；該節為二級標題，去掉前置編號後的文字恰為「讀取通則」，與 T-02 的擷取規則一致。
- [x] 〈寫入標準〉四條新規則各附好壞範例；「明確排除兩類」每類各一組。
- [x] §4 的外部資料 `[ref]` 規則已改寫成規格的 repo 入口規則；frontmatter 規則加入 `repos` 欄位，`aliases` 開放給資料夾型 `areas/` 子檔以外的所有檔案。
- [x] 任務類型表格有「任務類型」「提示關鍵字」兩欄，初稿從 `conduct.md`、`preferences.md`、`topics/dev-toolchain.md` 歸納，經使用者核准；標題寫法 `## 任務：<任務類型>` 與新類型的提議流程寫明。
- [x] §1 結構樹標示 `_injection-log/`、`AGENTS.legacy-read.md`、兩份片段檔不是記憶。
- [x] `AGENTS.legacy-read.md` 收錄現行 §0、§6 全文，並註明掃描時排除上述非記憶檔；`AGENTS.md` 開頭一句指向它。
- [x] 兩份片段檔內容與規格〈各 agent 第一版的全域指示〉一表一致。
- [x] 以上以相對現行版本的 diff 交使用者審過。

**實作設計**
- 資料：記憶庫副本內的上述檔案；正式庫不動。建立副本時在副本內 `git init`，以 `.gitignore` 排除 `_injection-log/`，先 commit 原始狀態作為基準，之後的 diff 與 T-11 的合併都以此為基準。
- 後端：無程式碼。任務類型表格格式要與 T-02 的表格解析一致：兩欄表頭、關鍵字以頓號分隔。

**依賴**：無

**風險 / 實作注意**：好壞範例的 `[stated]` 等標籤若寫成列表項目，T-02 不會解析，因為 `AGENTS.md` 不在比對範圍內；仍建議範例放在 code block 內，避免舊版讀取規則的 agent 誤讀成事實。

**進度**：全部完成（2026-11-06）
- 副本 `~/work/70_Memory_next/` 的 commit：2173360（基準）、6e61946（本卡）；審查清單在 `~/work/70_Memory_next_review/checklist.md`。
- 實作決定：「讀取通則」放 §0，§5 維持併發，任務類型表另立 §6；讀取通則另寫入失敗通知的例外與 `[ref]` 用法；任務類型初稿 8 類（commit、發版、部署、專案設定、測試、資料庫、主機操作、文案），使用者已核准；關鍵字不收 `PR`、`DB`、`test` 這類會被子字串誤中的短字，規則寫進 §6；frontmatter 一節加 aliases 不用短字的提醒；資料夾升級步驟加「aliases、repos 搬到 `_index.md`」。


### T-02 [共用] 記憶庫解析：提供記憶檔、條目、任務類型標題與表格的結構化讀取

**使用者價值**：T-03～T-06 都要讀記憶檔、切條目、認任務類型標題。集中在一處，條目定義與比對範圍只有一份實作。

**範圍**
- 包含：比對範圍內檔案的列舉；frontmatter、條目、標題的解析；任務類型表格解析；`AGENTS.md`「讀取通則」一節的擷取；局部錯誤的提醒。
- 不包含：任何比對或取捨（T-04～T-06）。

**驗收條件**
- [x] 列舉時排除 `AGENTS.md`、兩份片段檔、`AGENTS.legacy-read.md`、`history/`、`reports/`、`_injection-log/`、`preferences.md`、`conduct.md`。
- [x] 條目 = 帶 `[stated]`／`[inferred]`／`[ref]` 的頂層列表項目連同其下所有子項；子項不單獨成條目；表格與段落文字不算條目。
- [x] 每條條目帶所屬檔案、所在的二級標題與任務類型（含巢狀標題下的條目），以及以「檔案＋正規化內容」算出的識別。
- [x] 資料夾型 `areas/<name>/` 以資料夾名加 `_index.md` 的 aliases、`repos` 代表整個資料夾；子檔設了 `aliases`、`repos` 時忽略並產生提醒。
- [x] frontmatter 無法解析或缺 `name` 的檔跳過並產生提醒；缺 `version` 的檔照常回傳，`version` 為空。
- [x] 「讀取通則」以「二級標題去掉前置編號後等於『讀取通則』」擷取該節內容；任務類型表格取 `AGENTS.md` 中第一個表頭含「任務類型」與「提示關鍵字」兩欄的表格。
- [x] 任務類型表格缺兩欄表頭時回傳「解析失敗」與提醒；帶「任務：」前綴但不在表內的二級標題產生提醒；前綴與類型名比對去除前後空白、不分大小寫與全半形。
- [x] 以目前的 `70_Memory/` 全庫解析，在 T-01 的 3 秒預算內完成，耗時寫入測試輸出。

**實作設計**
- 後端：純函式模組，輸入記憶庫路徑，輸出結構化資料；markdown 用 remark 系列套件解析列表與標題，frontmatter 用 YAML 解析。
- 介面：
  - `loadMemory(root)` → `{ files: MemoryFile[], taskTypes: TaskType[] | null, readingRules: string | null, notes: string[] }`。
  - `MemoryFile`：`{ path, name, displayName, description, aliases, repos, version, isFolderIndex, entries: Entry[] }`。
  - `Entry`：`{ id, file, heading, taskType, text }`。
  - `TaskType`：`{ name, keywords: string[] }`。
  - `normalize(s)`：去前後空白、轉小寫、全形轉半形，供各比對訊號共用。
  - 錯誤行為：單一檔的錯誤只進 `notes`，不丟例外；記憶庫路徑不存在時丟例外，由 T-01 外殼轉成失敗通知。

**依賴**：T-01（repo 骨架與設定）

**風險 / 實作注意**：Obsidian 手改可能產生非標準 markdown；解析失敗以檔為單位跳過，不讓單檔拖垮整庫。

**進度**：全部完成（2026-11-06）
- commit：0763332..ced60ac
- 實作決定：模組在 `src/memory/`，以 `mdast-util-from-markdown`＋GFM 表格擴充解析 markdown、`yaml` 解析 frontmatter；`MemoryFile` 另加 `folder`（所屬資料夾型 areas 的資料夾名），子檔判定集中在解析層；列舉另排除舊片段檔 `use_with_agent.md`（切換時刪除）與以 `.` 開頭的檔案、資料夾；條目以列表項目原始碼判斷來源標籤（`- [ref]: url` 這種會被解析成連結定義的寫法也算），列表內的程式碼區塊不算；條目識別只去行尾與前後空白，不轉小寫、半形；setext 二級標題（文字下一行接 `---`）不算二級標題並寫提醒，條目與讀取通則共用此判斷，setext 一級標題照常；任務類型關鍵字只以頓號切，含逗號或分號時寫提醒。
- 實測：目前的 `70_Memory/` 解析出 44 檔、380 條條目，新行程含模組載入約 550 ms（import 約 370 ms、解析約 160 ms）。現行 `AGENTS.md` 尚無讀取通則與任務類型表格，各產生一則提醒，待 T-07。
- 已知限制：同一檔內容完全相同的兩條條目識別相同；子資料夾讀取權限錯誤會讓整個 `loadMemory` 丟例外；`name` 非字串時提醒寫成「缺 name」；列表符號後空一行再寫的標籤段落、緊接在條目下的無縮排文字（lazy continuation）不會提醒。

### T-08 既有記憶整理：記憶庫內容符合新標準，交使用者審

**使用者價值**：注入出去的每一條都自足、不重複 repo、標籤正確，條目級注入才有意義。

**範圍**
- 包含：在 T-07 的記憶庫副本上整理記憶檔，產出 diff 與逐檔檢查清單。
- 不包含：`history/`、`reports/`，兩者是事後不改寫的快照，維持原樣。
- 不包含：套用到正式庫（T-11）。

**驗收條件**
- [x] repo 已有的內容已刪除，repo 內容不逐條建 `[ref]`，改為每個專案記憶檔一條指向 repo 文件入口的 `[ref]`；資料夾型專案的入口 `[ref]` 放在描述專案整體的子檔，沒有就新建 `overview.md`。
- [x] repo 沒寫的決策與習慣保留。
- [x] 所有事實都是帶來源標籤的頂層列表條目，沒有寫在表格、段落或無標籤父項下。
- [x] 條目自足；同類規範歸到 `## 任務：<類型>` 標題下，必載檔除外。
- [x] 有對應 repo 的 `areas/` 檔與資料夾 `_index.md` 已補 `repos`，沒有的不加。
- [x] 來源標籤錯誤與跨檔講法不一致已修正。
- [x] 以 diff 加逐檔檢查清單交使用者審，經使用者確認。
- [x] 以 T-02 解析整理後的副本，沒有任何提醒。

**實作設計**
- 資料：只動記憶庫副本。逐檔對照所屬 repo 的文件，判斷哪些已有。
- 後端：用 T-02 的 `loadMemory` 對副本跑一次，作為格式自檢；T-02 未完成時先人工檢查，完成後補跑。

**依賴**：T-07（照新版寫入標準與任務類型表整理）；最後一條驗收需 T-02

**風險 / 實作注意**：審查期間正式庫仍會被寫入，切換時由 T-11 重新合併；整理時記下每檔依據的正式庫 `version`。

**進度**：全部完成（2026-11-06）
- 副本 commit：2609aaf、63fc4f3（本卡）；逐檔依據的正式庫 `version` 記在審查清單。T-02 解析整理後的副本：44 檔、255 條（原 380 條），無提醒。
- 實作決定：homelab 的存取規則雖與 homelab-ansible 的 CLAUDE.md 重複仍保留，因為在其他 repo 操作 homelab 時讀不到那份；三個短 alias 換成較長稱呼；`areas/project-c/design.md` 內容都在 repo，刪檔；homelab 新建 `overview.md` 放入口 `[ref]`，project-c 放 `architecture.md`、project-e 放 `project.md`；記憶與 repo 不一致時以 repo 為準並刪記憶。
- 使用者決定：project-d 元件庫的設計來源以記憶為準，記憶加註 repo 的 `PRODUCT.md` 不是現況，repo 先不改；homelab 存取規則保留。


### T-03 新開 session 時，agent 自動拿到必載記憶與讀取通則

**使用者價值**：每個 Claude Code session 一開始就帶著回應偏好、工作紀律與讀取通則，不必靠 agent 記得去讀。

**範圍**
- 包含：`SessionStart` 處理函式；測試用 settings 檔中的 `SessionStart` hook（指向記憶庫副本）。
- 不包含：送出提示的比對（T-04 起）；加進全域設定並指向正式庫（T-11）。

**驗收條件**
- [x] 新開、resume、fork、clear、壓縮後，注入 `preferences.md`、`conduct.md` 全文與讀取通則，並重置該 `session_id` 的去重狀態。
- [x] 其中任一讀不到時，注入讀得到的部分並附失敗通知。
- [x] 程式出錯、崩潰或逾時時注入失敗通知，該 session 的去重狀態仍已重置。
- [x] 三者總長超過 10,000 字元時，注入紀錄中有提醒。
- [ ] 以測試用 settings 啟動的 session 中，使用者既有的 `SessionStart` hook 照常執行；日常（未用測試 settings）的 session 完全不受影響。
- [x] 注入紀錄中有對應的一筆。

**實作設計**
- 後端：處理函式讀兩份必載檔與 T-02 的 `readingRules`，依序組成 `sections`；任一讀不到時照常回傳讀得到的部分並設 `failed`。重置由 T-01 外殼在啟動處理函式前完成。
- 前端：無。agent 在 context 中看到的是注入文字。
- 設定：開發與測試期間 hook 只寫在 repo 內的測試用 settings 檔，以 `claude --settings <該檔>` 啟動測試 session，不動全域 `~/.claude/settings.json`。hook 的 matcher 涵蓋五種 source，`command` 為 `node <repo>/dist/hook.js --memory-root <副本路徑>`，`timeout` 大於 3 秒。

**依賴**：T-01（外殼）、T-02（讀取通則擷取）

**風險 / 實作注意**：開發期間若副本尚未產生讀取通則，視同讀不到，會附失敗通知，屬預期行為；hook 只在測試 session 生效，不影響日常使用。

**進度**：部分完成（2026-11-06），剩「既有 `SessionStart` hook 照常執行」一條未驗證
- commit：a8fa131..312cd6d、1f1bc2c
- 實作決定：`preferences.md`、`conduct.md` 照檔案全文注入（含 frontmatter），各段前加一行說明；讀取通則改由新增的 `loadReadingRules` 只讀 `AGENTS.md`，不列舉記憶檔；測試用 settings 檔為 `settings/claude-test.settings.json`，`timeout` 10 秒。
- 實測：對副本 `70_Memory_next` 的複製品執行約 580 ms，無提醒。
- 未驗證：以測試用 settings 啟動時既有 hook（herdr-agent-state、impeccable）是否照常執行，需實際開 `claude --settings settings/claude-test.settings.json` 確認；使用者決定本卡先不驗。

### T-04 在專案 repo 內送出提示時，agent 自動拿到該專案的記憶條目

**使用者價值**：在專案裡只講一句短提示，agent 也已經帶著該專案的決策與習慣，不會方向錯誤。

**範圍**
- 包含：`UserPromptSubmit` 處理函式；送出提示的完整管線（訊號載入、取捨排序、精簡索引、提醒）；工作目錄訊號；測試用 settings 檔中的 `UserPromptSubmit` hook。
- 不包含：名稱與 alias 訊號（T-05）；任務類型訊號（T-06）。

**驗收條件**
- [x] 工作目錄等於某檔 `repos` 或位於其下時，注入該檔全部條目；以路徑段為界，`D:/github/foobar` 不命中 `D:/github/foo`；路徑比對統一 `/`、不分大小寫。
- [x] 在資料夾型 `areas/` 宣告的 repo 內，注入資料夾內各子檔的條目。
- [x] 每次至多 30 條、總長不超過 10,000 字元；超過時依訊號優先序、檔案 `version` 新到舊（缺 `version` 排最後，相同依路徑字母序）、檔內出現順序取捨；被捨棄的條目之後命中時照常注入。
- [x] 同一 session 已注入的條目不再注入；全都注入過時不注入任何內容；內容改過的條目視為新條目。
- [x] 完全沒命中時注入精簡索引（資料夾型以資料夾名與 `_index.md` 描述列一項），同一 session 只注入一次。
- [x] 提示含 `history/`、`reports/` 檔名時不注入該檔；沒有其他命中時照沒命中規則處理。
- [x] 每條注入附所屬檔案；T-02 的提醒寫進注入紀錄。
- [x] 兩個 session 並行時去重互不影響；session 開始的處理函式崩潰後，同一 session 送出提示時先前注入過的條目會重新注入。

**實作設計**
- 後端：
  - 管線：`loadMemory` → 各訊號產出 `(entry, level)` → 同一條目取最高級 → 依唯讀的 `state.injectedIds` 去掉已注入 → 依三層順序排序 → 回傳 `candidates`；截斷與記去重由 T-01 外殼負責，條數上限 30。無任何命中時，若 `state.indexInjected` 為否，回傳精簡索引並設 `isIndex`。
  - 訊號介面：`Signal = { name, level: number, match(ctx, memory) → Entry[] | { entries: Entry[], notes?: string[] } }`；回傳的 `notes` 由管線加上訊號名稱後寫進注入紀錄。每個訊號一個檔，放在 `signals/` 資料夾，由管線自動載入；本卡建立工作目錄訊號（level 1），T-05、T-06 各新增自己的檔，不改共用清單。
- 前端：無。注入文字的組字由 T-01 外殼負責。
- 設定：只寫在測試用 settings 檔，`command` 為 `node <repo>/dist/hook.js --memory-root <副本路徑>`，與 T-03 相同；全域設定由 T-11 加入。

**依賴**：T-03（骨架與 session 重置流程）

**風險 / 實作注意**：大檔分批注入是規格接受的行為。

**進度**：全部完成（2026-11-06）
- commit：a05538f..dfd49bf、f3736f8..cb28623
- 實作決定：管線在 `src/match/pipeline.ts`，訊號在 `src/match/signals/`（依檔名排序載入、依 level 排序執行），共用的 `expandFolders`、`isUnder` 在 `src/match/files.ts`；單一訊號丟例外或回傳格式錯誤時只寫提醒、其餘訊號照常；精簡索引每項為「名稱（路徑）：描述」；`version` 以 `Date.parse` 比較，無法解析視同缺；build 改為 `noEmitOnError` 加編譯後刪除沒有對應原始碼的舊檔（`scripts/prune-dist.mjs`），避免已刪除的訊號檔殘留在 `dist/` 被自動載入。
- 使用者決定：訊號介面改為可回傳提醒（原卡為只回傳 `Entry[]`），供 T-06 等訊號寫自己的提醒。
- 實測：對副本複製品，在 repo 內與 repo 外各送一次提示約 550～600 ms，無提醒。
- 已知限制：「提示含 `history/`、`reports/` 檔名時不注入」靠 T-02 列舉時排除成立；build 進行中觸發 hook 時，可能在毫秒級的時間窗內讀到新舊混雜的 `dist/`。

### T-05 提示提到名稱或 alias 時，agent 自動拿到該檔的記憶條目

**使用者價值**：不在專案目錄裡也能提到「實驗室主機」「my-bot」就帶出對應記憶。

**範圍**
- 包含：名稱與 aliases 訊號（level 2）。
- 不包含：任務類型（T-06）。

**驗收條件**
- [x] 提示中出現某檔 `name`、資料夾名或任一 `aliases` 時，注入該檔（或整個資料夾）的條目。
- [x] 子字串比對，不分大小寫與全半形。
- [x] 資料夾型子檔的 `name` 與它設的 aliases 不參與比對。
- [x] 同一條目同時被工作目錄命中時，以工作目錄的優先序計。

**實作設計**
- 後端：以 T-02 的 `normalize` 正規化提示與名稱、aliases 後做子字串比對；在 `signals/` 新增一個訊號檔。

**依賴**：T-04（管線與訊號介面）

**風險 / 實作注意**：過短或常見的 alias 會誤中，這是規格接受的風險；注入紀錄已記錄命中訊號名稱，本卡不改紀錄格式。

**進度**：全部完成（2026-11-06）
- commit：71da48d
- 實作決定：訊號在 `src/match/signals/name.ts`；比對詞為 `displayName`（資料夾型 `_index.md` 為資料夾名，其 frontmatter `name` 不參與）加 `aliases`，正規化後為空的詞略過；命中資料夾型時以 `expandFolders` 展開整個資料夾。
- 實測：對副本複製品送「實驗室主機的 inventory 怎麼改」約 740 ms，命中 homelab-server 並因上限捨棄 8 條。
- 已知限制：資料夾缺 `_index.md` 時資料夾名不會命中（解析層已寫提醒）。

### T-06 提示含任務類型關鍵字時，agent 自動拿到該類規範

**使用者價值**：提到 commit、部署等動作時，各檔裡那類任務的規範會一起帶出來，不會做完才發現。

**範圍**
- 包含：任務類型訊號（level 3）。
- 不包含：任務類型表的內容（T-07）。

**驗收條件**
- [x] 提示含某任務類型的任一關鍵字時，注入各檔中該 `## 任務：<類型>` 標題下的條目，含其下巢狀標題的條目。
- [x] 工作目錄不在任何 `repos` 下、提示不含任何名稱或 alias 時，只注入該標題下的條目。
- [x] 關鍵字比對為子字串，不分大小寫與全半形。
- [x] 任務類型表解析失敗時停用本訊號、注入紀錄中有提醒，其餘訊號照常。

**實作設計**
- 後端：讀 T-02 的 `taskTypes` 與各條目的 `taskType`；在 `signals/` 新增一個訊號檔。

**依賴**：T-04（管線與訊號介面）

**進度**：全部完成（2026-11-06）
- commit：b55291e、60c5f7b
- 實作決定：訊號在 `src/match/signals/task-type.ts`，訊號名稱 `task-type`；條目歸屬沿用 T-02 解析出的 `taskType`（含巢狀標題）；多個類型同時命中時都注入；表格解析失敗時訊號只寫「本訊號停用」，原因由解析層的提醒說明，不重複。
- 實測：對副本複製品送「幫我 commit 一下」約 600 ms，命中 4 條。

### T-09 寫法一致驗證：Claude Code 與 Codex 寫同一批事實，位置與標籤一致

**使用者價值**：確認新版寫入標準真的讓不同 agent 寫出一致的記憶。

**範圍**
- 包含：準備兩份記憶庫副本、執行寫入、比對結果；比對不一致時修 T-07 的規則或範例再重跑。
- 不包含：既有記憶的整理（T-08）。

**驗收條件**
- [x] Claude Code 與 Codex 的測試 session 都使用等同切換後版本、路徑指向各自副本的全域指示：Claude Code 以 `CLAUDE_CONFIG_DIR`、Codex 以 `CODEX_HOME` 指向測試用設定目錄，避免依現行全域指示去寫正式庫。
- [x] 兩份副本皆由 T-08 整理後的主副本複製；每次提示都指定寫入的副本路徑，事後確認正式庫與主副本都沒有變動。
- [x] 比對不一致需要修規則時，改在主副本的 `AGENTS.md`，並重走 T-07 的審查。
- [x] 使用者提供約 10 條事實；Claude Code 與 Codex 依新版 `AGENTS.md` 各自寫入一份副本。
- [ ] 每條的寫入位置（檔案加所在二級標題）與來源標籤全部一致。
- [x] 寫法由使用者判定一致。

**實作設計**
- 資料：兩份副本；比對可用 T-02 解析兩份副本後逐條對照位置與標籤，產出差異表給使用者。

**依賴**：T-08（以整理後的記憶為起點）

**進度**：完成（2026-11-06），「位置與標籤全部一致」一條未達成，剩 2 條差異經使用者接受
- 使用者決定：Codex 改用 pi（`openai-codex/gpt-5.6-terra`，以 `--no-context-files --append-system-prompt` 載入測試用全域指示，不動 `~/.pi`）；兩邊都在 herdr pane 以互動模式執行，不用 headless；10 條事實由 agent 產生；比對時只比檔案、任務類型標題與來源標籤，一般二級標題不比；第 2 輪剩下的 2 條差異接受，不再修規則。
- 偏離卡片：Codex 換成 pi；提示中沒有逐次指定副本路徑，改由測試用全域指示把記憶庫路徑指向各自副本。
- 環境：副本 `~/work/70_Memory_t09_claude`、`~/work/70_Memory_t09_pi`；Claude Code 設定目錄 `~/work/t09_claude_config`；pi 指示 `~/work/t09_pi/AGENTS.md`；事實與送出腳本在 `~/work/t09_run/`。兩輪結束後正式庫與主副本的記憶檔都沒有變動。
- 第 1 輪：10 條中 6 條不一致（飲食偏好的標題、homelab 的子檔、遊戲一時狀態沒寫、MIT 放進 `conduct.md`、新專案缺入口 `[ref]`、基本資料拆條），另發現 Claude Code 的 `version` 是估計值。依使用者判定修主副本 `AGENTS.md`，使用者審過，主副本 commit 0c84ece。
- 第 2 輪：8 條一致；剩 homelab 重啟前公告（Claude Code 寫 `access.md`、pi 寫 `practices.md`）與新專案預設 MIT（pi 仍寫進 `conduct.md`）兩條差異。兩邊的 `version` 都是實際 UTC 時間。
- T-11 合併時要帶上主副本的 0c84ece。

### T-10 固定測試組通過：過去漏讀記憶的提示，改版後 agent 一開始就照做

**使用者價值**：用真實出過事的情境證明注入有效，作為切換前的關卡。

**範圍**
- 包含：從 session 紀錄挖題、建立測試組、在副本上執行與判定。
- 不包含：上線後觀察（T-11）。

**驗收條件**
- [ ] agent 搜尋 `~/.claude/projects/` 與 `~/.codex/sessions/`，列出疑似使用者提醒「記憶裡有」的候選對話；使用者認定後還原當時的提示，不足 5 題由使用者補至 5 題。
- [x] 測試 session 的全域指示等同切換後版本：以 `CLAUDE_CONFIG_DIR` 指向測試用設定目錄，其中的 `CLAUDE.md` 換成 `use_with_agent.claude-code.md` 的內容、路徑改指主副本，`settings.json` 只含兩組測試 hook；日常設定不受影響。做法開工時先實測，Claude Code 若需在該目錄重新登入屬預期。
- [x] 每題記下對應工作目錄與預期條目，預期條目以整理後的副本為準，經使用者確認。
- [ ] 每題在新 session、對應工作目錄、作為第一個提示送出時，session 開始加第一個提示的注入包含全部預期條目；命中不到時補 alias 或任務類型標題，併入 T-08 的 diff；新增任務類型照規格先向使用者提議。
- [x] 為測試而補的 alias、標題與新任務類型，交使用者確認後才算定案。
- [ ] 每題跑 3 次，agent 的第一個動作（工具呼叫或回覆，取先出現者）都依循預期條目，由使用者判定；使用者在旁觀察，看到第一個動作後立即中斷 session，每題結束後檢查該 repo 的 `git status` 與主副本沒有非預期改動。

**實作設計**
- 資料：測試組存在主副本旁的資料夾，不進 repo，因為真實提示可能含個人資訊。每題存提示、工作目錄與預期條目；預期條目以「檔案＋條目文字片段」記錄，不用內容雜湊，以免 T-11 合併後失效。
- 後端：注入是否包含預期條目可寫成自動測試：對副本直接呼叫處理函式比對輸出；agent 行為部分由使用者判定。

**依賴**：T-05、T-06（三種訊號都要在）、T-08（預期條目以整理後為準）、T-09（規則修正完成後才定案預期條目，避免兩張卡同時改主副本）

**進度**：完成（2026-11-06），「補至 5 題」「注入包含全部預期條目」「每題跑 3 次」三條未達成，經使用者接受；使用者判定 4 題 agent 行為全部通過
- 挖題：掃 `~/.claude/projects/` 1,069 個、`~/.codex/sessions/` 5 個 session 檔，比對使用者提示的提醒用語與 agent 承認「記憶裡有寫」的回覆，得 6 則候選，Codex 無。
- 使用者決定：收 4 題、不補題（偏離規格的 5 題目標）；提示貼近原句、不要求完全一樣；Q4 接受分批注入。
- 測試組在 `~/work/70_Memory_t10/`：`cases.json` 存提示、工作目錄與預期條目（檔案＋文字片段），`run.mjs` 對記憶庫直接執行 `dist/hook.js`（session 開始＋第一個提示）檢查注入，`node run.mjs [記憶庫路徑]`，預設主副本。
- 自動檢查結果（主副本 0c84ece）：Q1 homelab `docker-ro`、Q2 project-a 發版 release 說明、Q3 不留修改痕跡通過；Q4 對比 homelab 硬體沒過，記為已知限制。
- 已知限制：資料夾型 `areas/` 超過 30 條時，同 `version` 的子檔依路徑字母序取捨，排在後面的子檔（如 `homelab-server/system.md`）第一個提示拿不到；子檔 alias 被忽略、任務類型訊號優先序較低，補 alias 或標題都救不了。Q1 通過也只因 `access.md` 排第一。
- 預期條目與提示經使用者確認；Q2 提示補上 project-a，因原對話靠前文才知道是哪個 repo。
- 測試用設定目錄 `~/work/t10_claude_config/`：`CLAUDE.md` 為全域指示把墨嵐區塊換成 `use_with_agent.claude-code.md`、路徑改指主副本，`settings.json` 同 `settings/claude-test.settings.json`（只含兩組 hook，未設 permission mode，Bash 與寫檔都會先詢問），登入憑證沿用 T-09 設定目錄，`skills` 以 junction 指向 `~/.agents/skills`。各題以 `~/work/70_Memory_t10/agent.ps1 <題號>` 啟動，結束後顯示工作目錄與主副本的 `git status`。
- 執行（herdr pane w1:p6）：Q1 三次第一個碰 docker 的動作都用 `sudo docker-ro`，待使用者判定。第 1 次因測試設定目錄沿用 auto mode，唯讀 ssh 未經詢問就執行，之後在 `settings.json` 加 `permissions.defaultMode: "default"`。
- Q2：原提示 v2.4.1 在 10/27 已正式發布，agent 只回報「已發佈過」，該次不計，提示改為 v2.4.99。改後第 1 次 agent 先跑唯讀檢查，接著 `git tag -a v2.4.99` 並 push，觸發 Release CI；這次 push 很可能是我依使用者授權代按 Enter、沒先讀畫面而批准的。已依使用者同意取消 CI run、刪除遠端與本機 v2.4.99 tag，未產生 release，遠端 tag 回到 v2.4.1 為最新。agent push 後的下一步是等 CI 完成再查 release 內文。條目要求的是 CI 建 draft 後補說明，第一個動作看不出是否依循。
- 使用者決定：Q2 只算第 1 次；Q3、Q4 各跑一次。Q1、Q2 的結果待使用者判定。
- Q3：派 13 個 subagent 逐章整理後要覆寫 `時間軸.md`。檔案內容沒有修改痕跡，修正清單只出現在回覆裡，取消寫檔後檔案未變，待使用者判定。
- Q4：第一個動作是 `ssh homelab` 查 `free -h` 與 `sudo docker-ro stats`，同時查本機記憶體。agent 認得 homelab，沒有因為缺 `system.md` 而卡住，待使用者判定。
- herdr 從 Git Bash 送 `/exit` 會被路徑轉換成 `C:/Program Files/Git/exit`，要加 `MSYS_NO_PATHCONV=1`。
- 執行紀律：代按權限詢問前必須先讀當下畫面、確認是哪個指令；會改到遠端的題目由使用者自己按。
- 開跑前的基準：homelab-ansible、project-a 只有既有未追蹤或 `.obsidian` 改動，project-b 有使用者進行中的修改，主副本只有 `.obsidian/workspace.json`。

### T-11 正式切換：所有 agent 同時改用新版記憶與注入

**使用者價值**：從這張卡起，日常使用的 Claude Code 自動帶著記憶工作，其他 agent 改用舊版讀取規則。

**範圍**
- 包含：備份、合併 diff、套用正式庫、hook 改指正式庫、各 agent 全域指示切換、回滾程序、上線後觀察。
- 不包含：其他 agent 的 hook 接入（後續版本）。

**驗收條件**
- [x] 切換前備份正式記憶庫、`~/.claude/settings.json`、`~/.claude/CLAUDE.md` 與其他 agent 的全域指示。
- [x] 以主副本的基準 commit 為共同祖先，把 T-07、T-08 的變更與最新正式庫三方合併，遇到 `version` 不同依 AGENTS.md §5 處理，合併結果經使用者確認。
- [ ] 同一次操作內完成：套用到正式庫、把兩組 hook 加進全域 `~/.claude/settings.json` 並以 `--memory-root` 指向正式庫、Claude Code 全域指示換成 `use_with_agent.claude-code.md` 的內容、Codex／Copilot／pi／Antigravity 加入 `use_with_agent.others.md` 的內容；Claude 桌面 app 一般對話的設定由使用者手動貼上並確認。
- [x] 切換後新開一個 Claude Code session，注入紀錄中有 session 開始與第一個提示各一筆。
- [x] 回滾程序寫成步驟：hook 造成工作受阻時還原備份並移除 hook。
- [ ] 上線後觀察 2 週：agent 搜 Claude Code session 紀錄列出疑似提醒的候選，使用者認定後計數，不超過 1 次為通過；不通過時檢討比對訊號與寫入格式再觀察一輪。

**實作設計**
- 資料：正式庫套用 diff；`_injection-log/` 由 hook 自動建立。
- 設定：`~/.claude/settings.json` 新增兩組 hook，與既有 hook 並存；`~/.claude/CLAUDE.md` 墨嵐區塊替換；其他 agent 的指示檔位置在本卡開工時逐一確認。

**依賴**：T-09、T-10（兩項驗證都通過才切換）

**風險 / 實作注意**：Codex、Copilot、pi、Antigravity 的全域指示檔位置與格式未查證，開工時逐一確認。

**進度**：切換完成（2026-11-06），剩 Claude 桌面 app 手動設定與 2 週觀察
- 備份：`~/work/backup/t11_20261106-173203/`，含正式庫、`~/.claude/settings.json`、`~/.claude/CLAUDE.md`、Orca profile 的 `settings.json`、`~/.codex/AGENTS.md`；回滾步驟在同資料夾 `ROLLBACK.md`。
- 合併：正式庫自基準以來只有 `areas/workstation.md`、`areas/my-bot.md` 換成 CRLF、內容未變，也沒有新增或刪除的檔，合併結果即主副本 0c84ece，無 `version` 衝突；使用者確認。套用後正式庫除 `.obsidian/` 外與 0c84ece 完全相同，已刪 `use_with_agent.md`、`areas/project-c/design.md`。
- 全域指示位置（查證後）：Codex `~/.codex/AGENTS.md`；pi `~/.pi/agent/AGENTS.md`（pi 1.5.0 `docs/configuration.md`）；Antigravity `~/.gemini/GEMINI.md`（官方 rules 文件）；Copilot CLI `~/.copilot/copilot-instructions.md`（GitHub Docs）、VS Code Copilot `%APPDATA%/Code/User/prompts/ink-mist-memory.instructions.md`（`applyTo: '**'`）。除 Codex 為空檔外都是新建。
- hook：`~/.claude/settings.json` 的 `SessionStart`（matcher `^(startup|resume|clear|compact|fork)$`）與 `UserPromptSubmit` 各加一組，`timeout` 10 秒，既有 hook 不動。
- 驗證：以預設設定目錄 `claude -p` 在 `~/work/temp` 開新 session，注入紀錄有 session 開始與第一個提示各一筆，無失敗。
- Orca：Orca 啟動的 session 使用 Orca profile 下由 `~/.claude/settings.json` 同步過去的 `settings.json`；以 `orca agent launch --agent claude` 開新 session 時同步到新 hook，注入紀錄有 session 開始與第一個提示各一筆。
- 待辦：Claude 桌面 app 一般對話的設定由使用者手動貼上 `use_with_agent.others.md` 的內容；上線後觀察到 2026-11-20。

## 開工前待決

無。
