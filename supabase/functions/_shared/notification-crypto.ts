const encoder = new TextEncoder();

function fromBase64(value: string): Uint8Array<ArrayBuffer> {
  const binary = atob(value);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

function toBase64(value: Uint8Array): string {
  return btoa(Array.from(value, (byte) => String.fromCharCode(byte)).join(''));
}

async function importEncryptionKey(secret: string): Promise<CryptoKey> {
  const bytes = fromBase64(secret);
  if (bytes.length !== 32) throw new Error('NOTIFICATION_ENCRYPTION_KEY_INVALID');
  return crypto.subtle.importKey('raw', bytes, 'AES-GCM', false, ['encrypt', 'decrypt']);
}

/** Separate server secret; never reuse the stable anonymous identity hash salt. */
export async function encryptNotificationKey(anonymousKey: string, ownerHash: string, secret: string): Promise<string> {
  if (!anonymousKey || !ownerHash) throw new Error('NOTIFICATION_IDENTITY_REQUIRED');
  const key = await importEncryptionKey(secret);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv, additionalData: encoder.encode(`recharge:v1:${ownerHash}`) },
    key,
    encoder.encode(anonymousKey),
  );
  return `v1.${toBase64(iv)}.${toBase64(new Uint8Array(ciphertext))}`;
}

export async function decryptNotificationKey(envelope: string, ownerHash: string, secret: string): Promise<string> {
  const [version, ivText, ciphertextText, extra] = envelope.split('.');
  if (version !== 'v1' || !ivText || !ciphertextText || extra !== undefined) {
    throw new Error('NOTIFICATION_KEY_FORMAT_INVALID');
  }
  const iv = fromBase64(ivText);
  if (iv.length !== 12) throw new Error('NOTIFICATION_KEY_FORMAT_INVALID');
  const plaintext = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv, additionalData: encoder.encode(`recharge:v1:${ownerHash}`) },
    await importEncryptionKey(secret),
    fromBase64(ciphertextText),
  );
  return new TextDecoder().decode(plaintext);
}
