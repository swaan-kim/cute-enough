import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import aitDevtools from '@apps-in-toss/devtools/unplugin';
import { fileURLToPath, URL } from 'node:url';

const webPreviewAliases = process.env.VERCEL ? {
  '@toss/tds-mobile': fileURLToPath(new URL('./src/web-preview/tds-mobile.tsx', import.meta.url)),
  '@toss/tds-mobile-ait': fileURLToPath(new URL('./src/web-preview/tds-mobile-ait.tsx', import.meta.url)),
} : {};

export default defineConfig({
  plugins: [aitDevtools.vite(), react()],
  resolve: { alias: webPreviewAliases },
  server: { port: 5173 },
  test: {
    environment: 'jsdom',
    setupFiles: './src/test/setup.ts',
    globals: true,
    css: true,
    exclude: ['work/**', 'node_modules/**', 'dist/**'],
  },
});
