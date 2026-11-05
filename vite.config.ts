/// <reference types="vitest/config" />
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  test: {
    environment: 'jsdom',
    globals: true,
    env: { VITE_SUPABASE_URL: 'http://127.0.0.1:57421', VITE_SUPABASE_ANON_KEY: 'test-anon-key' },
    setupFiles: ['./src/test-setup.ts'],
    include: ['src/**/*.test.{ts,tsx}', 'tests/unit/**/*.test.ts'],
    exclude: ['tests/integration/**', 'e2e/**', 'node_modules/**'],
  },
})
