// 編譯後刪掉 dist 中沒有對應 src/*.ts 的 .js（例如已刪除或改名的訊號檔）。
// 不在編譯前清空 dist：hook 直接執行 dist/hook.js，編譯失敗時 dist 仍要可用
// （tsconfig.build.json 設了 noEmitOnError，失敗時 dist 維持上一次成功的版本）。
// 以執行時的工作目錄為 repo 根目錄。
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';

const dist = path.resolve('dist');
const src = path.resolve('src');
if (fs.existsSync(dist)) {
  for (const rel of fs.readdirSync(dist, { recursive: true })) {
    if (!rel.endsWith('.js') || !fs.statSync(path.join(dist, rel)).isFile()) continue;
    if (fs.existsSync(path.join(src, rel.replace(/\.js$/, '.ts')))) continue;
    fs.rmSync(path.join(dist, rel));
    process.stdout.write(`已刪除舊檔 dist/${rel.split(path.sep).join('/')}\n`);
  }
}
