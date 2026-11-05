// 把 tsc 編出的處理函式模組與比對訊號檔連同相依各自打包成單檔，原地覆蓋 dist 下的同名檔。
// 訊號檔由管線在執行時動態載入（dist/match/signals/），不會被打包進處理函式，所以也各自打包。
// 原因：處理函式每次 hook 都在新行程的 worker 冷載入，未打包時要讀約 200 個
// node_modules 小檔，磁碟忙碌時會吃掉大半 3 秒預算；單檔只讀一次。
// 先打包到暫存檔，全部成功才覆蓋：失敗時 dist 維持 tsc 的版本，hook 仍可用。
// 檔名與 src 對應，prune-dist 不會刪掉。以執行時的工作目錄為 repo 根目錄。
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { build } from 'esbuild';

const dist = path.resolve('dist');
const signalsDir = path.join(dist, 'match', 'signals');
const targets = [
  ...['session-start', 'user-prompt-submit'].map((n) => path.join(dist, 'handlers', `${n}.js`)),
  ...fs.readdirSync(signalsDir).filter((f) => f.endsWith('.js')).map((f) => path.join(signalsDir, f)),
];
const tmpOf = (target) => target.replace(/\.js$/, '.bundle.tmp');
// yaml 等 CJS 相依會 require node 內建模組，ESM bundle 需要自備 require
const BANNER = "import { createRequire as __inkMistCreateRequire } from 'node:module';\nconst require = __inkMistCreateRequire(import.meta.url);";

try {
  for (const target of targets) {
    await build({
      entryPoints: [target],
      outfile: tmpOf(target),
      bundle: true,
      platform: 'node',
      format: 'esm',
      target: 'node22',
      minify: true,
      banner: { js: BANNER },
      logLevel: 'warning',
    });
  }
  for (const target of targets) fs.renameSync(tmpOf(target), target);
  process.stdout.write(`已打包 ${targets.map((t) => path.relative(dist, t).split(path.sep).join('/')).join('、')}\n`);
} catch (err) {
  for (const target of targets) fs.rmSync(tmpOf(target), { force: true });
  process.stderr.write(`打包處理函式失敗，dist 維持未打包版本：${err instanceof Error ? err.message : String(err)}\n`);
  process.exitCode = 1;
}
