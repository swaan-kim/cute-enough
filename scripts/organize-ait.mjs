// One-time explicit migration. Keeps every old file, including duplicates.
import fs from 'node:fs/promises';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { aitRoot, projectRoot, inside, sha256, takeBuildLock, setLatest } from './ait-storage.mjs';
const [latestRelative, expectedHash] = process.argv.slice(2);
if(!latestRelative || !/^[a-f0-9]{64}$/.test(expectedHash || '')) throw new Error('현재 확정 파일 경로와 SHA-256을 명시해 주세요.');
const latestSource = inside(projectRoot,path.resolve(projectRoot,latestRelative));
const releaseLock = await takeBuildLock();
try {
  const journal = path.join(aitRoot,'migration-20260907.json');
  try { await fs.access(journal); throw new Error('이전 정리 기록이 있습니다. 자동으로 다시 이동하지 않습니다.'); }
  catch(error) { if(error.code !== 'ENOENT') throw error; }
  if(sha256(await fs.readFile(latestSource)) !== expectedHash) throw new Error('현재 파일의 해시가 다릅니다.');
  const check = spawnSync(process.execPath,[path.join(projectRoot,'scripts/verify-production-ait.mjs'),latestSource],{cwd:projectRoot,encoding:'utf8'});
  if(check.status !== 0) throw new Error('현재 운영 후보의 검증이 실패했습니다. 파일을 이동하지 않습니다.');
  const verified=JSON.parse(check.stdout);
  const files=[];
  async function walk(dir) {
    for(const item of await fs.readdir(dir,{withFileTypes:true})) {
      if(item.isSymbolicLink() || ['node_modules','.git','AIT'].includes(item.name)) continue;
      const file=path.join(dir,item.name);
      if(item.isDirectory()) await walk(file);
      else if(item.name.endsWith('.ait')) files.push(file);
    }
  }
  await walk(projectRoot);
  const records=[];
  for(const file of files) {
    inside(projectRoot,file);
    const originalPath=path.relative(projectRoot,file).replaceAll('\\','/');
    const destination=inside(aitRoot,path.join(aitRoot,'ARCHIVE','imported',originalPath));
    try { await fs.access(destination); throw new Error('대상 파일이 이미 있습니다.'); } catch(error) { if(error.code !== 'ENOENT') throw error; }
    records.push({originalPath,destination:path.relative(aitRoot,destination).replaceAll('\\','/'),sha256:sha256(await fs.readFile(file)),moved:false});
  }
  await fs.writeFile(journal,JSON.stringify(records,null,2),{flag:'wx'});
  for(const record of records) {
    const source=inside(projectRoot,path.join(projectRoot,record.originalPath));
    const destination=inside(aitRoot,path.join(aitRoot,record.destination));
    // Abort if an uncoordinated writer changed a file after the read-only plan.
    if(sha256(await fs.readFile(source)) !== record.sha256) throw new Error('이동 중 다른 작업이 AIT를 변경했습니다. 기록을 확인하세요.');
    await fs.mkdir(path.dirname(destination),{recursive:true});
    await fs.rename(source,destination);
    if(sha256(await fs.readFile(destination)) !== record.sha256) throw new Error('이동 후 해시가 다릅니다.');
    record.moved=true;
    await fs.writeFile(journal,JSON.stringify(records,null,2));
  }
  const current=records.find((r)=>r.originalPath===path.relative(projectRoot,latestSource).replaceAll('\\','/'));
  await setLatest(path.join(aitRoot,current.destination),{runtime:'production',deploymentId:verified.deploymentId,
    sha256:expectedHash,bytes:verified.bytes,sdk:verified.sdk,flags:{adsEnabled:verified.adsEnabled,adsTestMode:false},
    status:'built-not-uploaded',note:'기존 20260907 사진창 돌아가기 제거 후보. 폴더 정리로 재빌드/재배포하지 않음.'});
  console.log(`기존 AIT ${records.length}개 이동·해시 확인 완료. 현재 후보: ${path.join(aitRoot,'LATEST','cute-enough.ait')}`);
} finally { await releaseLock(); }
