// This development server never reads .env files or starts an AIT build.
import { createServer } from 'vite';
import { fileURLToPath } from 'node:url';

for (const name of Object.keys(process.env)) {
  if (name.startsWith('VITE_') || name === 'VERCEL') delete process.env[name];
}
// Match deployed React by default; the separate smoke run exercises StrictMode
// development effect cleanup/remount through the same normal application entry.
process.env.NODE_ENV = process.argv.includes('--development') ? 'development' : 'production';
const server = await createServer({
  configFile: fileURLToPath(new URL('../tests/e2e/vite.config.ts', import.meta.url)),
  envFile: false,
});
await server.listen();
server.printUrls();
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, async () => {
  await server.close();
  process.exit(0);
});
