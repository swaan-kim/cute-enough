// Inspect the actual AIT archive, not just .env or a previous dist directory.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { AppsInTossBundle } from '@apps-in-toss/ait-format';
import { loadEnv } from 'vite';
const file = path.resolve(process.argv[2] || 'AIT/LATEST/cute-enough.ait');
const bytes = fs.readFileSync(file);
const reader = AppsInTossBundle.reader(bytes);
const entries = reader.listEntries();
const env = { ...loadEnv('production', process.cwd(), ''), ...process.env };
assert.equal(env.VITE_APP_RUNTIME, 'production');
const adsEnabled = env.VITE_ADS_ENABLED === 'true';
const adGroupId = env.VITE_REWARDED_AD_GROUP_ID || '';
assert.notEqual(env.VITE_ADS_TEST_MODE, 'true');
if (adsEnabled) assert.match(adGroupId, /^ait\.v2\.live\./);
assert.ok(!/test/i.test(adGroupId));
assert.ok(env.VITE_SUPABASE_URL && env.VITE_SUPABASE_ANON_KEY);
assert.equal(entries.some((entry) => /sample-pets|review\.html|devtools/i.test(entry)), false);
let text = '', main = '', matchedDistEntries = 0;
for (const entry of entries.filter((entry) => /\.(js|css|html)$/.test(entry))) {
  const data = Buffer.from(await reader.readEntry(entry));
  const source = data.toString('utf8');
  text += source;
  if (/index-.*\.js$/.test(entry)) main = source;
  const local = path.join('dist', entry.replace(/^sources[\\/]/, '').replaceAll('\\', '/'));
  assert.ok(fs.existsSync(local) && data.equals(fs.readFileSync(local)), 'AIT differs from current web build');
  matchedDistEntries++;
}
assert.ok(text.includes(env.VITE_SUPABASE_URL), 'Missing production server URL');
assert.ok(text.includes(env.VITE_SUPABASE_ANON_KEY), 'Missing production public key');
// Fail closed if minification changes: inspect new output before adapting this guard.
const esc = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const instance = main.match(new RegExp(`new [\\w$]+\\(([\\w$]+),"${esc(adGroupId)}",void 0,\\{runtime:([\\w$]+),testMode:!1\\}\\)`));
assert.ok(instance, 'Live ad group/test-mode configuration not found in actual bundle');
const [, enabled, runtime] = instance;
const binding = main.match(new RegExp(`${esc(runtime)}=([\\w$]+)\\(\\),([\\w$]+)==?${esc(runtime)}==="preview",${esc(enabled)}=!\\2&&!${adsEnabled ? '0' : '1'}`));
assert.ok(binding, 'Actual bundle does not enable rewarded ads outside preview');
assert.ok(new RegExp(`function ${esc(binding[1])}\\([\\w$]+="production",`).test(main), 'Actual bundle runtime is not production');
for (const feature of ['svg-scene-v1','photoAdditionStatus','photoAdditionUpload','photoAdditionSubmit',
  'pet-smile-arc','사진을 불러오는 데 시간이 오래 걸려요. 다시 불러와 주세요.',
  '세 번 쓸어주거나 톡톡 세 번 눌러도 좋아요','모은 사진','강아지 앨범',
  '광고 보고 한 마리 더 만나기','어떤 친구를 만나볼까요?',
  '광고 화면이 열리지 않았나요?','받은 보상으로 계속하기']) {
  assert.ok(text.includes(feature), `Missing integrated feature: ${feature}`);
}
assert.ok(!text.includes('photoPrepare'), 'Speculative preparation must not ship in the client');
assert.ok(!text.includes('확정하기') || !text.includes('/api/review-photo-additions'), 'Local creator console leaked into user bundle');
console.log(JSON.stringify({ file, deploymentId: reader.deploymentId, bytes: bytes.length,
  sha256: createHash('sha256').update(bytes).digest('hex'), sdk: reader.toAppJson()._metadata.sdkVersion,
  runtime: 'production', adsEnabled, adsTestMode: false, productionServerConfigured: true,
  samplesIncluded: false, integratedFeatures: true, speculativePhotoPreparation: false, crescentSmileIncluded: true, matchedDistEntries }, null, 2));
