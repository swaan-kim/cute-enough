import fs from 'node:fs/promises';
import path from 'node:path';
import { spawnSync, execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { randomUUID } from 'node:crypto';
import { AppsInTossBundle } from '@apps-in-toss/ait-format';
import { loadEnv } from 'vite';
import { aitRoot, projectRoot, inside, sha256, kstDate, takeBuildLock, setLatest } from './ait-storage.mjs';

const runtime = process.argv[2];
const webOnly = process.argv.includes('--web-only');
if (!['production','private','preview'].includes(runtime)) throw new Error('빌드 환경을 명시해 주세요.');
process.chdir(projectRoot);
const require = createRequire(import.meta.url);
const releaseLock = await takeBuildLock();
function run(file, args = [], cwd = projectRoot) {
  const result = spawnSync(process.execPath, [file, ...args], { cwd, stdio: 'inherit', env: process.env });
  if (result.error || result.status !== 0) throw new Error(`빌드 단계 실패: ${path.basename(file)} (${result.status ?? result.error?.code})`);
}
async function sourceFingerprint() {
  const entries = [];
  async function walk(dir) {
    for (const item of (await fs.readdir(dir, { withFileTypes: true })).sort((a,b) => a.name.localeCompare(b.name))) {
      const file = path.join(dir,item.name);
      if (item.isSymbolicLink()) throw new Error('빌드 입력의 심볼릭 링크는 별도 검토가 필요합니다.');
      if (item.isDirectory()) await walk(file);
      else entries.push([path.relative(projectRoot,file), sha256(await fs.readFile(file))]);
    }
  }
  for (const folder of ['src','public','scripts','supabase/functions']) await walk(path.join(projectRoot,folder));
  for (const file of ['package.json','package-lock.json','apps-in-toss.config.ts','vite.config.ts','index.html',
    '.env','.env.local',`.env.${runtime}`,`.env.${runtime}.local`]) {
    try { entries.push([file,sha256(await fs.readFile(path.join(projectRoot,file)))]); }
    catch(error) { if(error.code !== 'ENOENT') throw error; }
  }
  return sha256(JSON.stringify(entries));
}
async function assertNoAdDiagnostics(dir = path.join(projectRoot, 'dist')) {
  if (runtime === 'private') return;
  for (const item of await fs.readdir(dir, { withFileTypes: true })) {
    const file = path.join(dir, item.name);
    if (item.isDirectory()) await assertNoAdDiagnostics(file);
    else if (/\.(js|css|html)$/.test(item.name)
      && (await fs.readFile(file, 'utf8')).includes('private-ad-diagnostics')) {
      throw new Error(`${runtime} 번들에 private 광고 진단 화면이 포함되었습니다: ${path.relative(projectRoot, file)}`);
    }
  }
}
try {
  const before = await sourceFingerprint();
  run(path.join(projectRoot,'scripts/validate-release.mjs'),[runtime]);
  run(require.resolve('typescript/bin/tsc'),['-b','--pretty','false']);
  const vite = path.join(path.dirname(require.resolve('vite/package.json')), 'bin/vite.js');
  run(vite,['build','--mode',runtime]);
  run(path.join(projectRoot,'scripts/prune-build-assets.mjs'),[runtime]);
  run(path.join(projectRoot,'scripts/assert-no-ait-devtools.mjs'));
  await assertNoAdDiagnostics();
  if (webOnly) {
    if (before !== await sourceFingerprint()) throw new Error('빌드 중 소스가 바뀌었습니다. 다시 빌드해 주세요.');
  } else {
    // Official SDK always writes <appName>.ait into its package root. Give it a
    // package root INSIDE AIT rather than creating a stray artifact in the repo.
    const stage = inside(aitRoot, path.join(aitRoot,'.staging',randomUUID()));
    await fs.mkdir(stage,{recursive:true});
    await fs.copyFile(path.join(projectRoot,'package.json'),path.join(stage,'package.json'));
    const { default: config } = await import(pathToFileURL(path.join(projectRoot,'apps-in-toss.config.ts')).href);
    await fs.writeFile(path.join(stage,'apps-in-toss.config.mjs'),`export default ${JSON.stringify({...config,webBundleDir:'web'})};\n`);
    await fs.cp(path.join(projectRoot,'dist'),path.join(stage,'web'),{recursive:true});
    run(require.resolve('@apps-in-toss/cli'),['build'],stage);
    const stagedArtifact = inside(stage,path.join(stage,`${config.appName}.ait`));
    const bytes = await fs.readFile(stagedArtifact);
    const reader = AppsInTossBundle.reader(bytes);
    const env = {...loadEnv(runtime,projectRoot,''),...process.env};
    if (runtime === 'production') run(path.join(projectRoot,'scripts/verify-production-ait.mjs'),[stagedArtifact]);
    if (before !== await sourceFingerprint()) throw new Error('빌드 중 소스가 바뀌었습니다. LATEST는 유지하고 결과는 AIT/.staging에 보관합니다.');
    const bucket = runtime === 'production' ? 'ARCHIVE' : 'TEST';
    await fs.mkdir(path.join(aitRoot,bucket),{recursive:true});
    const target = inside(aitRoot,path.join(aitRoot,bucket,`${kstDate()}_${runtime}_${reader.deploymentId}`));
    await fs.mkdir(target,{recursive:false});
    const artifact = path.join(target,'cute-enough.ait');
    await fs.rename(stagedArtifact,artifact);
    let sourceCommit = null;
    try { sourceCommit=execFileSync('git',['-c',`safe.directory=${projectRoot.replaceAll('\\','/')}`,'rev-parse','HEAD'],{cwd:projectRoot,stdio:['ignore','pipe','ignore']}).toString().trim(); } catch { /* source hash remains available */ }
    const record = { createdAt:new Date().toISOString(),runtime,deploymentId:reader.deploymentId,sha256:sha256(bytes),bytes:bytes.length,
      sourceCommit,sourceFingerprint:before,node:process.version,sdk:reader.toAppJson()._metadata.sdkVersion,
      flags:{adsEnabled:env.VITE_ADS_ENABLED==='true',adsTestMode:env.VITE_ADS_TEST_MODE==='true',adDiagnostics:env.VITE_AD_DIAGNOSTICS==='true'},status:'built-not-uploaded' };
    await fs.writeFile(path.join(target,'release.json'),JSON.stringify(record,null,2));
    if(runtime==='production') await setLatest(artifact,record);
    // stage contains only generated copies; never remove source or old releases.
    inside(path.join(aitRoot,'.staging'),stage);
    await fs.rm(stage,{recursive:true});
    console.log(`AIT 저장 완료: ${runtime==='production' ? path.join(aitRoot,'LATEST','cute-enough.ait') : artifact}`);
  }
} finally { await releaseLock(); }
