import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { projectRoot, readLatest, takeBuildLock } from './ait-storage.mjs';
const releaseLock = await takeBuildLock();
try {
  const { artifact, record } = await readLatest();
  console.log(`확인된 운영 후보만 업로드: ${record.deploymentId}`);
  const result = spawnSync(process.execPath,[createRequire(import.meta.url).resolve('@apps-in-toss/cli'),'deploy','--location',artifact],{cwd:projectRoot,stdio:'inherit'});
  if(result.error || result.status !== 0) throw new Error('업로드를 완료하지 못했습니다.');
} finally { await releaseLock(); }
