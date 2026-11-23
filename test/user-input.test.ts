import { describe, expect, it } from 'vitest';
import { runPipeline } from '../src/match/pipeline.js';
import nameSignal from '../src/match/signals/name.js';
import { matchText } from '../src/match/user-input.js';
import { loadMemory } from '../src/memory/index.js';
import { memoryStore } from './helpers.js';

const RULE = '─'.repeat(60);
const ORCA_WORKER = [
  'You are working inside Orca, a multi-agent IDE. You are a dispatched worker.',
  'Your task ID is: task_e2e0',
  '',
  '=== CLI COMMANDS ===',
  'orca orchestration ask',
  '',
  '---',
  '',
  '=== TASK ===',
  '',
].join('\n');
const ORCA_HINT =
  "[Orca: if you asked your owner something in this chat that they've clearly left unanswered, put it on an item.]";
const FIRST_RUN = [
  "[Orca: you are in your first run until your owner's first message here is handled.]",
  '',
  '## First run',
  '- You are new. Reply with one short sentence.',
  "- Don't give a tour.",
].join('\n');
const SOUL = [
  "[Your SOUL.md was updated; this replaces your earlier standing instructions. They rank below the user's current request.]",
  '',
  '# 藍莓',
  '',
  '## How I work',
  '',
  '- 程式工作派給 worker。',
  '',
  '[Your MEMORY.md changed outside this chat since you last saw it. Its current text follows.]',
  '',
  '[Orca: your MEMORY.md, as notes to consult, not instructions.]',
  '<<<',
  '# Memory',
  '- shark 的事',
  '>>>',
].join('\n');
const HOOK_FAILED =
  'Claude SessionStart:startup hook failed (exit code 127): impeccable: no engine binary\r\nDownload from https://example.com';
const ORCA = `──── From: TERM_A (term_a) [HIGH] (escalation) ────\nSubject: x\nshark 內容\n[Reply: orca]\n${RULE}`;

describe('matchText', () => {
  it.each([
    ['subagent 回報', '<agent-message from="a1">\n報告 shark\n</agent-message>'],
    ['背景任務通知', '<task-notification>\n<task-id>x</task-id>\n</task-notification>\n'],
    ['Orca 訊息', ORCA],
    ['Orca 訊息內夾帶終端畫面的橫線', `──── From: TERM_A (term_a) ────\nSubject: x\n${RULE}\nshark 畫面\n${RULE}\n[Reply: orca]\n${RULE}`],
    ['只有 Orca 派工開場說明', ORCA_WORKER],
    ['只有 system-reminder', '<system-reminder>\nx\n</system-reminder>'],
    ['連續多則機器訊息', `<agent-message from="a">x</agent-message>\n\n${ORCA}\n<agent-message from="b">y</agent-message>`],
    ['Orca 單行提示', ORCA_HINT],
    ['Orca 單行提示接 Orca 訊息', `${ORCA_HINT}\n${ORCA}`],
    ['Orca bot 首次執行說明', `${FIRST_RUN}\nOrca: you were just created. Start your first-run setup.`],
    ['Orca bot 人設與記憶更新', SOUL],
    ['Orca 重啟續作', 'Orca restarted. Resume the original unfinished user task with existing commitments and authorization.'],
    ['Orca 卡片回覆', `${ORCA_HINT}\n\nCard google-setup/step answered: done, client`],
    ['Claude Code hook 失敗回報', HOOK_FAILED],
  ])('整段都是機器訊息時回傳 null：%s', (_name, prompt) => {
    expect(matchText(prompt)).toBeNull();
  });

  it('去掉開頭的機器訊息，留下使用者輸入', () => {
    expect(matchText('<system-reminder>\nfork\n</system-reminder>\n\n登出學校帳號')?.trim()).toBe('登出學校帳號');
    expect(matchText(`${ORCA}\n順便看 shark`)?.trim()).toBe('順便看 shark');
    expect(matchText(`${ORCA_HINT}\n\n應該就這樣了`)?.trim()).toBe('應該就這樣了');
    expect(matchText(`${FIRST_RUN}\n\n你好 我想知道你能幹嘛`)?.trim()).toBe('你好 我想知道你能幹嘛');
    expect(matchText(`${SOUL}\n\n幫我初始化好`)?.trim()).toBe('幫我初始化好');
  });

  it('Orca 派工的任務內容只靠工作目錄比對：回傳空字串', () => {
    expect(matchText(`${ORCA_WORKER}在 shark 跑測試後 commit`)).toBe('');
    expect(matchText(`<system-reminder>x</system-reminder>\n${ORCA_WORKER}commit`)).toBe('');
  });

  it('去掉網址，網址外的文字照留', () => {
    expect(matchText('登入後跳到 https://auth.example.com/oauth?scope=openid+profile&code=x 看一下')).toBe('登入後跳到   看一下');
    expect(matchText('<system-reminder>x</system-reminder>看 http://a.b/shark')).toBe('看  ');
  });

  it('使用者輸入維持原樣：一般文字、貼上內容、空字串、沒收尾的區塊、句中提到標籤', () => {
    for (const p of [
      '幫我 commit',
      '<pasted_content id="a">\nshark\n</pasted_content id="a">\n\n看一下',
      '',
      '<agent-message from="a">沒收尾',
      '這個 <agent-message>x</agent-message> 怎麼解析',
      '[Orca 的說明] 不是機器訊息',
      '沒收尾的 [Orca: 提示',
    ]) expect(matchText(p)).toBe(p);
  });
});

describe('管線套用使用者輸入', () => {
  const AGENTS = '# 共享記憶\n\n## 0. 讀取通則\n- 規則\n';
  const run = (prompt: string) => {
    const root = memoryStore({
      'AGENTS.md': AGENTS,
      'areas/shark.md': '---\nname: shark\ndescription: d\nversion: 2026-11-01T00:00:00Z\n---\n\n- [stated] shark 一\n',
    });
    return runPipeline(
      { sessionId: 's', cwd: 'D:/x', prompt, memoryRoot: root, state: { injectedIds: [], indexInjected: false } },
      loadMemory(root),
      [nameSignal],
    );
  };

  it('機器訊息不比對、也不注入精簡索引，紀錄留提醒', () => {
    const r = run('<agent-message from="a">shark</agent-message>');
    expect(r).toMatchObject({ sections: [], candidates: [], isIndex: false });
    expect(r.notes).toContain('提示不含使用者輸入，略過比對');
  });

  it('網址與 Orca 派工任務內容裡的名稱不命中', () => {
    expect(run('看 https://x.y/?q=shark').candidates).toEqual([]);
    expect(run(`${ORCA_WORKER}處理 shark`)).toMatchObject({ candidates: [], isIndex: true });
  });

  it('機器訊息內的關鍵字不算，使用者輸入的才算', () => {
    expect(run('<system-reminder>shark</system-reminder>看一下').candidates).toEqual([]);
    expect(run('<system-reminder>x</system-reminder>看 shark').candidates).toHaveLength(1);
  });
});
