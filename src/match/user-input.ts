/**
 * 開頭的機器訊息區塊，依序嘗試：
 * - harness 的 XML 標籤（system-reminder、agent-message、task-notification）
 * - Orca 的 `──── From:` 訊息：內文可能夾帶終端畫面的橫線，所以貪婪比對到最後一條整行橫線
 * - Orca bot 的人設與記憶更新：`[Your SOUL.md was updated…]` 到接著的 MEMORY 區塊之前，
 *   以及 `[Your MEMORY.md changed…]` 到 `<<<…>>>` 結束
 * - Orca bot 首次執行的說明：`[Orca: you are in your first run…]` 加其後的 `## First run` 列表
 * - 單行的 `[Orca: …]` 提示，以及 Orca 自動送出的單行事件（重啟續作、首次執行開始、卡片回覆、Google 設定）
 * - Claude Code 的 hook 失敗回報：到提示結尾都算
 * - Codex 內建記憶功能派出的整理 agent（`## Memory Writing Agent: Phase N`）：整段都是 Codex 產生的指示與對話摘要
 */
const MACHINE_BLOCK = new RegExp(
  '^\\s*(?:' +
    [
      String.raw`<(system-reminder|agent-message|task-notification)\b[^>]*>[\s\S]*?<\/\1>`,
      String.raw`─{4} From: [^\n]*\n[\s\S]*\n─{20,}[ \t]*(?:\n|$)`,
      String.raw`\[Your SOUL\.md was updated[^\n]*\][\s\S]*?(?=\n\[Your MEMORY\.md )`,
      String.raw`\[Your MEMORY\.md [^\n]*\]\s*\[Orca: your MEMORY\.md[^\n]*\]\n<<<[\s\S]*?\n>>>[ \t]*(?:\n|$)`,
      String.raw`\[Orca: you are in your first run[^\n]*\]\s*## First run\n(?:- [^\n]*(?:\n|$))+`,
      String.raw`\[Orca: [^\n]*\][ \t]*(?:\n|$)`,
      String.raw`(?:Orca restarted\. Resume the original unfinished user task|Orca: you were just created\.|Card \S+ answered:|Google setup started by your owner)[^\n]*(?:\n|$)`,
      String.raw`Claude \w+(?::\w+)? hook failed \(exit code \d+\)[\s\S]*`,
      String.raw`## Memory Writing Agent: Phase \d+\b[\s\S]*`,
    ].join('|') +
    ')',
);

/** Orca 派工的開場說明，到 `=== TASK ===` 為止；之後是 coordinator 寫的任務內容。 */
const DISPATCH_PREAMBLE = /^\s*You are working inside Orca, a multi-agent IDE\.[\s\S]*?\n=== TASK ===[ \t]*(?:\n|$)/;

/** 網址裡的路徑與參數（如 `scope=profile`）不是使用者在講的東西。 */
const URL = /\b[a-z][a-z0-9+.-]*:\/\/\S+/gi;

/**
 * 提示中要拿來比對名稱與任務類型的文字：
 * - 去掉開頭連續的機器訊息；整段都是機器訊息時回傳 null，整次不比對、不注入。
 * - Orca 派工的任務內容由 coordinator 撰寫，充滿專案名與關鍵字，只靠工作目錄比對，回傳空字串。
 * - 去掉網址。
 * 貼上的內容算使用者輸入，不去除。
 */
export function matchText(prompt: string): string | null {
  let rest = prompt;
  let dispatched = false;
  for (;;) {
    const machine = MACHINE_BLOCK.exec(rest);
    const dispatch = machine ? null : DISPATCH_PREAMBLE.exec(rest);
    const m = machine ?? dispatch;
    if (!m) break;
    dispatched ||= dispatch !== null;
    rest = rest.slice(m[0].length);
  }
  if (rest !== prompt && rest.trim() === '') return null;
  return dispatched ? '' : rest.replace(URL, ' ');
}
