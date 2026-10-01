import { defineConfig } from 'vitest/config';
import tsconfigPaths from 'vite-tsconfig-paths';

export default defineConfig({
  plugins: [tsconfigPaths()],
  test: {
    globals: true,
    // Many logins from one IP; the rate-limit test turns limits back on for itself.
    env: { RATE_LIMITS: 'false' },
    root: './',
    include: ['**/*.e2e-spec.ts'],
    // Test files share one database, so they run one after another.
    fileParallelism: false,
  },
});
