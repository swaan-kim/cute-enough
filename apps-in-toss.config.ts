import { defineConfig } from '@apps-in-toss/web-framework/config';

export default defineConfig({
  appName: 'cute-enough',
  brand: {
    primaryColor: '#FF6B8A',
  },
  webView: {},
  permissions: [{ name: 'photos', access: 'read' }],
  webBundleDir: 'dist',
});
