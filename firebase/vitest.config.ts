import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['firebase/tests/**/*.test.ts'],
    testTimeout: 20000,
    hookTimeout: 60000,
    fileParallelism: false,
  },
});
