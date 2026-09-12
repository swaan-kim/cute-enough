import { defineConfig } from '@playwright/test';
import production from './playwright.config.ts';

export default defineConfig({
  ...production,
  testMatch: '**/development-smoke.spec.ts',
  testIgnore: [],
  outputDir: 'test-results/development',
  reporter: [['list'], ['html', { outputFolder: 'playwright-report/development', open: 'never' }]],
  projects: [{ name: 'development-strictmode-390', use: { viewport: { width: 390, height: 844 } } }],
  webServer: {
    command: 'node scripts/test-flows-vite.mjs --development',
    url: 'http://127.0.0.1:4179',
    reuseExistingServer: false,
    timeout: 60_000,
  },
});
