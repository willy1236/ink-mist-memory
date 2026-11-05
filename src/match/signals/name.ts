import { normalize } from '../../memory/normalize.js';
import { expandFolders } from '../files.js';
import type { Signal } from '../types.js';

/**
 * 名稱與 aliases 訊號：提示中出現某檔的名稱（資料夾型為資料夾名）或任一 alias 時，
 * 命中該檔（資料夾型為整個資料夾）全部條目。子字串比對，不分大小寫與全半形。
 * 資料夾型子檔的 name 不參與比對；其 aliases 已由解析層清空。
 */
const name: Signal = {
  name: 'name',
  level: 2,
  match(ctx, memory) {
    const prompt = normalize(ctx.prompt ?? '');
    if (prompt === '') return [];
    const hits = memory.files.filter((f) => {
      if (f.folder !== null && !f.isFolderIndex) return false;
      return [f.displayName, ...f.aliases].some((term) => {
        const t = normalize(term);
        return t !== '' && prompt.includes(t);
      });
    });
    return expandFolders(memory, hits).flatMap((f) => f.entries);
  },
};

export default name;
