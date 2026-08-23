import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import aitDevtools from '@apps-in-toss/devtools/unplugin';
import { fileURLToPath, URL } from 'node:url';

export default defineConfig(({ mode }) => {
  const cleanWebPreview = mode === 'screenshot';
  const webPreviewAliases = process.env.VERCEL || cleanWebPreview ? {
    '@toss/tds-mobile': fileURLToPath(new URL('./src/web-preview/tds-mobile.tsx', import.meta.url)),
    '@toss/tds-mobile-ait': fileURLToPath(new URL('./src/web-preview/tds-mobile-ait.tsx', import.meta.url)),
  } : {};
  const devtoolsPlugin = process.env.AIT_DEVTOOLS === 'false' || cleanWebPreview ? [] : [aitDevtools.vite()];

  return {
    plugins: [...devtoolsPlugin, react()],
    resolve: { alias: webPreviewAliases },
    server: { port: 5173 },
    test: {
      environment: 'jsdom',
      setupFiles: './src/test/setup.ts',
      globals: true,
      css: true,
      exclude: ['work/**', 'node_modules/**', 'dist/**'],
    },
  };
});
