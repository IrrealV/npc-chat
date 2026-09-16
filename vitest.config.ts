import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/codex-*.test.ts'],
    testTimeout: 5000,
    cache: false,
  },
});
