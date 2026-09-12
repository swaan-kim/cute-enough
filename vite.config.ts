import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import aitDevtools from '@apps-in-toss/devtools/unplugin';
import { fileURLToPath, URL } from 'node:url';

export default defineConfig(({ command, mode }) => {
  const cleanWebPreview = mode === 'screenshot';
  const webPreviewAliases = process.env.VERCEL || cleanWebPreview ? {
    '@toss/tds-mobile': fileURLToPath(new URL('./src/web-preview/tds-mobile.tsx', import.meta.url)),
    '@toss/tds-mobile-ait': fileURLToPath(new URL('./src/web-preview/tds-mobile-ait.tsx', import.meta.url)),
  } : {};
  const enableDevtools =
    command === 'serve' && process.env.AIT_DEVTOOLS !== 'false' && !cleanWebPreview;
  const devtoolsPlugin = enableDevtools ? [aitDevtools.vite()] : [];

  return {
    plugins: [...devtoolsPlugin, react()],
    resolve: {
      alias: webPreviewAliases,
      // Lazy-loaded TDS screens must resolve the same React/Emotion instances as
      // the home bundle. Without this, Vite dev can optimize a second copy and
      // the upload/my-pets routes fail with an invalid hook call.
      dedupe: ['react', 'react-dom', '@emotion/react'],
    },
    server: { port: 5173 },
    test: {
      environment: 'jsdom',
      setupFiles: './src/test/setup.ts',
      globals: true,
      css: true,
      exclude: ['work/**', 'node_modules/**', 'dist/**', '.tmp/**', 'AIT/**', 'tests/e2e/**', 'e2e/**', '**/*.deno-test.ts'],
    },
  };
});
