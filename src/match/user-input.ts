/**
 * 開頭的機器訊息區塊：harness 的 XML 標籤、Orca 的 `──── From:` 訊息，或 Orca 派工的開場說明。
 * Orca 訊息內文可能夾帶終端畫面的橫線，所以貪婪比對到最後一條整行橫線。
 * 派工開場說明到 `=== TASK ===` 為止，之後的任務內容算使用者輸入；開場說明內的 session ID
 * 是十六進位字串，會誤中 `e2e` 這類關鍵字。
 */
const MACHINE_BLOCK =
  /^\s*(?:<(system-reminder|agent-message|task-notification)\b[^>]*>[\s\S]*?<\/\1>|─{4} From: [^\n]*\n[\s\S]*\n─{20,}[ \t]*(?:\n|$)|You are working inside Orca, a multi-agent IDE\.[\s\S]*?\n=== TASK ===[ \t]*(?:\n|$))/;

/**
 * 取出提示中使用者實際輸入的部分：去掉開頭連續的機器訊息區塊。
 * 整段都是機器訊息時回傳 null；貼上的內容算使用者輸入，不去除。
 */
export function userInput(prompt: string): string | null {
  let rest = prompt;
  for (let m = MACHINE_BLOCK.exec(rest); m; m = MACHINE_BLOCK.exec(rest)) rest = rest.slice(m[0].length);
  return rest === prompt || rest.trim() !== '' ? rest : null;
}
