import { describe, expect, it } from 'vitest';
import { resolveRuntimeEnvironment } from './runtime';

describe('runtime environment', () => {
  it('recognizes the private and live Apps in Toss origins', () => {
    expect(resolveRuntimeEnvironment(undefined, 'cute-enough.private-apps.tossmini.com')).toBe('private');
    expect(resolveRuntimeEnvironment(undefined, 'cute-enough.apps.tossmini.com')).toBe('production');
  });

  it('keeps localhost and Vercel as preview unless explicitly configured', () => {
    expect(resolveRuntimeEnvironment(undefined, 'localhost')).toBe('preview');
    expect(resolveRuntimeEnvironment(undefined, 'cute-enough.vercel.app')).toBe('preview');
    expect(resolveRuntimeEnvironment('private', 'localhost')).toBe('private');
  });
});
