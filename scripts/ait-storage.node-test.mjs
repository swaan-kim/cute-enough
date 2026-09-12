import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { test } from 'node:test';
import { inside, sha256, kstDate, takeBuildLock, setLatest, readLatest } from './ait-storage.mjs';
async function fixture(t) {
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'cute-ait-lock-test-'));
  t.after(async()=>{ assert.ok(path.basename(root).startsWith('cute-ait-lock-test-')); await fs.rm(root,{recursive:true,force:true}); });
  const file=path.join(root,'ARCHIVE','candidate.ait');
  await fs.mkdir(path.dirname(file)); await fs.writeFile(file,'original-binary');
  const record={runtime:'production',sha256:sha256('original-binary'),flags:{adsTestMode:false},deploymentId:'fixture'};
  return {root,file,record};
}

test('archive dates use Korean midnight instead of UTC midnight',()=>{
  assert.equal(kstDate(new Date('2026-09-06T14:59:59Z')),'2026-09-06');
  assert.equal(kstDate(new Date('2026-09-06T15:00:00Z')),'2026-09-07');
});
test('all runtimes share an exclusive lock; losing builder cannot remove it',async(t)=>{
  const {root}=await fixture(t); const release=await takeBuildLock(root);
  await assert.rejects(takeBuildLock(root),/다른 작업/);
  assert.ok(await fs.stat(path.join(root,'.build.lock')));
  await release(); const second=await takeBuildLock(root); await second();
});
test('failure releases owned lock and leaves existing latest untouched',async(t)=>{
  const {root,file,record}=await fixture(t); await setLatest(file,record,root);
  const release=await takeBuildLock(root);
  try { throw new Error('build failed'); } catch {} finally {await release();}
  assert.equal((await readLatest(root)).record.sha256,record.sha256);
});
test('test mode and preview/private files can never become LATEST',async(t)=>{
  const {root,file,record}=await fixture(t); await setLatest(file,record,root);
  for(const runtime of ['preview','private']) await assert.rejects(setLatest(file,{...record,runtime},root));
  await assert.rejects(setLatest(file,{...record,flags:{adsTestMode:true}},root));
  assert.equal((await readLatest(root)).record.deploymentId,'fixture');
});
test('hash mismatch cannot replace a working latest',async(t)=>{
  const {root,file,record}=await fixture(t); await setLatest(file,record,root);
  await assert.rejects(setLatest(file,{...record,sha256:'bad'},root),/해시/);
  assert.equal((await readLatest(root)).record.sha256,record.sha256);
});
test('upload refuses a modified latest copy or modified immutable archive',async(t)=>{
  const {root,file,record}=await fixture(t); await setLatest(file,record,root);
  await fs.writeFile(path.join(root,'LATEST','cute-enough.ait'),'tampered'); await assert.rejects(readLatest(root));
  await setLatest(file,record,root); await fs.writeFile(file,'tampered'); await assert.rejects(readLatest(root));
});
test('paths cannot escape archive root or target the entire root',()=>{
  const root=path.resolve('fixture-root');
  assert.throws(()=>inside(root,root)); assert.throws(()=>inside(root,path.resolve(root,'..','other.ait')));
  assert.equal(inside(root,path.join(root,'ARCHIVE','one.ait')),path.join(root,'ARCHIVE','one.ait'));
});
