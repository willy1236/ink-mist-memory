import fs from 'node:fs';
import type { Entry, Memory, MemoryFile } from '../memory/index.js';
import type { HandlerContext, HandlerResult, InjectedEntry } from '../shell/types.js';
import type { Signal } from './types.js';
import { userInput } from './user-input.js';

/**
 * 寫成 `../match/signals/`：本檔在 dist/match/ 直接執行，或被打包進 dist/handlers/ 的處理函式時，
 * 都解析到 dist/match/signals/。
 */
const SIGNALS_DIR = new URL('../match/signals/', import.meta.url);
const SIGNAL_FILE = /\.(?:js|ts)$/;

export const INDEX_HEADER =
  '以下是記憶庫的精簡索引：這次提示沒有直接相關的記憶條目，需要時依描述自行開檔（路徑相對記憶庫根目錄）。';

function errorText(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function isSignal(x: unknown): x is Signal {
  const s = x as Signal;
  return typeof s === 'object' && s !== null && typeof s.name === 'string' &&
    typeof s.level === 'number' && typeof s.match === 'function';
}

/**
 * 載入 `signals/` 下的每個訊號檔（default export），依 level 排序。
 * 新訊號只要在該資料夾新增一個檔，不改共用清單。載入失敗的檔寫提醒後略過。
 */
export async function loadSignals(dir: URL = SIGNALS_DIR): Promise<{ signals: Signal[]; notes: string[] }> {
  const names = fs.readdirSync(dir).filter((f) => SIGNAL_FILE.test(f) && !f.endsWith('.d.ts')).sort();
  // 每個檔的結果依檔名順序收集，提醒順序不受 import 完成先後影響
  const loaded = await Promise.all(
    names.map(async (f): Promise<Signal | string> => {
      try {
        const mod = (await import(new URL(f, dir).href)) as { default?: unknown };
        if (isSignal(mod.default)) return mod.default;
        return `訊號檔 ${f} 沒有以 default export 提供訊號，已略過`;
      } catch (err) {
        return `訊號檔 ${f} 載入失敗，已略過：${errorText(err)}`;
      }
    }),
  );
  const notes = loaded.filter((x) => typeof x === 'string');
  const signals = loaded.filter((x) => typeof x !== 'string').sort((a, b) => a.level - b.level);
  return { signals, notes };
}

/** 只檢查管線用到的欄位（id、file、text）。 */
function isEntry(x: unknown): x is Entry {
  const e = x as Entry;
  return typeof e === 'object' && e !== null && typeof e.id === 'string' &&
    typeof e.file === 'string' && typeof e.text === 'string';
}

interface Hit {
  entry: Entry;
  level: number;
  signal: string;
}

/** 檔案 `version` 轉成可比較的時間；缺或無法解析為 null（排最後）。 */
function versionTime(file: MemoryFile | undefined): number | null {
  if (!file?.version) return null;
  const t = Date.parse(file.version);
  return Number.isNaN(t) ? null : t;
}

/** 精簡索引：各記憶檔一項，資料夾型以資料夾名與 `_index.md` 描述列一項。沒有任何項目時為空字串。 */
export function buildIndex(memory: Memory): string {
  const lines = memory.files
    .filter((f) => f.folder === null || f.isFolderIndex)
    .map((f) => {
      const where = f.isFolderIndex ? `areas/${f.folder}/` : f.path;
      return `- ${f.displayName}（${where}）：${f.description}`;
    });
  return lines.length === 0 ? '' : `${INDEX_HEADER}\n\n${lines.join('\n')}`;
}

/**
 * 送出提示的管線：各訊號產出命中條目 → 同一條目取最高優先序 → 去掉本 session 已注入 →
 * 依「訊號優先序、檔案 version 新到舊（缺的排最後，相同依路徑字母序）、檔內順序」排序。
 * 完全沒命中且本 session 未注入過索引時回傳精簡索引。截斷與記去重由外殼負責。
 * 訊號只看使用者實際輸入；整段都是機器訊息的提示不比對、不注入。
 */
export function runPipeline(rawCtx: HandlerContext, memory: Memory, signals: readonly Signal[]): HandlerResult {
  const notes = [...memory.notes];
  const prompt = userInput(rawCtx.prompt ?? '');
  if (prompt === null) {
    return { sections: [], candidates: [], isIndex: false, notes: [...notes, '提示不含使用者輸入，略過比對'] };
  }
  const ctx: HandlerContext = { ...rawCtx, prompt };
  const hits = new Map<string, Hit>();
  for (const signal of signals) {
    let matched: Entry[];
    try {
      const result = signal.match(ctx, memory);
      const entries: unknown = Array.isArray(result) ? result : result?.entries;
      if (!Array.isArray(entries)) throw new Error('回傳格式錯誤：沒有條目陣列');
      if (!entries.every(isEntry)) throw new Error('回傳格式錯誤：條目缺 id、file 或 text');
      const own: unknown = Array.isArray(result) ? [] : (result.notes ?? []);
      if (!Array.isArray(own) || !own.every((n) => typeof n === 'string')) throw new Error('回傳格式錯誤：notes 不是字串陣列');
      matched = entries as Entry[];
      for (const n of own) notes.push(`訊號 ${signal.name}：${n}`);
    } catch (err) {
      notes.push(`訊號 ${signal.name} 執行失敗，已略過：${errorText(err)}`);
      continue;
    }
    for (const entry of matched) {
      const prev = hits.get(entry.id);
      if (!prev || signal.level < prev.level) hits.set(entry.id, { entry, level: signal.level, signal: signal.name });
    }
  }

  if (hits.size === 0) {
    const index = ctx.state.indexInjected ? '' : buildIndex(memory);
    return { sections: index === '' ? [] : [index], candidates: [], isIndex: index !== '', notes };
  }

  const fileByPath = new Map(memory.files.map((f) => [f.path, f]));
  const order = new Map<Entry, number>();
  for (const f of memory.files) f.entries.forEach((e, i) => order.set(e, i));
  const injected = new Set(ctx.state.injectedIds);

  const candidates: InjectedEntry[] = [...hits.values()]
    .filter((h) => !injected.has(h.entry.id))
    .sort((a, b) => {
      if (a.level !== b.level) return a.level - b.level;
      if (a.entry.file !== b.entry.file) {
        const va = versionTime(fileByPath.get(a.entry.file));
        const vb = versionTime(fileByPath.get(b.entry.file));
        if (va !== vb) {
          if (va === null) return 1;
          if (vb === null) return -1;
          return vb - va;
        }
        return a.entry.file < b.entry.file ? -1 : 1;
      }
      return (order.get(a.entry) ?? 0) - (order.get(b.entry) ?? 0);
    })
    .map(({ entry, signal }) => ({ id: entry.id, file: entry.file, text: entry.text, signal }));

  return { sections: [], candidates, isIndex: false, notes };
}
