import { describe, expect, it } from 'vitest';
import { PetApiError, toPetApiError } from './api';

describe('pet api error normalization', () => {
  it('preserves a structured server code and definite outcome', async () => {
    const error = await toPetApiError({
      context: new Response(JSON.stringify({
        code: 'DAILY_UPLOAD_LIMIT_REACHED',
        error: '사진은 하루에 한 장만 소개할 수 있어요.',
      }), { status: 429, headers: { 'Content-Type': 'application/json' } }),
    });

    expect(error).toMatchObject({
      code: 'DAILY_UPLOAD_LIMIT_REACHED',
      outcome: 'definite',
      status: 429,
    });
  });

  it('marks a timeout and an unhandled server failure as unknown outcomes', async () => {
    const timeout = await toPetApiError(new DOMException('The operation timed out', 'TimeoutError'));
    const serverFailure = await toPetApiError({
      context: new Response(JSON.stringify({ code: 'INTERNAL_ERROR', error: '요청을 완료하지 못했어요.' }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      }),
    });

    expect(timeout).toMatchObject({ code: 'REQUEST_TIMEOUT', outcome: 'unknown' });
    expect(serverFailure).toMatchObject({ code: 'INTERNAL_ERROR', outcome: 'unknown', status: 500 });
  });

  it('keeps an explicit capacity rejection definite even when it uses a 503 status', async () => {
    const error = await toPetApiError({
      context: new Response(JSON.stringify({ code: 'UPLOAD_CAPACITY_REACHED', error: '오늘 받을 수 있는 사진이 모두 모였어요.' }), {
        status: 503,
        headers: { 'Content-Type': 'application/json' },
      }),
    });

    expect(error).toMatchObject({ code: 'UPLOAD_CAPACITY_REACHED', outcome: 'definite', status: 503 });
  });

  it('does not erase an already normalized error', async () => {
    const original = new PetApiError('다시 시도해 주세요.', 'NETWORK_ERROR', 'unknown');
    await expect(toPetApiError(original)).resolves.toBe(original);
  });
});
