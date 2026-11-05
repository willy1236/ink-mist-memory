import { createHash } from 'node:crypto';
import type { Root, RootContent, Table } from 'mdast';
import { fromMarkdown } from 'mdast-util-from-markdown';
import { gfmTableFromMarkdown } from 'mdast-util-gfm-table';
import { toString } from 'mdast-util-to-string';
import { gfmTable } from 'micromark-extension-gfm-table';
import { parse as parseYaml } from 'yaml';
import { normalize } from './normalize.js';
import type { Entry, TaskType } from './types.js';

const TAG = /^\[(?:stated|inferred|ref)\]/;
const TASK_PREFIX = '任務:'; // normalize 後的「任務：」
const LIST_MARKER = /^(?:[-*+]|\d{1,9}[.)])\s+/;

/** 文字下一行接 `---` 的 setext 二級標題：Obsidian 筆記裡常是想畫分隔線，不當成結構性標題。 */
function isSetextH2(src: string, node: RootContent): boolean {
  return node.type === 'heading' && node.depth === 2 && !/^ {0,3}#/.test(src.slice(node.position!.start.offset!));
}

/** 一、二級的結構性標題回傳層級，其餘（含 setext 二級標題）為 undefined。條目與讀取通則共用。 */
function sectionDepth(src: string, node: RootContent): 1 | 2 | undefined {
  if (node.type !== 'heading' || node.depth > 2 || isSetextH2(src, node)) return undefined;
  return node.depth as 1 | 2;
}

export function parseMarkdown(src: string): Root {
  return fromMarkdown(src, { extensions: [gfmTable()], mdastExtensions: [gfmTableFromMarkdown()] });
}

/** 統一換行並去 BOM，讓位置與識別不受編碼細節影響。 */
export function cleanSource(src: string): string {
  return src.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n');
}

export type Frontmatter =
  | { ok: true; data: Record<string, unknown>; body: string }
  | { ok: false; reason: string };

/** 切出開頭的 `---` frontmatter 並以 YAML 解析；body 保留原行數以外的內文。 */
export function splitFrontmatter(src: string): Frontmatter {
  const m = /^---\n([\s\S]*?)\n---[ \t]*(?:\n|$)/.exec(src);
  if (!m) return { ok: false, reason: '沒有 frontmatter' };
  let data: unknown;
  try {
    data = parseYaml(m[1]!);
  } catch (err) {
    return { ok: false, reason: `frontmatter 無法解析（${err instanceof Error ? err.message.split('\n')[0] : String(err)}）` };
  }
  if (typeof data !== 'object' || data === null || Array.isArray(data)) {
    return { ok: false, reason: 'frontmatter 不是鍵值對' };
  }
  return { ok: true, data: data as Record<string, unknown>, body: src.slice(m[0].length) };
}

/**
 * 條目識別：檔案＋正規化內容（去每行行尾空白與前後空行）。
 * 不轉小寫或半形：只改大小寫、全半形也算內容改過。
 */
export function entryId(file: string, text: string): string {
  const content = text.split('\n').map((l) => l.trimEnd()).join('\n').trim();
  return createHash('sha1').update(`${file}\n${content}`).digest('hex').slice(0, 16);
}

function slice(src: string, node: RootContent): string {
  return src.slice(node.position!.start.offset, node.position!.end.offset);
}

export interface TaskHeadingResolver {
  /** 回傳二級標題對應的任務類型名稱；不是任務類型標題時為 null。 */
  (heading: string): string | null;
}

/** 有「任務：」前綴的標題回傳去掉前綴後的類型名，否則 undefined。 */
export function taskPrefixName(heading: string): string | undefined {
  const n = normalize(heading);
  return n.startsWith(TASK_PREFIX) ? n.slice(TASK_PREFIX.length).trim() : undefined;
}

/**
 * 切條目：帶來源標籤的頂層列表項目連同所有子項；巢狀標題下的條目沿用所屬二級標題。
 * 一級標題會清掉目前的二級標題。
 */
export function extractEntries(
  file: string,
  body: string,
  resolveTask: TaskHeadingResolver,
  notes: string[],
  /** 內文在原檔中的起始行偏移（frontmatter 佔的行數），提醒的行號以原檔計。 */
  lineOffset = 0,
): Entry[] {
  const tree = parseMarkdown(body);
  const entries: Entry[] = [];
  let heading: string | null = null;
  let taskType: string | null = null;
  for (const node of tree.children) {
    const depth = sectionDepth(body, node);
    if (isSetextH2(body, node)) {
      const line = node.position!.start.line + lineOffset;
      const firstLine = toString(node).trim().split('\n')[0]!.slice(0, 30);
      notes.push(`${file} 第 ${line} 行起的「${firstLine}」下一行接 ---，不當成二級標題；要當標題請改用 ##，要分隔線請在 --- 前空一行`);
    } else if (depth !== undefined) {
      heading = depth === 2 ? toString(node).trim() : null;
      taskType = heading === null ? null : resolveTask(heading);
    } else if (node.type === 'list') {
      for (const item of node.children) {
        // 列表符號後縮排過深的內容是程式碼區塊，不是條目
        if (item.children[0]?.type === 'code') continue;
        const text = slice(body, item as unknown as RootContent).trimEnd();
        // 以原始碼判斷標籤：`- [ref]: url` 會被 mdast 解析成 definition 而非 paragraph
        if (!TAG.test(text.replace(LIST_MARKER, ''))) continue;
        entries.push({ id: entryId(file, text), file, heading, taskType, text });
      }
    }
  }
  return entries;
}

const NUMBERING = /^(?:§\s*)?[0-9０-９一二三四五六七八九十]+(?:\.[0-9]+)*\s*[.、．:：)）]?\s*/;

/** 擷取二級標題去掉前置編號後等於 `title` 的一節內容（到下一個一、二級標題為止）。 */
export function extractSection(src: string, tree: Root, title: string): string | null {
  const nodes = tree.children;
  const start = nodes.findIndex(
    (n) => sectionDepth(src, n) === 2 && toString(n).trim().replace(NUMBERING, '').trim() === title,
  );
  if (start === -1) return null;
  const end = nodes.findIndex((n, i) => i > start && sectionDepth(src, n) !== undefined);
  const from = nodes[start]!.position!.end.offset!;
  const to = end === -1 ? src.length : nodes[end]!.position!.start.offset!;
  return src.slice(from, to).trim();
}

/** 規格定關鍵字以頓號分隔；不切 `/`、`,`，避免 `CI/CD` 拆成會誤命中的短字。 */
const KEYWORD_SPLIT = /、/;

const OTHER_SEPARATOR = /[,，;；]/;

/** 取第一個表頭含「任務類型」與「提示關鍵字」兩欄的表格；沒有則 null。關鍵字疑似用錯分隔符時寫提醒。 */
export function extractTaskTypes(tree: Root, notes: string[]): TaskType[] | null {
  for (const node of tree.children) {
    if (node.type !== 'table') continue;
    const rows = (node as Table).children;
    const header = rows[0]?.children.map((c) => toString(c).trim()) ?? [];
    const nameCol = header.indexOf('任務類型');
    const kwCol = header.indexOf('提示關鍵字');
    if (nameCol === -1 || kwCol === -1) continue;
    return rows.slice(1).flatMap((row) => {
      const name = toString(row.children[nameCol] ?? '').trim();
      if (name === '') return [];
      const keywords = toString(row.children[kwCol] ?? '')
        .split(KEYWORD_SPLIT)
        .map((k) => k.trim())
        .filter((k) => k !== '');
      for (const k of keywords.filter((kw) => OTHER_SEPARATOR.test(kw))) {
        notes.push(`任務類型「${name}」的關鍵字「${k}」含逗號或分號；關鍵字只以頓號分隔，這裡會整串當成一個關鍵字`);
      }
      return [{ name, keywords }];
    });
  }
  return null;
}
