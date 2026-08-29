import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import react from '@vitejs/plugin-react';
import { createClient } from '@supabase/supabase-js';
import { createServer as createViteServer } from 'vite';
import {
  applySecurityHeaders,
  createReviewApiHandler,
  createSupabaseReviewGateway,
  loadReviewConfig,
} from './server-lib.mjs';

const currentDirectory = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(currentDirectory, '../..');
let config;
try {
  config = loadReviewConfig();
} catch {
  console.error(
    '검수 페이지 설정이 필요합니다. .env.review.example을 .env.review.local로 복사하고 Supabase 서버 전용 키를 입력해 주세요.',
  );
  process.exit(1);
}
const expectedOrigin = new URL(`http://${config.host}:${config.port}`).origin;
const expectedHost = new URL(expectedOrigin).host;

const supabase = createClient(config.supabaseUrl, config.secretKey, {
  auth: {
    autoRefreshToken: false,
    detectSessionInUrl: false,
    persistSession: false,
  },
});
const gateway = createSupabaseReviewGateway({
  actor: config.operatorId,
  client: supabase,
  supabaseUrl: config.supabaseUrl,
});
const handleApi = createReviewApiHandler({ expectedOrigin, gateway });
const vite = await createViteServer({
  appType: 'spa',
  configFile: false,
  envFile: false,
  optimizeDeps: {
    entries: [path.join(projectRoot, 'review.html')],
    include: ['react', 'react-dom/client', 'react/jsx-runtime'],
  },
  plugins: [react()],
  root: projectRoot,
  server: {
    fs: {
      deny: ['.env', '.env.*', '*.{crt,key,p12,pem,pfx}', '**/.git/**', 'pw.txt'],
      strict: true,
    },
    hmr: false,
    middlewareMode: true,
  },
});

const server = http.createServer(async (request, response) => {
  lockSecurityHeaders(response, expectedOrigin);
  if (request.headers.host !== expectedHost) {
    response.statusCode = 403;
    response.setHeader('Content-Type', 'text/plain; charset=utf-8');
    response.end('Forbidden');
    return;
  }

  try {
    if (await handleApi(request, response)) return;
  } catch {
    response.statusCode = 500;
    response.setHeader('Content-Type', 'text/plain; charset=utf-8');
    response.end('Internal server error');
    return;
  }

  const requestUrl = new URL(request.url ?? '/', expectedOrigin);
  if (request.method === 'GET' && (requestUrl.pathname === '/' || requestUrl.pathname === '/review')) {
    request.url = `/review.html${requestUrl.search}`;
  }

  vite.middlewares(request, response, () => {
    if (response.writableEnded) return;
    response.statusCode = 404;
    response.setHeader('Content-Type', 'text/plain; charset=utf-8');
    response.end('Not found');
  });
});

function lockSecurityHeaders(response, origin) {
  applySecurityHeaders(response, origin);
  const originalSetHeader = response.setHeader;
  response.setHeader = function setHeader(name, value) {
    if (String(name).toLowerCase() === 'cache-control') {
      return originalSetHeader.call(this, name, 'no-store');
    }
    return originalSetHeader.call(this, name, value);
  };
}

server.on('clientError', (_error, socket) => {
  if (socket.writable) socket.end('HTTP/1.1 400 Bad Request\r\nConnection: close\r\n\r\n');
});

await new Promise((resolve, reject) => {
  server.once('error', reject);
  server.listen(config.port, config.host, resolve);
});

console.log(`강아지 검수 콘솔: ${expectedOrigin}/review`);

let closing = false;
async function close() {
  if (closing) return;
  closing = true;
  await Promise.allSettled([
    new Promise((resolve) => server.close(resolve)),
    vite.close(),
  ]);
}

process.once('SIGINT', async () => {
  await close();
  process.exit(0);
});
process.once('SIGTERM', async () => {
  await close();
  process.exit(0);
});
