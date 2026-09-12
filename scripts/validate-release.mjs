import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const requestedRuntime = process.argv[2] || 'preview';
if (!['preview', 'private', 'production'].includes(requestedRuntime)) {
  throw new Error(`알 수 없는 실행 환경입니다: ${requestedRuntime}`);
}

async function readEnvFile(path) {
  try {
    const source = await readFile(path, 'utf8');
    return Object.fromEntries(source.split(/\r?\n/).flatMap((line) => {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) return [];
      const separator = trimmed.indexOf('=');
      if (separator < 1) return [];
      const key = trimmed.slice(0, separator).trim();
      const value = trimmed.slice(separator + 1).trim().replace(/^(['"])(.*)\1$/, '$2');
      return [[key, value]];
    }));
  } catch (error) {
    if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') return {};
    throw error;
  }
}

const workspace = process.cwd();
const fileEnv = Object.assign(
  {},
  await readEnvFile(resolve(workspace, '.env')),
  await readEnvFile(resolve(workspace, '.env.local')),
  await readEnvFile(resolve(workspace, `.env.${requestedRuntime}`)),
  await readEnvFile(resolve(workspace, `.env.${requestedRuntime}.local`)),
);
const env = { ...fileEnv, ...process.env };
const runtime = env.VITE_APP_RUNTIME || requestedRuntime;

if (runtime !== requestedRuntime) {
  throw new Error(`빌드 명령(${requestedRuntime})과 VITE_APP_RUNTIME(${runtime})이 다릅니다.`);
}
if (runtime !== 'preview' && (!env.VITE_SUPABASE_URL || !env.VITE_SUPABASE_ANON_KEY)) {
  throw new Error(`${runtime} 번들에는 VITE_SUPABASE_URL과 VITE_SUPABASE_ANON_KEY가 필요합니다.`);
}

const adsEnabled = env.VITE_ADS_ENABLED === 'true';
const adsTestMode = env.VITE_ADS_TEST_MODE === 'true';
const adDiagnosticsFlag = env.VITE_AD_DIAGNOSTICS || 'false';
if (!['true', 'false'].includes(adDiagnosticsFlag)) {
  throw new Error('VITE_AD_DIAGNOSTICS는 true 또는 false로 설정해야 합니다.');
}
const adDiagnostics = adDiagnosticsFlag === 'true';
const adGroupId = env.VITE_REWARDED_AD_GROUP_ID || '';
const privateTestAds = runtime === 'private' && adsTestMode && adsEnabled && adGroupId === 'ait-ad-test-rewarded-id';
if (adDiagnostics && !privateTestAds) {
  throw new Error('광고 진단 화면은 private 환경에서 광고 활성화, 테스트 모드, 정확한 ait-ad-test-rewarded-id를 함께 설정해야 합니다.');
}
if (adsTestMode && !privateTestAds) {
  throw new Error('광고 테스트 모드는 private 환경에서 광고 활성화와 정확한 ait-ad-test-rewarded-id를 함께 설정해야 합니다.');
}
if (runtime === 'production' && /test/i.test(adGroupId)) {
  throw new Error('production 번들에는 테스트 광고 그룹 ID를 포함할 수 없습니다.');
}
if (runtime !== 'preview' && adsEnabled && (!adGroupId.trim() || (/test/i.test(adGroupId) && !privateTestAds))) {
  throw new Error('광고 활성화 번들에는 승인된 실광고 그룹 ID가 필요합니다. 테스트 ID는 제출할 수 없습니다.');
}
if (runtime === 'production' && /vercel\.app/i.test(env.VITE_SHARE_OG_URL || '')) {
  throw new Error('운영 공유 OG 주소는 Vercel 데모 주소를 사용할 수 없습니다.');
}
if (runtime !== 'preview' && !/^https:\/\//i.test(env.VITE_SHARE_OG_URL || '')) {
  throw new Error(`${runtime} 번들에는 HTTPS 영구 공개 공유 OG 주소가 필요합니다.`);
}

console.log(`[release-check] ${runtime} 설정 검증 완료 (광고 ${privateTestAds ? 'private 테스트' : adsEnabled ? '활성' : '비활성'}${adDiagnostics ? ', 진단 화면' : ''})`);
