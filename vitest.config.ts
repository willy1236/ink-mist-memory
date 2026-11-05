import os from 'node:os';
import path from 'node:path';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    globalSetup: ['test/global-setup.ts'],
    testTimeout: 15000,
    // 解析快取寫到暫存區，不碰使用者實際的快取資料夾
    env: { INK_MIST_CACHE_DIR: path.join(os.tmpdir(), 'ink-mist-memory-test-cache') },
  },
});
