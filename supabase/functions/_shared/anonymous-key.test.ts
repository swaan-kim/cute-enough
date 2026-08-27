import { describe, expect, it } from 'vitest';
import { parseAnonymousKeyVerificationSuccess } from './anonymous-key.ts';

describe('anonymous key verification response parser', () => {
  it.each([true, 'true'])('accepts a SUCCESS response with success=%j', (success) => {
    expect(parseAnonymousKeyVerificationSuccess({ resultType: 'SUCCESS', success })).toBe(true);
  });

  it.each([
    null,
    {},
    { resultType: 'SUCCESS', success: false },
    { resultType: 'SUCCESS', success: 'false' },
    { resultType: 'SUCCESS', success: 1 },
    { resultType: 'FAIL', success: true },
  ])('rejects a non-success response: %j', (payload) => {
    expect(parseAnonymousKeyVerificationSuccess(payload)).toBe(false);
  });
});
