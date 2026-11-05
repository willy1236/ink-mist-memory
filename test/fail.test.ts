import { describe, expect, it } from 'vitest';
import { claudeCode } from '../src/platforms/index.js';
import { createFailAndExit, shellFailure } from '../src/shell/fail.js';
import type { LogRecord } from '../src/shell/log.js';
import { failureNotice } from '../src/shell/notice.js';

const raw = { hook_event_name: 'SessionStart', session_id: 's', cwd: 'D:/x', prompt: 'p' };

describe('shellFailure', () => {
  it('尚未輸出：輸出失敗通知（沿用輸入的事件名）並記錄原因', () => {
    const r = shellFailure({ memoryRoot: 'D:/m', platform: claudeCode, startedAt: 1000, raw, outputStarted: false, reason: '外殼逾時' }, 3950);
    expect(JSON.parse(r.output!)).toEqual({
      hookSpecificOutput: { hookEventName: 'SessionStart', additionalContext: failureNotice('D:/m') },
    });
    expect(r.record).toMatchObject({ session_id: 's', cwd: 'D:/x', prompt: 'p', failure: '外殼逾時', duration_ms: 2950 });
  });

  it('已開始輸出：不再輸出，仍寫一筆註明「輸出後」的紀錄', () => {
    const r = shellFailure({ memoryRoot: 'D:/m', platform: claudeCode, startedAt: 0, raw, outputStarted: true, reason: '外殼逾時' });
    expect(r.output).toBeUndefined();
    expect(r.record.failure).toMatch(/^輸出後外殼逾時/);
  });

  it('failAndExit 只寫一次紀錄與通知；第二次呼叫（通知卡住時 watchdog 觸發）直接結束', () => {
    const logs: LogRecord[] = [];
    const outputs: string[] = [];
    let exits = 0;
    const fail = createFailAndExit({
      memoryRoot: 'D:/m', platform: claudeCode,
      startedAt: 0,
      current: () => ({ raw, outputStarted: false }),
      writeLog: (r) => logs.push(r),
      writeOutput: (t) => outputs.push(t), // 不呼叫 done，模擬 stdout 卡住
      exit: () => exits++,
    });
    fail('外殼錯誤');
    expect([logs.length, outputs.length, exits]).toEqual([1, 1, 0]);
    fail('外殼逾時');
    expect([logs.length, outputs.length, exits]).toEqual([1, 1, 1]);
  });

  it('輸入無法解析時以 UserPromptSubmit 輸出', () => {
    const r = shellFailure({ memoryRoot: 'D:/m', platform: claudeCode, startedAt: 0, raw: {}, outputStarted: false, reason: 'x' });
    expect(JSON.parse(r.output!).hookSpecificOutput.hookEventName).toBe('UserPromptSubmit');
  });
});
