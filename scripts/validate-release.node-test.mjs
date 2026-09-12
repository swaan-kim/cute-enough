import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import test from 'node:test';

const workspace = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const validator = resolve(workspace, 'scripts/validate-release.mjs');
const officialTestId = 'ait-ad-test-rewarded-id';

function validate(runtime, overrides = {}) {
  return spawnSync(process.execPath, [validator, runtime], {
    cwd: workspace,
    encoding: 'utf8',
    env: {
      ...process.env,
      VITE_APP_RUNTIME: runtime,
      VITE_SUPABASE_URL: 'https://release-check.example',
      VITE_SUPABASE_ANON_KEY: 'diagnostic-public-anon-key',
      VITE_SHARE_OG_URL: 'https://assets.example/share.png',
      VITE_ADS_ENABLED: 'true',
      VITE_ADS_TEST_MODE: 'false',
      VITE_AD_DIAGNOSTICS: 'false',
      VITE_REWARDED_AD_GROUP_ID: 'live-group',
      ...overrides,
    },
  });
}

test('explicit private test build accepts only the official rewarded ID', () => {
  const result = validate('private', { VITE_ADS_TEST_MODE: 'true', VITE_REWARDED_AD_GROUP_ID: officialTestId });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /광고 private 테스트/);
});

test('private diagnostics accepts enabled test ads with the official rewarded ID', () => {
  const result = validate('private', {
    VITE_AD_DIAGNOSTICS: 'true',
    VITE_ADS_TEST_MODE: 'true',
    VITE_REWARDED_AD_GROUP_ID: officialTestId,
  });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /광고 private 테스트, 진단 화면/);
});

for (const [name, runtime, overrides] of [
  ['private diagnostics with live ads', 'private', { VITE_ADS_TEST_MODE: 'false', VITE_REWARDED_AD_GROUP_ID: 'live-group' }],
  ['private diagnostics without test mode', 'private', { VITE_ADS_TEST_MODE: 'false' }],
  ['private diagnostics with ads disabled', 'private', { VITE_ADS_ENABLED: 'false' }],
  ['private diagnostics with real ID', 'private', { VITE_REWARDED_AD_GROUP_ID: 'live-group' }],
  ['private diagnostics with empty ID', 'private', { VITE_REWARDED_AD_GROUP_ID: '' }],
  ['private diagnostics with interstitial ID', 'private', { VITE_REWARDED_AD_GROUP_ID: 'ait-ad-test-interstitial-id' }],
  ['private diagnostics with different ID case', 'private', { VITE_REWARDED_AD_GROUP_ID: 'AIT-AD-TEST-REWARDED-ID' }],
  ['private diagnostics with extra ID suffix', 'private', { VITE_REWARDED_AD_GROUP_ID: `${officialTestId}-extra` }],
  ['production diagnostics with test ID', 'production', {}],
  ['production diagnostics with live ads', 'production', { VITE_ADS_TEST_MODE: 'false', VITE_REWARDED_AD_GROUP_ID: 'live-group' }],
  ['production diagnostics with ads disabled', 'production', { VITE_ADS_TEST_MODE: 'false', VITE_ADS_ENABLED: 'false', VITE_REWARDED_AD_GROUP_ID: '' }],
  ['preview diagnostics with test ID', 'preview', {}],
  ['preview diagnostics without test mode', 'preview', { VITE_ADS_TEST_MODE: 'false' }],
  ['preview diagnostics with live ads', 'preview', { VITE_ADS_TEST_MODE: 'false', VITE_REWARDED_AD_GROUP_ID: 'live-group' }],
  ['nonliteral diagnostic flag', 'private', { VITE_AD_DIAGNOSTICS: 'TRUE' }],
  ['numeric diagnostic flag', 'private', { VITE_AD_DIAGNOSTICS: '1' }],
]) {
  test(`rejects ${name}`, () => {
    const result = validate(runtime, {
      VITE_AD_DIAGNOSTICS: 'true',
      VITE_ADS_TEST_MODE: 'true',
      VITE_REWARDED_AD_GROUP_ID: officialTestId,
      ...overrides,
    });
    assert.notEqual(result.status, 0, `${name} unexpectedly passed: ${result.stdout}`);
    assert.match(result.stderr, /광고 진단|VITE_AD_DIAGNOSTICS/);
  });
}

for (const runtime of ['private', 'production']) {
  test(`${runtime} real ad build remains available without test mode`, () => {
    const result = validate(runtime);
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /광고 활성/);
  });
  test(`${runtime} ads-off build remains available without an ad group`, () => {
    const result = validate(runtime, { VITE_ADS_ENABLED: 'false', VITE_REWARDED_AD_GROUP_ID: '' });
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /광고 비활성/);
  });
}

for (const [name, runtime, config] of [
  ['private test ID without opt-in', 'private', { VITE_REWARDED_AD_GROUP_ID: officialTestId }],
  ['private test ID with nonliteral opt-in', 'private', { VITE_ADS_TEST_MODE: 'TRUE', VITE_REWARDED_AD_GROUP_ID: officialTestId }],
  ['private test mode with real ID', 'private', { VITE_ADS_TEST_MODE: 'true' }],
  ['private test mode with empty ID', 'private', { VITE_ADS_TEST_MODE: 'true', VITE_REWARDED_AD_GROUP_ID: '' }],
  ['private test mode with interstitial ID', 'private', { VITE_ADS_TEST_MODE: 'true', VITE_REWARDED_AD_GROUP_ID: 'ait-ad-test-interstitial-id' }],
  ['private test mode with different case', 'private', { VITE_ADS_TEST_MODE: 'true', VITE_REWARDED_AD_GROUP_ID: 'AIT-AD-TEST-REWARDED-ID' }],
  ['private test mode with suffix', 'private', { VITE_ADS_TEST_MODE: 'true', VITE_REWARDED_AD_GROUP_ID: `${officialTestId}-extra` }],
  ['private test mode with ads disabled', 'private', { VITE_ADS_TEST_MODE: 'true', VITE_ADS_ENABLED: 'false', VITE_REWARDED_AD_GROUP_ID: officialTestId }],
  ['private live mode with empty ID', 'private', { VITE_REWARDED_AD_GROUP_ID: '' }],
  ['private live mode with blank ID', 'private', { VITE_REWARDED_AD_GROUP_ID: '  ' }],
  ['production test mode with official ID', 'production', { VITE_ADS_TEST_MODE: 'true', VITE_REWARDED_AD_GROUP_ID: officialTestId }],
  ['production test mode with real ID', 'production', { VITE_ADS_TEST_MODE: 'true' }],
  ['production test mode with ads disabled', 'production', { VITE_ADS_TEST_MODE: 'true', VITE_ADS_ENABLED: 'false' }],
  ['production test ID without opt-in', 'production', { VITE_REWARDED_AD_GROUP_ID: officialTestId }],
  ['production test ID with ads disabled', 'production', { VITE_ADS_ENABLED: 'false', VITE_REWARDED_AD_GROUP_ID: officialTestId }],
  ['production unapproved test ID', 'production', { VITE_REWARDED_AD_GROUP_ID: 'some-other-test-id' }],
  ['preview test mode', 'preview', { VITE_ADS_TEST_MODE: 'true', VITE_REWARDED_AD_GROUP_ID: officialTestId }],
]) {
  test(`rejects ${name}`, () => {
    const result = validate(runtime, config);
    assert.notEqual(result.status, 0, `${name} unexpectedly passed: ${result.stdout}`);
    assert.match(result.stderr, /광고|테스트/);
  });
}
