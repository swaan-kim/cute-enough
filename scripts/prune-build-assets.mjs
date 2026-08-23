import { rm } from 'node:fs/promises';
import { resolve } from 'node:path';

const generatedDist = resolve(process.cwd(), 'dist');
const excludedSubmissionAssets = [
  resolve(generatedDist, 'brand', 'concepts'),
  resolve(generatedDist, 'brand', 'logo-concepts.png'),
  resolve(generatedDist, 'brand', 'README.md'),
  resolve(generatedDist, 'pet-artwork', 'README.md'),
];

for (const target of excludedSubmissionAssets) {
  if (!target.startsWith(`${generatedDist}\\`) && !target.startsWith(`${generatedDist}/`)) {
    throw new Error(`제출 번들 밖의 경로는 정리할 수 없습니다: ${target}`);
  }
  await rm(target, { recursive: true, force: true });
}
