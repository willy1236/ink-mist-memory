import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { cleanupLogs, logFileName, writeLog, type LogRecord } from '../src/shell/log.js';
import { readLogs, tempDir } from './helpers.js';

const record: LogRecord = {
  time: '2026-11-06T00:00:00.000Z',
  event: 'UserPromptSubmit',
  session_id: 's',
  cwd: 'D:/x',
  prompt: 'hi',
  entries: [{ id: 'a', file: 'areas/a.md', signal: 'cwd' }],
  index: false,
  notes: ['n'],
  duration_ms: 5,
};

describe('注入紀錄', () => {
  it('每日一個 JSONL 檔，逐筆附加', () => {
    const root = tempDir();
    const now = new Date(2026, 10, 6, 12);
    expect(writeLog(root, record, now)).toBeUndefined();
    writeLog(root, record, now);
    expect(fs.readdirSync(path.join(root, '_injection-log'))).toEqual(['2026-11-06.jsonl']);
    expect(readLogs(root)).toEqual([record, record]);
  });

  it('寫入失敗時回傳錯誤而不丟例外', () => {
    const root = tempDir();
    fs.writeFileSync(path.join(root, '_injection-log'), 'not a dir');
    expect(writeLog(root, record)).toEqual(expect.any(String));
  });

  it('清除超過 30 天的紀錄，保留 30 天內與非紀錄檔', () => {
    const root = tempDir();
    const dir = path.join(root, '_injection-log');
    fs.mkdirSync(dir);
    const now = new Date(2026, 10, 6, 12);
    const day = (offset: number) => logFileName(new Date(2026, 10, 6 - offset));
    for (const f of [day(31), day(30), day(0), 'notes.txt']) fs.writeFileSync(path.join(dir, f), '');
    expect(cleanupLogs(root, now)).toEqual([day(31)]);
    expect(fs.readdirSync(dir).sort()).toEqual([day(30), day(0), 'notes.txt'].sort());
  });
});
