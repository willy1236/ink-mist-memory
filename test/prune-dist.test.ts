import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { tempDir } from './helpers.js';

const SCRIPT = path.resolve('scripts/prune-dist.mjs');

function write(root: string, rel: string, content = ''): void {
  fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
  fs.writeFileSync(path.join(root, rel), content);
}

describe('scripts/prune-dist.mjs', () => {
  it('刪掉 dist 中沒有對應原始碼的 .js（如已刪除的訊號檔），其餘保留', () => {
    const root = tempDir();
    write(root, 'src/hook.ts');
    write(root, 'src/match/signals/cwd.ts');
    write(root, 'dist/hook.js');
    write(root, 'dist/match/signals/cwd.js');
    write(root, 'dist/match/signals/old.js');
    write(root, 'dist/notes.txt');
    fs.mkdirSync(path.join(root, 'dist/odd.js'));
    execFileSync(process.execPath, [SCRIPT], { cwd: root });
    expect(fs.existsSync(path.join(root, 'dist/match/signals/old.js'))).toBe(false);
    for (const kept of ['dist/hook.js', 'dist/match/signals/cwd.js', 'dist/notes.txt', 'dist/odd.js']) {
      expect(fs.existsSync(path.join(root, kept))).toBe(true);
    }
  });

  it('build 設定：編譯有錯時不輸出、也不跑 prune 與打包', () => {
    const tsconfig = JSON.parse(fs.readFileSync('tsconfig.build.json', 'utf8')) as { compilerOptions: Record<string, unknown> };
    expect(tsconfig.compilerOptions.noEmitOnError).toBe(true);
    const pkg = JSON.parse(fs.readFileSync('package.json', 'utf8')) as { scripts: Record<string, string> };
    expect(pkg.scripts.build).toMatch(/^tsc -p tsconfig\.build\.json && node scripts\/prune-dist\.mjs && node scripts\/bundle-handlers\.mjs$/);
  });
});
