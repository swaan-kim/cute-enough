const APPS_IN_TOSS_ORIGINS = new Set([
  'https://cute-enough.apps.tossmini.com',
  'https://cute-enough.private-apps.tossmini.com',
]);

function extraLocalOrigins(): Set<string> {
  if (Deno.env.get('AIT_RUNTIME_ENV') !== 'local') return new Set();
  return new Set((Deno.env.get('AIT_LOCAL_CORS_ORIGINS') ?? 'http://localhost:5173,http://localhost:5174')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean));
}

export function isAllowedOrigin(request: Request): boolean {
  const origin = request.headers.get('Origin');
  if (!origin) return true;
  return APPS_IN_TOSS_ORIGINS.has(origin) || extraLocalOrigins().has(origin);
}

export function corsHeaders(request: Request): Record<string, string> {
  const origin = request.headers.get('Origin');
  return {
    ...(origin && isAllowedOrigin(request) ? { 'Access-Control-Allow-Origin': origin } : {}),
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Max-Age': '600',
    'Vary': 'Origin',
  };
}

export function json(request: Request, data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders(request), 'Content-Type': 'application/json; charset=utf-8' },
  });
}
