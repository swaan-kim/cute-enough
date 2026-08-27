import { rm } from 'node:fs/promises';
import { resolve } from 'node:path';

const generatedDist = resolve(process.cwd(), 'dist');
const runtime = process.argv[2] ?? 'preview';
const excludedSubmissionAssets = [
  resolve(generatedDist, 'brand', 'concepts'),
  resolve(generatedDist, 'brand', 'logo-concepts.png'),
  resolve(generatedDist, 'brand', 'README.md'),
  resolve(generatedDist, 'brand', 'app-icon-camera-light-source.png'),
  resolve(generatedDist, 'brand', 'app-icon-camera-dark-source.png'),
  resolve(generatedDist, 'brand', 'app-icon-dark-600.png'),
  resolve(generatedDist, 'brand', 'app-icon-dark-512.png'),
  resolve(generatedDist, 'brand', 'app-icon-polaroid-v1-600.png'),
  resolve(generatedDist, 'brand', 'app-icon-polaroid-v1-512.png'),
  resolve(generatedDist, 'brand', 'favicon-polaroid-v1-192.png'),
  resolve(generatedDist, 'pet-artwork', 'README.md'),
  // 실제 강아지 ID 통합 전의 임시 별칭 파일은 preview에도 싣지 않는다.
  resolve(generatedDist, 'sample-pets', 'haneul.jpg'),
  resolve(generatedDist, 'sample-pets', 'mongsil.jpg'),
  resolve(generatedDist, 'sample-pets', 'gureumi.jpg'),
  resolve(generatedDist, 'sample-pets', 'byeori.jpg'),
];

// 승인 사진은 private Storage의 서명 URL로만 제공한다. 정적 웹 데모에서만 샘플 실사를 남긴다.
if (runtime !== 'preview') excludedSubmissionAssets.push(resolve(generatedDist, 'sample-pets'));

for (const target of excludedSubmissionAssets) {
  if (!target.startsWith(`${generatedDist}\\`) && !target.startsWith(`${generatedDist}/`)) {
    throw new Error(`제출 번들 밖의 경로는 정리할 수 없습니다: ${target}`);
  }
  await rm(target, { recursive: true, force: true });
}
