// Read-only release smoke check. Never prints project keys or user identifiers.
import assert from 'node:assert/strict';

const base = process.env.VITE_SUPABASE_URL;
const key = process.env.VITE_SUPABASE_ANON_KEY;
if (!base || !key) throw new Error('Load the production environment file first.');
const url = `${base.replace(/\/+$/, '')}/functions/v1/pet-api`;
const allowed = ['web', 'private-web', 'apps', 'private-apps'].map(host => `https://cute-enough.${host}.tossmini.com`);
for (const origin of [...allowed, 'null', 'file://', 'https://cute-enough.web.tossmini.com.example.com', 'https://other.web.tossmini.com']) {
  const response = await fetch(url, {
    method: 'OPTIONS', headers: { Origin: origin, 'Access-Control-Request-Method': 'POST', 'Access-Control-Request-Headers': 'content-type,apikey' },
    signal: AbortSignal.timeout(15000),
  });
  assert.equal(response.status, allowed.includes(origin) ? 204 : 403);
  if (allowed.includes(origin)) assert.equal(response.headers.get('access-control-allow-origin'), origin);
  console.log(`CORS ${response.status}: ${origin}`);
}
const identity = await fetch(url, {
  method: 'POST', headers: { Origin: allowed[1], apikey: key, 'Content-Type': 'application/json' },
  body: JSON.stringify({ action: 'house', apiVersion: 2, albumVersion: 2, userHash: 'release-invalid-identity' }),
  signal: AbortSignal.timeout(15000),
});
assert.equal(identity.status, 401, 'Invalid identity must not return a house snapshot.');
console.log('Invalid identity: 401 (no user data returned)');
