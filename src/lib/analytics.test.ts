import { beforeEach, describe, expect, it, vi } from 'vitest';

const { analyticsBehavior } = vi.hoisted(() => ({
  analyticsBehavior: {
    log: () => Promise.resolve(),
  } as { log: (...args: unknown[]) => unknown },
}));

vi.mock('@apps-in-toss/web-framework', () => ({
  Analytics: { log: (...args: unknown[]) => analyticsBehavior.log(...args) },
}));

import { trackProductEvent } from './analytics';

describe('trackProductEvent', () => {
  beforeEach(() => {
    analyticsBehavior.log = () => Promise.resolve();
  });

  it('does not break the user flow when the Toss bridge throws synchronously', async () => {
    analyticsBehavior.log = () => {
      throw new Error('bridge unavailable');
    };

    expect(() => trackProductEvent('house_load', { result: 'success' })).not.toThrow();
    await Promise.resolve();
    await Promise.resolve();
  });

  it('swallows asynchronous analytics failures', async () => {
    analyticsBehavior.log = () => Promise.reject(new Error('network unavailable'));

    expect(() => trackProductEvent('house_load')).not.toThrow();
    await Promise.resolve();
    await Promise.resolve();
  });
});
