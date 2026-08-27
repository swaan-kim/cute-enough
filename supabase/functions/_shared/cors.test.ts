import { describe, expect, it } from 'vitest';
import { corsGuard, corsHeaders, isAllowedOrigin } from './cors.ts';

const allowedOrigins = [
  'https://cute-enough.web.tossmini.com',
  'https://cute-enough.private-web.tossmini.com',
  'https://cute-enough.apps.tossmini.com',
  'https://cute-enough.private-apps.tossmini.com',
];

function request(origin?: string, method = 'OPTIONS'): Request {
  return new Request('https://example.supabase.co/functions/v1/pet-api', {
    method,
    headers: origin === undefined ? undefined : { Origin: origin },
  });
}

describe('pet-api CORS', () => {
  it.each(allowedOrigins)('allows %s and reflects it on a 204 preflight', (origin) => {
    const incoming = request(origin);
    const response = corsGuard(incoming);

    expect(isAllowedOrigin(incoming)).toBe(true);
    expect(response).not.toBeNull();
    expect(response.status).toBe(204);
    expect(response.body).toBeNull();
    expect(response.headers.get('Access-Control-Allow-Origin')).toBe(origin);
    expect(response.headers.get('Access-Control-Allow-Methods')).toBe('POST, OPTIONS');
    expect(response.headers.get('Vary')).toBe('Origin');
  });

  it.each([
    '*',
    'null',
    'file://',
    'toss://cute-enough',
    'http://cute-enough.web.tossmini.com',
    'https://cute-enough.web.tossmini.com/',
    'https://cute-enough.web.tossmini.com:444',
    'https://cute-enough.preview.tossmini.com',
    'https://cute-enough.private-web.tossmini.com.attacker.example',
    'https://attacker-cute-enough.web.tossmini.com',
  ])('rejects non-allowlisted Origin %s', (origin) => {
    const incoming = request(origin);
    const response = corsGuard(incoming);

    expect(isAllowedOrigin(incoming)).toBe(false);
    expect(corsHeaders(incoming)).not.toHaveProperty('Access-Control-Allow-Origin');
    expect(response).not.toBeNull();
    expect(response.status).toBe(403);
    expect(response.headers.get('Access-Control-Allow-Origin')).toBeNull();
  });

  it('preserves non-browser POST requests without an Origin header', () => {
    const incoming = request(undefined, 'POST');

    expect(isAllowedOrigin(incoming)).toBe(true);
    expect(corsHeaders(incoming)).not.toHaveProperty('Access-Control-Allow-Origin');
    expect(corsGuard(incoming)).toBeNull();
  });
});
