import { describe, expect, it } from 'vitest';
import { resolveRuntimeEnvironment } from './runtime';

describe('runtime environment', () => {
  it('recognizes the legacy and current private Apps in Toss origins', () => {
    expect(resolveRuntimeEnvironment(undefined, 'cute-enough.private-web.tossmini.com')).toBe('private');
    expect(resolveRuntimeEnvironment(undefined, 'cute-enough.private-apps.tossmini.com')).toBe('private');
  });

  it('recognizes the legacy and current production Apps in Toss origins', () => {
    expect(resolveRuntimeEnvironment(undefined, 'cute-enough.web.tossmini.com')).toBe('production');
    expect(resolveRuntimeEnvironment(undefined, 'cute-enough.apps.tossmini.com')).toBe('production');
  });

  it('keeps unknown hosts as preview', () => {
    expect(resolveRuntimeEnvironment(undefined, 'localhost')).toBe('preview');
    expect(resolveRuntimeEnvironment(undefined, 'cute-enough.vercel.app')).toBe('preview');
    expect(resolveRuntimeEnvironment(undefined, 'cute-enough.preview.tossmini.com')).toBe('preview');
  });

  it('prefers an explicitly configured environment over the hostname', () => {
    expect(resolveRuntimeEnvironment('private', 'localhost')).toBe('private');
    expect(resolveRuntimeEnvironment('preview', 'cute-enough.apps.tossmini.com')).toBe('preview');
    expect(resolveRuntimeEnvironment('production', 'cute-enough.private-web.tossmini.com')).toBe('production');
  });
});
