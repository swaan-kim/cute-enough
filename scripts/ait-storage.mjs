import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
export const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const aitRoot = path.join(projectRoot, 'AIT');
export const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');
export const kstDate = (date = new Date()) => new Date(date.getTime() + 9 * 60 * 60 * 1000).toISOString().slice(0, 10);
export function inside(root, target) {
  const resolved = path.resolve(target), relative = path.relative(path.resolve(root), resolved);
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) throw new Error('AIT 경로가 지정된 폴더 밖입니다.');
  return resolved;
}
export async function takeBuildLock(root = aitRoot) {
  await fs.mkdir(root, { recursive: true });
  const file = path.join(root, '.build.lock');
  let handle;
  try { handle = await fs.open(file, 'wx'); }
  catch (error) {
    if (error.code === 'EEXIST') throw new Error('다른 작업이 AIT/웹 빌드 중입니다. AIT/.build.lock을 임의로 지우지 말고 작업 종료 후 다시 실행하세요.');
    throw error;
  }
  const token = randomUUID();
  await handle.writeFile(JSON.stringify({ pid: process.pid, token, startedAt: new Date().toISOString() }));
  await handle.close();
  return async () => {
    const current = JSON.parse(await fs.readFile(file, 'utf8'));
    if (current.token !== token) throw new Error('빌드 잠금 소유자가 변경됐습니다.');
    await fs.unlink(file);
  };
}
export async function atomicWrite(file, content) {
  await fs.mkdir(path.dirname(file), { recursive: true });
  const temp = `${file}.${randomUUID()}.tmp`;
  await fs.writeFile(temp, content, { flag: 'wx' });
  await fs.rename(temp, file);
}
export async function setLatest(artifact, record, root = aitRoot) {
  inside(root, artifact);
  if (record.runtime !== 'production' || record.flags?.adsTestMode === true) throw new Error('테스트 파일을 LATEST로 지정할 수 없습니다.');
  const bytes = await fs.readFile(artifact);
  if (sha256(bytes) !== record.sha256) throw new Error('AIT 해시가 다릅니다. 최신본을 변경하지 않습니다.');
  // Immutable archive is authoritative. Uploaders verify the copied file against
  // this record; the shared lock serializes writers and deploy commands.
  await atomicWrite(path.join(root, 'LATEST', 'cute-enough.ait'), bytes);
  await atomicWrite(path.join(root, 'LATEST', 'release.json'), JSON.stringify({ ...record, artifactPath: path.relative(root, artifact).replaceAll('\\', '/') }, null, 2));
}
export async function readLatest(root = aitRoot) {
  const record = JSON.parse(await fs.readFile(path.join(root, 'LATEST', 'release.json'), 'utf8'));
  const artifact = inside(root, path.resolve(root, record.artifactPath));
  if (record.runtime !== 'production' || record.flags?.adsTestMode === true
    || sha256(await fs.readFile(artifact)) !== record.sha256
    || sha256(await fs.readFile(path.join(root, 'LATEST', 'cute-enough.ait'))) !== record.sha256) {
    throw new Error('LATEST 파일과 기록이 일치하지 않습니다. 업로드를 중단합니다.');
  }
  return { artifact, record };
}
