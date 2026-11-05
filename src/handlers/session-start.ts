import fs from 'node:fs';
import path from 'node:path';
import { loadReadingRules } from '../memory/index.js';
import type { HandlerContext, HandlerResult } from '../shell/types.js';

/** session 開始必載、全文注入的檔案，依注入順序。 */
export const REQUIRED_FILES = [
  { file: 'preferences.md', label: '回應偏好' },
  { file: 'conduct.md', label: '工作紀律' },
] as const;

function errorText(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/**
 * SessionStart：依序注入 `preferences.md`、`conduct.md` 全文與 `AGENTS.md` 的「讀取通則」。
 * 任一讀不到時照常回傳讀得到的部分並設 `failed`。去重狀態的重置（resume 除外）由外殼在呼叫前完成。
 */
export default function sessionStart(ctx: HandlerContext): HandlerResult {
  const sections: string[] = [];
  const notes: string[] = [];
  const missing: string[] = [];

  for (const { file, label } of REQUIRED_FILES) {
    try {
      const text = fs.readFileSync(path.join(ctx.memoryRoot, file), 'utf8').replace(/^\uFEFF/, '').trim();
      sections.push(`以下是記憶庫必載檔 ${file}（${label}）全文：\n\n${text}`);
    } catch (err) {
      missing.push(file);
      notes.push(`${file} 讀不到：${errorText(err)}`);
    }
  }

  let readingRules: string | null = null;
  try {
    const loaded = loadReadingRules(ctx.memoryRoot);
    readingRules = loaded.readingRules;
    notes.push(...loaded.notes);
  } catch (err) {
    notes.push(`讀取通則讀不到：${errorText(err)}`);
  }
  if (readingRules === null) {
    missing.push('AGENTS.md 讀取通則');
  } else {
    sections.push(`以下是記憶的讀取通則（AGENTS.md），說明如何使用之後注入的記憶：\n\n${readingRules}`);
  }

  return {
    sections,
    candidates: [],
    isIndex: false,
    notes,
    ...(missing.length > 0 && { failed: `必載內容讀不到：${missing.join('、')}` }),
  };
}
