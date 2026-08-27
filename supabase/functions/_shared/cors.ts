const APPS_IN_TOSS_ORIGINS = new Set([
  'https://cute-enough.web.tossmini.com',
  'https://cute-enough.private-web.tossmini.com',
  'https://cute-enough.apps.tossmini.com',
  'https://cute-enough.private-apps.tossmini.com',
]);

export function isAllowedOrigin(request: Request): boolean {
  const origin = request.headers.get('Origin');
  if (!origin) return true;
  return APPS_IN_TOSS_ORIGINS.has(origin);
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

export function preflight(request: Request): Response {
  return new Response(null, { status: 204, headers: corsHeaders(request) });
}

export function corsGuard(request: Request): Response | null {
  if (!isAllowedOrigin(request)) {
    return json(request, { error: '허용되지 않은 요청이에요.', code: 'ORIGIN_NOT_ALLOWED' }, 403);
  }
  return request.method === 'OPTIONS' ? preflight(request) : null;
}
