export async function hashUser(raw: string): Promise<string> {
  const salt = Deno.env.get('USER_HASH_SALT');
  if (!salt) throw new Error('USER_HASH_SALT is not configured');
  const bytes = new TextEncoder().encode(`${salt}:${raw}`);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest)).map((value) => value.toString(16).padStart(2, '0')).join('');
}

export function kstDate(now = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(now);
}

export function decodeDataUri(dataUri: string): { bytes: Uint8Array; mime: string } {
  const match = /^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/=]+)$/.exec(dataUri);
  if (!match) throw new Error('지원하지 않는 이미지 형식이에요.');
  const binary = atob(match[2]);
  if (binary.length > 7 * 1024 * 1024) throw new Error('사진은 7MB보다 작아야 해요.');
  return { bytes: Uint8Array.from(binary, (char) => char.charCodeAt(0)), mime: match[1] };
}
