import fs from 'node:fs';
import path from 'node:path';
import {
  cleanSource,
  extractEntries,
  extractSection,
  extractTaskTypes,
  parseMarkdown,
  splitFrontmatter,
  taskPrefixName,
} from './markdown.js';
import { normalize } from './normalize.js';
import type { Memory, MemoryFile, TaskType } from './types.js';

/** 根目錄下不屬於記憶、不參與比對的檔案。 */
const EXCLUDED_FILES = new Set([
  'AGENTS.md',
  'AGENTS.legacy-read.md',
  'use_with_agent.md',
  'use_with_agent.claude-code.md',
  'use_with_agent.others.md',
  'preferences.md',
  'conduct.md',
]);
/** 根目錄下整個排除的資料夾。 */
const EXCLUDED_DIRS = new Set(['history', 'reports', '_injection-log', 'verification']);
const READING_RULES_TITLE = '讀取通則';
const FOLDER_INDEX = '_index.md';

/** 列舉比對範圍內的記憶檔（相對路徑、`/` 分隔、排序）。略過以 `.` 開頭的檔案與資料夾。 */
export function listMemoryFiles(root: string): string[] {
  const out: string[] = [];
  const walk = (rel: string) => {
    for (const d of fs.readdirSync(path.join(root, rel), { withFileTypes: true })) {
      if (d.name.startsWith('.')) continue;
      const child = rel === '' ? d.name : `${rel}/${d.name}`;
      if (d.isDirectory()) {
        if (rel === '' && EXCLUDED_DIRS.has(d.name)) continue;
        walk(child);
      } else if (d.isFile() && d.name.endsWith('.md')) {
        if (rel === '' && EXCLUDED_FILES.has(d.name)) continue;
        out.push(child);
      }
    }
  };
  walk('');
  return out.sort();
}

function stringList(v: unknown): string[] | undefined {
  if (v === undefined || v === null) return [];
  if (typeof v === 'string') return [v];
  if (Array.isArray(v) && v.every((x) => typeof x === 'string' || typeof x === 'number')) return v.map(String);
  return undefined;
}

function scalar(v: unknown): string | null {
  if (v instanceof Date) return v.toISOString();
  if (typeof v === 'string' || typeof v === 'number') return String(v);
  return null;
}

/** `areas/<name>/...` 的資料夾名；不在資料夾型 areas 內則 undefined。 */
function areaFolder(rel: string): string | undefined {
  const parts = rel.split('/');
  return parts.length >= 3 && parts[0] === 'areas' ? parts[1] : undefined;
}

interface AgentsInfo {
  taskTypes: TaskType[] | null;
  readingRules: string | null;
}

/**
 * 只讀 `AGENTS.md` 的「讀取通則」一節，不列舉記憶檔；session 開始用。
 * 讀不到或找不到該節時為 null，原因進 `notes`。
 */
export function loadReadingRules(root: string): { readingRules: string | null; notes: string[] } {
  const notes: string[] = [];
  const { readingRules } = loadAgents(root, notes, false);
  return { readingRules, notes };
}

function loadAgents(root: string, notes: string[], withTaskTypes = true): AgentsInfo {
  let src: string;
  try {
    src = cleanSource(fs.readFileSync(path.join(root, 'AGENTS.md'), 'utf8'));
  } catch (err) {
    notes.push(`AGENTS.md 讀不到：${err instanceof Error ? err.message : String(err)}`);
    return { taskTypes: null, readingRules: null };
  }
  const tree = parseMarkdown(src);
  const readingRules = extractSection(src, tree, READING_RULES_TITLE);
  if (readingRules === null) notes.push('AGENTS.md 找不到「讀取通則」一節');
  if (!withTaskTypes) return { taskTypes: null, readingRules };
  const taskTypes = extractTaskTypes(tree, notes);
  if (taskTypes === null) notes.push('任務類型表格解析失敗：AGENTS.md 沒有表頭含「任務類型」與「提示關鍵字」的表格');
  return { taskTypes, readingRules };
}

function loadFile(root: string, rel: string, taskTypes: TaskType[] | null, notes: string[]): MemoryFile | undefined {
  let src: string;
  try {
    src = cleanSource(fs.readFileSync(path.join(root, rel), 'utf8'));
  } catch (err) {
    notes.push(`${rel} 讀不到，已跳過：${err instanceof Error ? err.message : String(err)}`);
    return undefined;
  }
  const fm = splitFrontmatter(src);
  if (!fm.ok) {
    notes.push(`${rel} ${fm.reason}，已跳過`);
    return undefined;
  }
  const name = scalar(fm.data.name);
  if (name === null || name.trim() === '') {
    notes.push(`${rel} frontmatter 缺 name，已跳過`);
    return undefined;
  }

  const folder = areaFolder(rel);
  const isFolderIndex = folder !== undefined && rel === `areas/${folder}/${FOLDER_INDEX}`;
  const isFolderChild = folder !== undefined && !isFolderIndex;
  let aliases = stringList(fm.data.aliases);
  let repos = stringList(fm.data.repos);
  if (aliases === undefined) {
    notes.push(`${rel} 的 aliases 不是字串列表，已忽略`);
    aliases = [];
  }
  if (repos === undefined) {
    notes.push(`${rel} 的 repos 不是字串列表，已忽略`);
    repos = [];
  }
  if (isFolderChild && (aliases.length > 0 || repos.length > 0)) {
    const fields = [aliases.length > 0 && 'aliases', repos.length > 0 && 'repos'].filter(Boolean).join('、');
    notes.push(`${rel} 是資料夾型 areas 的子檔，設了 ${fields} 不參與比對，請改寫在 _index.md`);
    aliases = [];
    repos = [];
  }

  const frontmatterLines = src.slice(0, src.length - fm.body.length).split('\n').length - 1;
  const resolveTask = (heading: string): string | null => {
    const typeName = taskPrefixName(heading);
    if (typeName === undefined) return null;
    if (taskTypes === null) return null; // 表格解析失敗已另有提醒
    const hit = taskTypes.find((t) => normalize(t.name) === typeName);
    if (!hit) notes.push(`${rel} 的標題「${heading}」帶「任務：」前綴，但不在任務類型表內`);
    return hit?.name ?? null;
  };

  return {
    path: rel,
    name,
    displayName: isFolderIndex ? folder : name,
    description: scalar(fm.data.description) ?? '',
    aliases,
    repos,
    version: scalar(fm.data.version),
    folder: folder ?? null,
    isFolderIndex,
    entries: extractEntries(rel, fm.body, resolveTask, notes, frontmatterLines),
  };
}

/**
 * 解析整個記憶庫。單一檔的錯誤只進 `notes`，不丟例外；記憶庫路徑不存在時丟例外。
 */
export function loadMemory(root: string): Memory {
  if (!fs.statSync(root, { throwIfNoEntry: false })?.isDirectory()) {
    throw new Error(`記憶庫路徑不存在：${root}`);
  }
  const notes: string[] = [];
  const { taskTypes, readingRules } = loadAgents(root, notes);
  const rels = listMemoryFiles(root);
  for (const folder of new Set(rels.map(areaFolder).filter((f) => f !== undefined))) {
    if (!rels.includes(`areas/${folder}/${FOLDER_INDEX}`)) notes.push(`areas/${folder}/ 缺 ${FOLDER_INDEX}`);
  }
  const files = rels.flatMap((rel) => loadFile(root, rel, taskTypes, notes) ?? []);
  return { files, taskTypes, readingRules, notes };
}
