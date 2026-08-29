import { randomBytes, randomUUID } from 'node:crypto';

export const REVIEW_HOST = '127.0.0.1';
export const SIGNED_PHOTO_TTL_SECONDS = 180;
export const DEFAULT_BODY_LIMIT_BYTES = 16 * 1024;
export const DEFAULT_PHOTO_LIMIT_BYTES = 8 * 1024 * 1024;

const UUID_PATTERN = /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i;
const SAFE_RPC_CONFLICTS = new Set(['PET_NOT_PENDING', 'PET_PHOTO_MISSING']);
const ALLOWED_IMAGE_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);
const FALLBACK_TRAITS = Object.freeze({
  schemaVersion: 1,
  earShape: 'floppy',
  headShape: 'round',
  baseColor: 'cream',
  secondaryColor: 'white',
  markingPattern: 'none',
  muzzle: 'short',
  confidence: 0,
});

class PublicHttpError extends Error {
  constructor(status, code) {
    super(code);
    this.name = 'PublicHttpError';
    this.status = status;
    this.code = code;
  }
}

class UpstreamError extends Error {
  constructor(operation, cause) {
    super(operation);
    this.name = 'UpstreamError';
    this.operation = operation;
    this.cause = cause;
  }
}

export function loadReviewConfig(env = process.env) {
  const supabaseUrl = requiredEnv(env, 'REVIEW_SUPABASE_URL');
  const secretKey = optionalEnv(env, 'REVIEW_SUPABASE_SECRET_KEY')
    ?? optionalEnv(env, 'REVIEW_SUPABASE_SERVICE_ROLE_KEY');
  if (!secretKey) {
    throw new Error('REVIEW_SUPABASE_SECRET_KEY or REVIEW_SUPABASE_SERVICE_ROLE_KEY is required.');
  }
  const parsedUrl = parseHttpUrl(supabaseUrl, 'REVIEW_SUPABASE_URL');
  enforceSecureSupabaseUrl(parsedUrl);
  const port = parsePort(env.REVIEW_PORT ?? '4178');
  const operatorId = (env.REVIEW_OPERATOR_ID ?? env.REVIEW_ACTOR ?? 'local-review-console').trim();

  if (!operatorId || operatorId.length > 100) {
    throw new Error('REVIEW_OPERATOR_ID must be between 1 and 100 characters.');
  }

  return Object.freeze({
    host: REVIEW_HOST,
    operatorId,
    port,
    secretKey,
    supabaseUrl: parsedUrl.origin,
  });
}

export function createSupabaseReviewGateway({ client, supabaseUrl, actor }) {
  if (!client) throw new TypeError('A Supabase client is required.');
  const expectedStorageOrigin = parseHttpUrl(supabaseUrl, 'supabaseUrl').origin;

  return Object.freeze({
    async listPending() {
      const { data, error } = await client
        .from('pending_pet_review_queue')
        .select('pet_id,name,traits,created_at,storage_paths,photo_present')
        .order('created_at', { ascending: false });

      if (error) throw new UpstreamError('QUEUE_QUERY_FAILED', error);

      return Promise.all((Array.isArray(data) ? data : []).map(async (row) => {
        const storagePaths = Array.isArray(row.storage_paths)
          ? row.storage_paths.filter((path) => typeof path === 'string' && path.length > 0)
          : [];

        const signedResults = await Promise.allSettled(storagePaths.map(async (storagePath) => {
          const { data: signed, error: signError } = await client.storage
            .from('pet-photos')
            .createSignedUrl(storagePath, SIGNED_PHOTO_TTL_SECONDS);

          if (signError || typeof signed?.signedUrl !== 'string') {
            throw new UpstreamError('PHOTO_SIGNING_FAILED', signError);
          }

          return validateSignedPhotoUrl(signed.signedUrl, expectedStorageOrigin);
        }));
        const signedPhotoUrls = signedResults
          .filter((result) => result.status === 'fulfilled')
          .map((result) => result.value);

        return {
          petId: row.pet_id,
          name: typeof row.name === 'string' && row.name.trim() ? row.name.trim() : '이름 없음',
          traits: isPlainRecord(row.traits) ? row.traits : FALLBACK_TRAITS,
          createdAt: row.created_at,
          photoPresent: row.photo_present === true && signedPhotoUrls.length > 0,
          signedPhotoUrls,
        };
      }));
    },

    async review({ petId, decision, reason }) {
      const { data, error } = await client.rpc('review_pet_submission', {
        p_pet_id: petId,
        p_decision: decision,
        p_actor: actor,
        p_reason: reason,
      });

      if (error) {
        const safeConflict = findSafeRpcConflict(error);
        if (safeConflict) throw new PublicHttpError(409, safeConflict);
        throw new UpstreamError('REVIEW_RPC_FAILED', error);
      }

      return typeof data === 'string' ? data : decision;
    },
  });
}

export class PhotoTokenStore {
  constructor({ now = Date.now, randomToken = () => randomBytes(32).toString('base64url'), maxEntries = 4096 } = {}) {
    this.entries = new Map();
    this.maxEntries = maxEntries;
    this.now = now;
    this.randomToken = randomToken;
  }

  issue(signedUrl, ttlSeconds = SIGNED_PHOTO_TTL_SECONDS) {
    this.purgeExpired();
    while (this.entries.size >= this.maxEntries) {
      this.entries.delete(this.entries.keys().next().value);
    }

    let token;
    do token = this.randomToken(); while (this.entries.has(token));
    this.entries.set(token, {
      expiresAt: this.now() + ttlSeconds * 1000,
      signedUrl,
    });
    return token;
  }

  consume(token) {
    const entry = this.entries.get(token);
    if (!entry) return null;
    if (entry.expiresAt <= this.now()) {
      this.entries.delete(token);
      return null;
    }
    return entry.signedUrl;
  }

  purgeExpired() {
    const currentTime = this.now();
    for (const [token, entry] of this.entries) {
      if (entry.expiresAt <= currentTime) this.entries.delete(token);
    }
  }
}

export function applySecurityHeaders(response, expectedOrigin) {
  const connectSource = expectedOrigin.replace(/^http:/, 'ws:');
  response.setHeader(
    'Content-Security-Policy',
    `default-src 'self'; base-uri 'none'; connect-src 'self' ${connectSource}; font-src 'self'; form-action 'self'; frame-ancestors 'none'; img-src 'self' data: blob:; object-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'`,
  );
  response.setHeader('Cache-Control', 'no-store');
  response.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
  response.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
  response.setHeader('Permissions-Policy', 'camera=(), geolocation=(), microphone=()');
  response.setHeader('Referrer-Policy', 'no-referrer');
  response.setHeader('X-Content-Type-Options', 'nosniff');
  response.setHeader('X-Frame-Options', 'DENY');
}

export function createReviewApiHandler({
  expectedOrigin,
  gateway,
  tokenStore = new PhotoTokenStore(),
  fetchFn = globalThis.fetch,
  bodyLimitBytes = DEFAULT_BODY_LIMIT_BYTES,
  photoLimitBytes = DEFAULT_PHOTO_LIMIT_BYTES,
  logger = console,
}) {
  if (typeof fetchFn !== 'function') throw new TypeError('A fetch implementation is required.');
  if (!gateway) throw new TypeError('A review gateway is required.');
  const allowedOrigin = parseHttpUrl(expectedOrigin, 'expectedOrigin').origin;
  const allowedHost = new URL(allowedOrigin).host;

  return async function handleReviewApi(request, response) {
    const url = new URL(request.url ?? '/', allowedOrigin);
    const isQueueRoute = url.pathname === '/api/review-queue';
    const isReviewRoute = url.pathname === '/api/review';
    const photoToken = parsePhotoToken(url.pathname);

    if (!isQueueRoute && !isReviewRoute && !photoToken) return false;

    const requestId = randomUUID();
    try {
      enforceSameOrigin(request, allowedOrigin, allowedHost, isReviewRoute);

      if (isQueueRoute) {
        if (request.method !== 'GET') throw new PublicHttpError(405, 'METHOD_NOT_ALLOWED');
        const rows = await gateway.listPending();
        const items = rows.map((row) => ({
          petId: row.petId,
          name: row.name,
          traits: row.traits,
          createdAt: row.createdAt,
          photoPresent: row.photoPresent,
          photoUrls: row.signedPhotoUrls.map((signedUrl) => {
            const token = tokenStore.issue(signedUrl, SIGNED_PHOTO_TTL_SECONDS);
            return `/api/review-photo/${token}`;
          }),
        }));
        writeJson(response, 200, { items });
        return true;
      }

      if (isReviewRoute) {
        if (request.method !== 'POST') throw new PublicHttpError(405, 'METHOD_NOT_ALLOWED');
        enforceJsonContentType(request);
        const body = await readJsonBody(request, bodyLimitBytes);
        const input = validateReviewInput(body);
        const status = await gateway.review(input);
        writeJson(response, 200, { petId: input.petId, status });
        return true;
      }

      if (request.method !== 'GET') throw new PublicHttpError(405, 'METHOD_NOT_ALLOWED');
      const signedUrl = tokenStore.consume(photoToken);
      if (!signedUrl) throw new PublicHttpError(404, 'PHOTO_LINK_EXPIRED');
      await proxyPhoto(response, signedUrl, fetchFn, photoLimitBytes);
      return true;
    } catch (error) {
      const status = error instanceof PublicHttpError
        ? error.status
        : error instanceof UpstreamError
          ? 502
          : 500;
      const code = error instanceof PublicHttpError
        ? error.code
        : error instanceof UpstreamError
          ? 'UPSTREAM_ERROR'
          : 'INTERNAL_ERROR';

      logSafeError(logger, { requestId, route: url.pathname, status, error });
      if (!response.headersSent) writeJson(response, status, { error: code, requestId });
      else response.destroy();
      return true;
    }
  };
}

export function validateReviewInput(value) {
  if (!isPlainRecord(value)) throw new PublicHttpError(400, 'INVALID_REVIEW_REQUEST');
  const allowedKeys = new Set(['petId', 'decision', 'reason']);
  if (Object.keys(value).some((key) => !allowedKeys.has(key))) {
    throw new PublicHttpError(400, 'INVALID_REVIEW_REQUEST');
  }

  const petId = typeof value.petId === 'string' ? value.petId.trim().toLowerCase() : '';
  if (!UUID_PATTERN.test(petId)) throw new PublicHttpError(400, 'INVALID_PET_ID');
  if (value.decision !== 'approved' && value.decision !== 'rejected') {
    throw new PublicHttpError(400, 'INVALID_REVIEW_DECISION');
  }

  const rawReason = value.reason;
  if (rawReason !== undefined && rawReason !== null && typeof rawReason !== 'string') {
    throw new PublicHttpError(400, 'INVALID_REVIEW_REASON');
  }
  const trimmedReason = typeof rawReason === 'string' ? rawReason.trim() : '';
  if (trimmedReason.length > 500) throw new PublicHttpError(400, 'INVALID_REVIEW_REASON');
  if (value.decision === 'rejected' && !trimmedReason) {
    throw new PublicHttpError(400, 'REJECTION_REASON_REQUIRED');
  }
  if (value.decision === 'approved' && trimmedReason) {
    throw new PublicHttpError(400, 'APPROVAL_REASON_NOT_ALLOWED');
  }

  return {
    petId,
    decision: value.decision,
    reason: value.decision === 'rejected' ? trimmedReason : null,
  };
}

function requiredEnv(env, name) {
  const value = env[name];
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${name} is required.`);
  return value.trim();
}

function optionalEnv(env, name) {
  const value = env[name];
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function parsePort(value) {
  if (!/^\d+$/.test(value)) throw new Error('REVIEW_PORT must be an integer between 1 and 65535.');
  const port = Number(value);
  if (!Number.isSafeInteger(port) || port < 1 || port > 65535) {
    throw new Error('REVIEW_PORT must be an integer between 1 and 65535.');
  }
  return port;
}

function parseHttpUrl(value, label) {
  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error(`${label} must be a valid HTTP(S) URL.`);
  }
  if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password) {
    throw new Error(`${label} must be a valid HTTP(S) URL.`);
  }
  return parsed;
}

function enforceSecureSupabaseUrl(parsed) {
  const localHosts = new Set(['127.0.0.1', 'localhost', '[::1]']);
  if (parsed.protocol !== 'https:' && !localHosts.has(parsed.hostname)) {
    throw new Error('REVIEW_SUPABASE_URL must use HTTPS (HTTP is allowed only for local Supabase).');
  }
}

function validateSignedPhotoUrl(value, expectedOrigin) {
  const parsed = parseHttpUrl(value, 'signed photo URL');
  const expectedPrefix = '/storage/v1/object/sign/pet-photos/';
  if (parsed.origin !== expectedOrigin || !parsed.pathname.startsWith(expectedPrefix)) {
    throw new UpstreamError('INVALID_SIGNED_PHOTO_URL');
  }
  return parsed.href;
}

function findSafeRpcConflict(error) {
  const source = [error?.message, error?.details, error?.hint]
    .filter((part) => typeof part === 'string')
    .join(' ');
  for (const code of SAFE_RPC_CONFLICTS) {
    if (source.includes(code)) return code;
  }
  return null;
}

function isPlainRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function parsePhotoToken(pathname) {
  const match = /^\/api\/review-photo\/([A-Za-z0-9_-]{20,128})$/.exec(pathname);
  return match?.[1] ?? null;
}

function enforceSameOrigin(request, expectedOrigin, expectedHost, requireOrigin) {
  if (request.headers.host !== expectedHost) throw new PublicHttpError(403, 'FORBIDDEN_ORIGIN');
  const origin = request.headers.origin;
  if ((requireOrigin && origin !== expectedOrigin) || (origin && origin !== expectedOrigin)) {
    throw new PublicHttpError(403, 'FORBIDDEN_ORIGIN');
  }
  const fetchSite = request.headers['sec-fetch-site'];
  if (fetchSite && fetchSite !== 'same-origin' && fetchSite !== 'none') {
    throw new PublicHttpError(403, 'FORBIDDEN_ORIGIN');
  }
}

function enforceJsonContentType(request) {
  const contentType = request.headers['content-type']?.split(';', 1)[0]?.trim().toLowerCase();
  if (contentType !== 'application/json') throw new PublicHttpError(415, 'JSON_CONTENT_TYPE_REQUIRED');
  const contentEncoding = request.headers['content-encoding'];
  if (contentEncoding && contentEncoding.toLowerCase() !== 'identity') {
    throw new PublicHttpError(415, 'CONTENT_ENCODING_NOT_SUPPORTED');
  }
}

async function readJsonBody(request, limitBytes) {
  const declaredLength = Number(request.headers['content-length']);
  if (Number.isFinite(declaredLength) && declaredLength > limitBytes) {
    request.resume();
    throw new PublicHttpError(413, 'REQUEST_BODY_TOO_LARGE');
  }

  const chunks = [];
  let total = 0;
  for await (const chunk of request) {
    total += chunk.length;
    if (total > limitBytes) throw new PublicHttpError(413, 'REQUEST_BODY_TOO_LARGE');
    chunks.push(chunk);
  }

  if (total === 0) throw new PublicHttpError(400, 'INVALID_JSON');
  try {
    return JSON.parse(Buffer.concat(chunks, total).toString('utf8'));
  } catch {
    throw new PublicHttpError(400, 'INVALID_JSON');
  }
}

async function proxyPhoto(response, signedUrl, fetchFn, limitBytes) {
  let upstream;
  try {
    upstream = await fetchFn(signedUrl, {
      headers: { Accept: 'image/jpeg,image/png,image/webp' },
      redirect: 'error',
      signal: AbortSignal.timeout(10_000),
    });
  } catch (error) {
    throw new UpstreamError('PHOTO_FETCH_FAILED', error);
  }
  if (!upstream.ok) throw new UpstreamError('PHOTO_FETCH_FAILED');

  const contentType = upstream.headers.get('content-type')?.split(';', 1)[0]?.trim().toLowerCase();
  if (!contentType || !ALLOWED_IMAGE_TYPES.has(contentType)) {
    throw new UpstreamError('UNEXPECTED_PHOTO_TYPE');
  }

  const declaredLength = Number(upstream.headers.get('content-length'));
  if (Number.isFinite(declaredLength) && declaredLength > limitBytes) {
    throw new UpstreamError('PHOTO_TOO_LARGE');
  }

  const body = await readResponseBody(upstream, limitBytes);
  response.statusCode = 200;
  response.setHeader('Content-Type', contentType);
  response.setHeader('Content-Length', body.length);
  response.end(body);
}

async function readResponseBody(response, limitBytes) {
  if (!response.body) return Buffer.alloc(0);
  const reader = response.body.getReader();
  const chunks = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > limitBytes) {
        await reader.cancel();
        throw new UpstreamError('PHOTO_TOO_LARGE');
      }
      chunks.push(Buffer.from(value));
    }
  } finally {
    reader.releaseLock();
  }
  return Buffer.concat(chunks, total);
}

function writeJson(response, status, payload) {
  const body = JSON.stringify(payload);
  response.statusCode = status;
  response.setHeader('Content-Type', 'application/json; charset=utf-8');
  response.setHeader('Content-Length', Buffer.byteLength(body));
  response.end(body);
}

function logSafeError(logger, { requestId, route, status, error }) {
  if (!logger || typeof logger.error !== 'function') return;
  const operation = error instanceof UpstreamError ? error.operation : undefined;
  logger.error('[review-console] request failed', { operation, requestId, route, status });
}
