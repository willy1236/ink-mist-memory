# ink-mist-memory

墨嵐記憶庫的自動注入器：記憶庫是一個 markdown 資料夾，格式見〈記憶庫格式〉。Claude Code 或 Codex 開 session 或送出提示時，由 hook 把相關記憶直接放進 context，agent 不必自己去讀記憶庫。

```
Claude Code / Codex ──hook──▶ node dist/hook.js --platform <平台> --memory-root <記憶庫路徑>
                        ├─ SessionStart：preferences.md、conduct.md 全文＋讀取通則，resume 以外重置該 session 的去重
                        └─ UserPromptSubmit：依工作目錄、名稱與 alias、任務類型關鍵字挑出記憶條目
                           同一 session 去重；每次至多 30 條、10,000 字元；完全沒命中時注入一次精簡索引
```

比對只看使用者實際輸入：subagent 回報、背景任務通知、Orca 訊息與系統提示、Claude Code 的 hook 失敗回報不觸發注入；Orca 派工的任務內容由 coordinator 撰寫，只依工作目錄比對；網址不參與比對。帶 `repos` 的專案檔，其任務類型條目只在工作目錄屬於該專案時注入。

注入出錯、崩潰或超過 3 秒時，改為輸出失敗通知，請 agent 照 `AGENTS.legacy-read.md` 自己讀記憶。每次呼叫都在 `<記憶庫>/_injection-log/` 寫一筆紀錄。

## 記憶庫格式

```
<記憶庫>/
├─ AGENTS.md               # 讀寫規則；須含「讀取通則」一節與任務類型表
├─ AGENTS.legacy-read.md   # 注入失敗時 agent 改照它自行讀記憶
├─ preferences.md          # session 開始時全文注入
├─ conduct.md              # session 開始時全文注入
├─ areas/
│  ├─ my-app.md            # 一般記憶檔
│  └─ homelab/             # 資料夾型：_index.md 代表整個資料夾
│     ├─ _index.md
│     └─ access.md
├─ topics/ people/ ...     # 其餘 .md 都參與比對，資料夾名不限
├─ history/ reports/       # 不參與比對，agent 需要時自行查閱
└─ _injection-log/         # 注入紀錄，自動建立
```

`AGENTS.md` 只有兩處會被程式讀取，其餘內容由你自訂：

- 二級標題「讀取通則」一節，可帶前置編號（如 `## 0. 讀取通則`），session 開始時注入，告訴 agent 怎麼使用注入的記憶。
- 第一個表頭含「任務類型」與「提示關鍵字」兩欄的表格，關鍵字以頓號分隔：

  | 任務類型 | 提示關鍵字 |
  |---|---|
  | commit | commit、提交 |
  | 部署 | 部署、deploy、上線 |

記憶檔：

```markdown
---
name: my-app
description: my-app 專案的決策與習慣
aliases: [我的 app]
repos: [~/github/my-app]
version: 2026-11-20T12:00:00Z
---

- [stated] 資料庫遷移一律用 migration 檔，不手動改 schema
  - 子項目跟著父項一起注入

## 任務：部署

- [stated] 部署前先在 staging 跑過 smoke test
```

- `name` 必填，缺少或 frontmatter 無法解析的檔會跳過；`description` 用於沒命中時的精簡索引；`aliases`、`repos` 供名稱與工作目錄比對；`version` 用於超過上限時的取捨，新的優先。
- 條目是以 `[stated]`、`[inferred]` 或 `[ref]` 開頭的頂層列表項目，連同其下子項；段落、表格與沒有標籤的列表不會被注入。
- `## 任務：<類型>` 標題下的條目在提示含該類型關鍵字時注入，類型須在任務類型表內。
- 資料夾型 `areas/<name>/` 以資料夾名與 `_index.md` 的 `aliases`、`repos` 參與比對，命中時注入整個資料夾；子檔的 `aliases`、`repos` 不生效。

## 環境需求

- Node.js 22 以上
- pnpm 11

## 安裝與建置

```sh
pnpm install
pnpm build
```

產出的 `dist/hook.js` 由 hook 以 `node` 直接執行，不經 pnpm，以壓低啟動時間。

## 接上 Claude Code

### 以插件安裝

repo 根目錄本身就是插件，也是只含這個插件的 marketplace（`.claude-plugin/`）。建置後在 Claude Code 執行：

```
/plugin marketplace add <repo 路徑>
/plugin install ink-mist-memory@ink-mist
```

安裝時會要求填記憶庫路徑（`memory_root`），hook 由插件的 `hooks/hooks.json` 帶上。從本機路徑加入的 marketplace 原地載入，`pnpm build` 後下個 session 即生效，不需重裝；`dist/` 不進版控，所以不支援從 GitHub 直接安裝。

### 手動接 hook

不用插件時，在 `~/.claude/settings.json` 的 `hooks` 加兩組，與既有 hook 並存；兩種方式擇一，同時使用會重複注入：

```json
"SessionStart": [
  {
    "matcher": "^(startup|resume|clear|compact|fork)$",
    "hooks": [{ "type": "command", "command": "node <repo 路徑>/dist/hook.js --memory-root <記憶庫路徑>", "timeout": 10 }]
  }
],
"UserPromptSubmit": [
  {
    "hooks": [{ "type": "command", "command": "node <repo 路徑>/dist/hook.js --memory-root <記憶庫路徑>", "timeout": 10 }]
  }
]
```

- `--memory-root`：記憶庫路徑。無法在 hook 指令帶參數時改設環境變數 `INK_MIST_MEMORY_ROOT`；兩者都有時以參數為準，都沒有時注入「記憶庫路徑未設定」的失敗通知。
- `--platform` 用來選擇 hook 平台，支援 `claude-code` 和 `codex`，預設為 `claude-code`。
- `timeout` 要大於 3 秒，讓程式自己的逾時先生效。
- session 去重狀態放在 `%LOCALAPPDATA%/ink-mist-memory/sessions/`，可用環境變數 `INK_MIST_SESSION_DIR` 改位置。
- 記憶庫的解析結果快取在 `%LOCALAPPDATA%/ink-mist-memory/cache/`，記憶檔、`AGENTS.md` 或程式本身變動時自動重新解析；可用環境變數 `INK_MIST_CACHE_DIR` 改位置。

只想在單一 session 試用時，把上面兩組放進另一個檔案，以 `claude --settings <檔案>` 啟動，範例見 `settings/claude-test.settings.json`，路徑需換成自己的。

讀取交給 hook 之後，全域指示 `~/.claude/CLAUDE.md` 只需要告訴 agent 何時寫入記憶、寫入前先讀 `AGENTS.md`。

## 接上 Codex

執行 `pnpm build`，再把下列兩組加到 `~/.codex/hooks.json` 的 `hooks`。若有設定 `CODEX_HOME`，使用該資料夾下的 `hooks.json`。把佔位符換成絕對路徑，Windows 路徑可使用 `/`。

```json
{
  "hooks": {
    "SessionStart": [
      {
        "matcher": "^(startup|resume|clear|compact|fork)$",
        "hooks": [
          {
            "type": "command",
            "command": "node \"<repo 路徑>/dist/hook.js\" --platform codex --memory-root \"<記憶庫路徑>\"",
            "timeout": 10,
            "additionalContextLimit": 30000
          }
        ]
      }
    ],
    "UserPromptSubmit": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "node \"<repo 路徑>/dist/hook.js\" --platform codex --memory-root \"<記憶庫路徑>\"",
            "timeout": 10,
            "additionalContextLimit": 30000
          }
        ]
      }
    ]
  }
}
```

Codex 預設啟用 hooks。啟動 Codex CLI 後，開啟 `/hooks`，確認兩個 hook 的指令並標為信任，再開新 session 驗證 `SessionStart`。修改 hook 定義後需重新信任。[Codex hooks 官方文件](https://learn.chatgpt.com/docs/hooks)

開啟 Codex 內建記憶功能（`[features] memories = true`）時，Codex 會在記憶資料夾（`$CODEX_HOME/memories` 或 `memories_v2`）派出整理 agent；工作目錄在這兩個資料夾內的 session 不注入，紀錄的 `notes` 會標明略過原因。

Codex 預設在約 2,500 tokens 後改送預覽。範例提高每個 handler 的 `additionalContextLimit`，替最多 10,000 字元的提示注入保留中文所需的 token 空間。`SessionStart` 會送出必載內容全文，若超過設定門檻，Codex 仍會改送預覽。

還沒安裝 hook 的 agent 可在全域指示裡要求開工時照 `AGENTS.legacy-read.md` 自行讀記憶。

## 手動測試

```sh
echo '{"hook_event_name":"UserPromptSubmit","session_id":"try","cwd":"<專案路徑>","prompt":"幫我 commit 一下"}' \
  | node dist/hook.js --memory-root <記憶庫路徑>
```

## 開發

```sh
pnpm test   # vitest
pnpm lint   # ESLint
```

## 程式結構

比對核心與平台無關，各 agent 平台只差在 hook 的輸入輸出格式，由 `src/platforms/` 下的轉接層處理：

- `src/platforms/`：平台轉接層，把原生事件（如 Claude Code 的 `UserPromptSubmit`）對應到核心事件（`session-start`、`prompt-submit`），並決定輸出格式與單次注入的字元上限。接新平台時新增一個轉接層檔並列進 `PLATFORMS`。
- `src/shell/`：hook 共用外殼：3 秒逾時、worker、截斷、去重、失敗通知與注入紀錄。
- `src/handlers/`、`src/match/`、`src/memory/`：依核心事件產出注入內容：讀記憶庫、比對、排序。

## 授權

MIT，見 `LICENSE`。
