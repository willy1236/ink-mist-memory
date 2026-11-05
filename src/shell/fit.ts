import type { InjectedEntry } from './types.js';

/** 外殼輸出時各段之間的分隔。 */
export const SEPARATOR = '\n\n';

/** 一條條目組成的注入文字：所屬檔案開頭，接條目原文（可多行）。 */
export function formatEntry(entry: InjectedEntry): string {
  return `[${entry.file}]\n${entry.text}`;
}

export interface FitResult {
  text: string;
  used: InjectedEntry[];
  dropped: InjectedEntry[];
  /** 單條就超過 `oversizeLimit`、永遠放不進去而被跳過的條目（也包含在 dropped 內）。 */
  oversized: InjectedEntry[];
}

/**
 * 依候選順序逐條累加，直到達到條數上限或字元上限（扣掉 `reserve`）。
 * 某條放不下時停止，之後的條目都捨棄，以維持取捨順序；
 * 但單條連同 header 就超過 `oversizeLimit`（絕對上限，與這次其他內容無關）的條目
 * 永遠放不進去，跳過它繼續，免得它每次都排第一、讓整個 session 一條都注入不到。
 * 只是這次放不下的條目照常停止，不算過長。
 * 沒有任何條目被採用時 `text` 為空字串（不含 header）。
 */
export function fitWithinLimit(
  header: string,
  entries: readonly InjectedEntry[],
  maxCount: number,
  maxChars = 10000,
  reserve = 0,
  oversizeLimit = maxChars - reserve,
): FitResult {
  const budget = maxChars - reserve;
  const used: InjectedEntry[] = [];
  const oversized: InjectedEntry[] = [];
  const alone = (e: InjectedEntry) => (header === '' ? 0 : header.length + SEPARATOR.length) + formatEntry(e).length;
  let text = header;
  let i = 0;
  for (; i < entries.length && used.length < maxCount; i++) {
    const entry = entries[i]!;
    if (alone(entry) > oversizeLimit) {
      oversized.push(entry);
      continue;
    }
    const next = text + (text === '' ? '' : SEPARATOR) + formatEntry(entry);
    if (next.length > budget) break;
    text = next;
    used.push(entry);
  }
  return {
    text: used.length === 0 ? '' : text,
    used,
    dropped: [...oversized, ...entries.slice(i)],
    oversized,
  };
}
