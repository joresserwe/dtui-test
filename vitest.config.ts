import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: { include: ['tests/**/*.test.{ts,tsx}'], setupFiles: ['tests/helpers/setup-env.ts'], testTimeout: 10000, retry: 2 },
});
