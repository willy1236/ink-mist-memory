import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';

/** e2e 測試直接執行 dist/hook.js，先照 build 流程編譯、刪舊檔、打包處理函式。 */
export default function setup(): void {
  const require = createRequire(import.meta.url);
  const tsc = require.resolve('typescript/bin/tsc');
  execFileSync(process.execPath, [tsc, '-p', 'tsconfig.build.json'], { stdio: 'inherit' });
  execFileSync(process.execPath, ['scripts/prune-dist.mjs'], { stdio: 'inherit' });
  execFileSync(process.execPath, ['scripts/bundle-handlers.mjs'], { stdio: 'inherit' });
}
