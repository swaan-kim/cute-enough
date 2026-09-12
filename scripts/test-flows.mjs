// Offline application checks only. No deployment, env-file loading or remote API smoke tests.
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { readdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = fileURLToPath(new URL('..', import.meta.url));
const mode = process.argv[2] ?? 'all';
if (!['all', 'server', 'regression'].includes(mode)) throw new Error(`Unknown flow suite: ${mode}`);
const env = { ...process.env };
for (const key of Object.keys(env)) {
  if (/^(VITE_|SUPABASE_|AIT_|TOSS_|REVIEW_|USER_HASH_SALT$)/.test(key)) delete env[key];
}
async function run(command, args) {
  console.log(`\nFlow check: ${command === process.execPath ? 'node' : path.basename(command)} ${args.join(' ')}`);
  await new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd: root, env, stdio: 'inherit', windowsHide: true });
    child.on('error', reject);
    child.on('exit', (code, signal) => code === 0 ? resolve() : reject(new Error(`Check failed (${code ?? signal})`)));
  });
}
const node = (args) => run(process.execPath, args);
async function server() {
  const migrationDir = path.join(root, 'supabase/migrations');
  const sqlTests = (await readdir(migrationDir)).filter((name) => name.endsWith('.node-test.mjs')).sort();
  if (!sqlTests.includes('multi-user-journey.node-test.mjs')) throw new Error('The multi-user SQL journey suite is missing.');
  await node(['--test', '--test-concurrency=2', ...sqlTests.map((name) => `supabase/migrations/${name}`)]);
  // These use an ephemeral localhost review server, injected HTTP responses,
  // temporary fixture binaries, or pure configuration validation only.
  await node(['--test', '--test-concurrency=2', 'tools/review-console/server.node-test.mjs',
    'scripts/ait-storage.node-test.mjs', 'scripts/validate-release.node-test.mjs', 'scripts/check-approved-pet-pool.node-test.mjs']);
  const denoCandidates = [process.env.DENO_BIN, path.join(root, 'node_modules/deno/deno.exe'), path.join(root, 'node_modules/deno/deno'),
    process.env.USERPROFILE && path.join(process.env.USERPROFILE, '.deno/bin/deno.exe')].filter(Boolean);
  const deno = denoCandidates.find(existsSync) ?? 'deno';
  const edgeTests = (await readdir(path.join(root, 'supabase/functions/pet-api'))).filter((name) => name.endsWith('.deno-test.ts')).sort();
  if (!edgeTests.length) throw new Error('The local Edge handler suite is missing.');
  await run(deno, ['test', '--no-check', '--cached-only', '--node-modules-dir=manual', '--allow-env', '--allow-read', '--allow-sys', '--deny-net', '--config', 'supabase/functions/deno.json',
    ...edgeTests.map((name) => `supabase/functions/pet-api/${name}`)]);
}
async function regression() {
  await node(['node_modules/vitest/vitest.mjs', 'run', '--configLoader', 'runner']);
  await node(['node_modules/typescript/bin/tsc', '-b', '--pretty', 'false']);
  await node(['node_modules/typescript/bin/tsc', '--project', 'tests/e2e/tsconfig.json', '--pretty', 'false']);
}
try {
  if (mode === 'server' || mode === 'all') await server();
  if (mode === 'regression' || mode === 'all') await regression();
  if (mode === 'all') await node(['node_modules/@playwright/test/cli.js', 'test']);
  if (mode === 'all') await node(['node_modules/@playwright/test/cli.js', 'test', '--config', 'playwright.dev.config.ts']);
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
}
