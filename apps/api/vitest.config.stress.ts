import { defineConfig } from 'vitest/config';
import tsconfigPaths from 'vite-tsconfig-paths';

export default defineConfig({
  plugins: [tsconfigPaths()],
  test: {
    globals: true,
    root: './',
    include: ['test/stress/**/*.stress.ts'],
    fileParallelism: false,
    testTimeout: 600_000,
    hookTimeout: 600_000,
  },
});
