/** 沒有 `--memory-root` 時改讀的環境變數，給無法在 hook 指令帶參數的平台用。 */
export const MEMORY_ROOT_ENV = 'INK_MIST_MEMORY_ROOT';

function option(argv: readonly string[], name: string): string | undefined {
  const i = argv.indexOf(name);
  const value = i >= 0 ? argv[i + 1] : undefined;
  return value && !value.startsWith('--') ? value : undefined;
}

/** 記憶庫路徑：`--memory-root <路徑>` 優先，其次環境變數 `INK_MIST_MEMORY_ROOT`；都沒有時為 undefined。 */
export function parseMemoryRoot(argv: readonly string[], env: NodeJS.ProcessEnv = process.env): string | undefined {
  return option(argv, '--memory-root') ?? (env[MEMORY_ROOT_ENV] || undefined);
}

/** 取 `--platform <名稱>`；未指定時為 undefined，由呼叫端用預設平台。 */
export function parsePlatformName(argv: readonly string[]): string | undefined {
  return option(argv, '--platform');
}
