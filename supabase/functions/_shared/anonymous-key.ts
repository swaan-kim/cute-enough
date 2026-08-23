import { ApiError } from './api-error.ts';

const VERIFY_URL = 'https://apps-in-toss-api.toss.im/api-partner/v1/apps-in-toss/users/anon-key/verify';
const CACHE_TTL_MS = 10 * 60_000;
const verifiedUntil = new Map<string, number>();

function localVerificationDisabled(): boolean {
  return Deno.env.get('AIT_RUNTIME_ENV') === 'local'
    && Deno.env.get('AIT_ALLOW_UNVERIFIED_ANON_KEY') === 'true';
}

export async function verifyAnonymousKey(anonymousKey: string): Promise<void> {
  if (localVerificationDisabled()) return;
  if ((verifiedUntil.get(anonymousKey) ?? 0) > Date.now()) return;

  const certChain = Deno.env.get('AIT_MTLS_CERT_PEM');
  const privateKey = Deno.env.get('AIT_MTLS_PRIVATE_KEY_PEM');
  if (!certChain || !privateKey) {
    throw new ApiError('IDENTITY_VERIFY_UNAVAILABLE', 503, '사용자 확인 서버가 준비되지 않았어요. 잠시 뒤 다시 시도해 주세요.');
  }

  const denoWithHttpClient = Deno as typeof Deno & {
    createHttpClient?: (options: { cert: string; key: string }) => { close(): void };
  };
  if (!denoWithHttpClient.createHttpClient) {
    throw new ApiError('IDENTITY_VERIFY_UNAVAILABLE', 503, '사용자 확인 서버를 연결하지 못했어요.');
  }

  const client = denoWithHttpClient.createHttpClient({
    cert: certChain.replaceAll('\\n', '\n'),
    key: privateKey.replaceAll('\\n', '\n'),
  });
  try {
    const response = await fetch(VERIFY_URL, {
      method: 'POST',
      headers: { Accept: 'application/json', 'x-anon-key': anonymousKey },
      body: '',
      signal: AbortSignal.timeout(4_000),
      client,
    } as RequestInit & { client: unknown });
    const payload = await response.json().catch(() => null) as { resultType?: string; success?: string } | null;
    if (!response.ok || payload?.resultType !== 'SUCCESS' || payload.success !== 'true') {
      throw new ApiError('INVALID_ANONYMOUS_KEY', 401, '사용자 정보를 확인하지 못했어요. 앱을 다시 열어 주세요.');
    }
    verifiedUntil.set(anonymousKey, Date.now() + CACHE_TTL_MS);
  } catch (error) {
    if (error instanceof ApiError) throw error;
    console.error('anonymous key verification failed', error);
    throw new ApiError('IDENTITY_VERIFY_UNAVAILABLE', 503, '사용자 확인이 늦어지고 있어요. 잠시 뒤 다시 시도해 주세요.');
  } finally {
    client.close();
  }
}
