import { readLatest, takeBuildLock } from './ait-storage.mjs';

const release = await takeBuildLock();
try {
  const { artifact, record } = await readLatest();
  console.log(JSON.stringify({ ...record, verifiedArtifact: artifact }, null, 2));
  console.log('현재 후보와 보관본의 해시가 일치합니다. 업로드·출시 여부는 별도 확인이 필요합니다.');
} finally { await release(); }
