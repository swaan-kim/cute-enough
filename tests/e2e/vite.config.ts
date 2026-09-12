import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';

// Load normal index.html/main.tsx, real TDS, API client and ad controller.
// Only the external native host boundary has an alias.
export default defineConfig({
  root: fileURLToPath(new URL('../..', import.meta.url)),
  cacheDir: 'node_modules/.vite-e2e',
  envDir: fileURLToPath(new URL('./no-env-files', import.meta.url)),
  plugins: [react()],
  define: {
    'import.meta.env.VITE_APP_RUNTIME': JSON.stringify('production'),
    'import.meta.env.VITE_ADS_ENABLED': JSON.stringify('true'),
    'import.meta.env.VITE_ADS_TEST_MODE': JSON.stringify('false'),
    'import.meta.env.VITE_AD_DIAGNOSTICS': JSON.stringify('false'),
    'import.meta.env.VITE_REWARDED_AD_GROUP_ID': JSON.stringify('local-browser-reward-group'),
    'import.meta.env.VITE_SUPABASE_URL': JSON.stringify('http://127.0.0.1:4179/e2e-api'),
    'import.meta.env.VITE_SUPABASE_ANON_KEY': JSON.stringify('local-fixture-public-key'),
  },
  resolve: {
    alias: { '@apps-in-toss/web-framework': fileURLToPath(new URL('./native-sdk.ts', import.meta.url)) },
    dedupe: ['react', 'react-dom', '@emotion/react'],
  },
  server: { host: '127.0.0.1', port: 4179, strictPort: true },
});
