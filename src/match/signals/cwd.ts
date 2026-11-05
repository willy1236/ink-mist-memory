import { expandFolders, isUnder } from '../files.js';
import type { Signal } from '../types.js';

/** 工作目錄訊號：工作目錄等於某檔 `repos` 之一或位於其下時，命中該檔（資料夾型為整個資料夾）全部條目。 */
const cwd: Signal = {
  name: 'cwd',
  level: 1,
  match(ctx, memory) {
    const hits = memory.files.filter((f) => f.repos.some((repo) => isUnder(ctx.cwd, repo)));
    return expandFolders(memory, hits).flatMap((f) => f.entries);
  },
};

export default cwd;
