import { defineConfig } from 'vitest/config'

// Export and font tests need real Chromium and Times New Roman, so they run on their own (npm run test:doc), not in CI.
export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/doc/**/*.test.ts'],
    testTimeout: 60000,
    hookTimeout: 60000,
  },
})
