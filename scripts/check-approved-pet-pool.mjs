import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { loadReviewConfig } from '../tools/review-console/server-lib.mjs';

export const DEFAULT_MINIMUM_PET_COUNT = 8;

export function parseMinimum(argumentsList = []) {
  const option = argumentsList.find((argument) => argument.startsWith('--min='));
  if (!option) return DEFAULT_MINIMUM_PET_COUNT;
  const value = option.slice('--min='.length);
  if (!/^\d+$/.test(value)) throw new Error('--min은 1 이상의 정수여야 합니다.');
  const minimum = Number(value);
  if (!Number.isSafeInteger(minimum) || minimum < 1 || minimum > 1000) {
    throw new Error('--min은 1 이상 1000 이하의 정수여야 합니다.');
  }
  return minimum;
}

export async function fetchApprovedPetPool({ fetchFn = fetch, secretKey, supabaseUrl }) {
  const response = await fetchFn(`${supabaseUrl}/rest/v1/rpc/get_approved_active_photo_pet_pool`, {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      apikey: secretKey,
      Authorization: `Bearer ${secretKey}`,
      'Content-Type': 'application/json',
    },
    body: '{}',
  });

  if (!response.ok) {
    let code = null;
    try {
      const payload = await response.json();
      code = typeof payload?.code === 'string' ? payload.code : null;
    } catch {
      // Do not echo the upstream body: it can contain internal schema details.
    }
    const suffix = code ? ` (${code})` : '';
    throw new Error(`운영 풀 조회 실패: HTTP ${response.status}${suffix}. 최신 Supabase 마이그레이션을 확인해 주세요.`);
  }

  const payload = await response.json();
  if (!Array.isArray(payload)) throw new Error('운영 풀 응답 형식이 올바르지 않습니다.');

  return payload.map((row) => {
    const activePhotoCount = Number(row?.active_photo_count);
    if (typeof row?.pet_id !== 'string' || typeof row?.name !== 'string'
      || !Number.isSafeInteger(activePhotoCount) || activePhotoCount < 1) {
      throw new Error('운영 풀 응답에 잘못된 강아지 정보가 있습니다.');
    }
    return Object.freeze({
      petId: row.pet_id,
      name: row.name,
      activePhotoCount,
    });
  });
}

export function makePoolReport(pets, minimum = DEFAULT_MINIMUM_PET_COUNT) {
  const ready = pets.length >= minimum;
  const lines = [
    `[pet-pool] 실사 확인 가능한 승인견 ${pets.length}/${minimum}마리`,
    ...(pets.length > 0
      ? pets.map((pet) => `- ${pet.name} · 활성 사진 ${pet.activePhotoCount}장`)
      : ['- 등록된 강아지가 없습니다.']),
  ];
  if (ready) {
    lines.push('[pet-pool] 운영 기준을 충족했습니다.');
  } else {
    lines.push(`[pet-pool] 운영 전 ${minimum - pets.length}마리를 더 승인해 주세요.`);
  }
  return Object.freeze({ ready, text: lines.join('\n') });
}

async function main() {
  const minimum = parseMinimum(process.argv.slice(2));
  const config = loadReviewConfig();
  const pets = await fetchApprovedPetPool(config);
  const report = makePoolReport(pets, minimum);
  console.log(report.text);
  if (!report.ready) process.exitCode = 1;
}

const entryPath = process.argv[1] ? pathToFileURL(resolve(process.argv[1])).href : '';
if (entryPath === import.meta.url) {
  main().catch((error) => {
    console.error(`[pet-pool] ${error instanceof Error ? error.message : '점검 중 오류가 발생했습니다.'}`);
    process.exitCode = 2;
  });
}
