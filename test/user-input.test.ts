import { describe, expect, it } from 'vitest';
import { runPipeline } from '../src/match/pipeline.js';
import nameSignal from '../src/match/signals/name.js';
import { userInput } from '../src/match/user-input.js';
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
const ORCA = `──── From: TERM_A (term_a) [HIGH] (escalation) ────\nSubject: x\nshark 內容\n[Reply: orca]\n${RULE}`;

describe('userInput', () => {
  it.each([
    ['subagent 回報', '<agent-message from="a1">\n報告 shark\n</agent-message>'],
    ['背景任務通知', '<task-notification>\n<task-id>x</task-id>\n</task-notification>\n'],
    ['Orca 訊息', ORCA],
    ['Orca 訊息內夾帶終端畫面的橫線', `──── From: TERM_A (term_a) ────\nSubject: x\n${RULE}\nshark 畫面\n${RULE}\n[Reply: orca]\n${RULE}`],
    ['只有 Orca 派工開場說明', ORCA_WORKER],
    ['只有 system-reminder', '<system-reminder>\nx\n</system-reminder>'],
    ['連續多則機器訊息', `<agent-message from="a">x</agent-message>\n\n${ORCA}\n<agent-message from="b">y</agent-message>`],
  ])('整段都是機器訊息時回傳 null：%s', (_name, prompt) => {
    expect(userInput(prompt)).toBeNull();
  });

  it('去掉開頭的機器訊息，留下使用者輸入', () => {
    expect(userInput('<system-reminder>\nfork\n</system-reminder>\n\n登出學校帳號')?.trim()).toBe('登出學校帳號');
    expect(userInput(`${ORCA}\n順便看 shark`)?.trim()).toBe('順便看 shark');
  });

  it('使用者輸入維持原樣：一般文字、貼上內容、空字串、沒收尾的區塊、句中提到標籤', () => {
    for (const p of [
      '幫我 commit',
      '<pasted_content id="a">\nshark\n</pasted_content id="a">\n\n看一下',
      '',
      '<agent-message from="a">沒收尾',
      '這個 <agent-message>x</agent-message> 怎麼解析',
    ]) expect(userInput(p)).toBe(p);
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

  it('機器訊息內的關鍵字不算，使用者輸入的才算', () => {
    expect(run('<system-reminder>shark</system-reminder>看一下').candidates).toEqual([]);
    expect(run('<system-reminder>x</system-reminder>看 shark').candidates).toHaveLength(1);
  });
});
