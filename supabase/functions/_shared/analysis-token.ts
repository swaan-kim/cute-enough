const encoder = new TextEncoder();

function toBase64Url(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes)).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '');
}

function fromBase64Url(value: string): Uint8Array {
  const padded = value.replaceAll('-', '+').replaceAll('_', '/') + '='.repeat((4 - value.length % 4) % 4);
  return Uint8Array.from(atob(padded), (char) => char.charCodeAt(0));
}

async function signingKey() {
  const secret = Deno.env.get('ANALYSIS_SIGNING_SECRET');
  if (!secret || secret.length < 32) throw new Error('ANALYSIS_SIGNING_SECRET must be at least 32 characters');
  return crypto.subtle.importKey('raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify']);
}

export async function imageDigest(dataUri: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', encoder.encode(dataUri));
  return toBase64Url(new Uint8Array(digest));
}

export async function createAnalysisToken(ownerHash: string, dataUri: string): Promise<string> {
  const payload = { ownerHash, imageDigest: await imageDigest(dataUri), exp: Date.now() + 15 * 60_000 };
  const encoded = toBase64Url(encoder.encode(JSON.stringify(payload)));
  const signature = await crypto.subtle.sign('HMAC', await signingKey(), encoder.encode(encoded));
  return `${encoded}.${toBase64Url(new Uint8Array(signature))}`;
}

export async function verifyAnalysisToken(token: string, ownerHash: string, dataUri: string): Promise<boolean> {
  const [encoded, signature] = token.split('.');
  if (!encoded || !signature) return false;
  const valid = await crypto.subtle.verify('HMAC', await signingKey(), fromBase64Url(signature), encoder.encode(encoded));
  if (!valid) return false;
  const payload = JSON.parse(new TextDecoder().decode(fromBase64Url(encoded)));
  return payload.ownerHash === ownerHash && payload.exp >= Date.now() && payload.imageDigest === await imageDigest(dataUri);
}
