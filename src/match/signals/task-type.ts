import type { MemoryFile } from '../../memory/index.js';
import { normalize } from '../../memory/normalize.js';
import { isUnder } from '../files.js';
import type { Signal } from '../types.js';

/**
 * 任務類型訊號：提示含某任務類型的任一關鍵字時，命中各檔 `## 任務：<類型>` 標題下的條目
 * （含其下巢狀標題，歸屬由解析層判定）。子字串比對，不分大小寫與全半形。
 * 帶 `repos` 的專案檔（資料夾型看 `_index.md`）只在工作目錄屬於該專案時才命中，
 * 免得別的專案的規範跟著關鍵字進來。
 * 任務類型表格解析失敗時停用本訊號並寫提醒。
 */
const taskType: Signal = {
  name: 'task-type',
  level: 3,
  match(ctx, memory) {
    if (memory.taskTypes === null) return { entries: [], notes: ['本訊號停用'] }; // 原因已由解析層寫提醒
    const prompt = normalize(ctx.prompt ?? '');
    if (prompt === '') return [];
    const types = new Set(
      memory.taskTypes
        .filter((t) => t.keywords.some((k) => {
          const kw = normalize(k);
          return kw !== '' && prompt.includes(kw);
        }))
        .map((t) => t.name),
    );
    if (types.size === 0) return [];
    const inScope = (f: MemoryFile) => {
      const owner = f.folder === null ? f : memory.files.find((x) => x.isFolderIndex && x.folder === f.folder);
      const repos = owner?.repos ?? [];
      return repos.length === 0 || repos.some((repo) => isUnder(ctx.cwd, repo));
    };
    return memory.files
      .filter(inScope)
      .flatMap((f) => f.entries.filter((e) => e.taskType !== null && types.has(e.taskType)));
  },
};

export default taskType;
