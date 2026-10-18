import path from 'node:path';
import { fileURLToPath } from 'node:url';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

/**
 * The dev server proxies the API so the browser only ever talks to one origin.
 * The API now authenticates with a bearer JWT (issued by Neon Auth), so the
 * proxy exists for path convenience rather than for same-site cookies.
 */
const API_TARGET = 'http://localhost:4100';

/**
 * The shared configuration lives in one `.env` at the repository root, so Vite
 * must read it from there instead of from `packages/web`.
 */
const HERE = fileURLToPath(new URL('.', import.meta.url));
const REPO_ROOT = path.resolve(HERE, '../..');

export default defineConfig({
  envDir: REPO_ROOT,
  plugins: [react()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  server: {
    port: 5273,
    strictPort: true,
    proxy: {
      '/api': { target: API_TARGET, changeOrigin: true },
      '/health': { target: API_TARGET, changeOrigin: true },
    },
  },
  build: {
    outDir: 'dist',
    sourcemap: true,
  },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: './src/test/setup.ts',
    css: false,
    include: ['src/**/*.{test,spec}.{ts,tsx}'],
    restoreMocks: true,
    // The auth client requires a URL at import time; tests never reach the
    // network because they inject their own token provider.
    env: {
      VITE_NEON_AUTH_URL: 'http://localhost:5273/auth',
    },
  },
});
