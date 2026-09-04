import type { PetStyleV1, PetTraitsV1 } from '../types';
import type { ReviewQueueItem } from './types';

export interface CuratedReviewDraft {
  displayName: string;
  traits: PetTraitsV1;
  style: PetStyleV1;
  reviewNote: string;
  summary: string;
}

const TITI_ID = '36d0b0eb-32b6-48d7-b505-31a58d4bf4f7';
const BAECHU_ID = 'fb1bca0b-3fbb-4b51-a392-c99866f6195d';

/** 사진을 직접 확인한 초기 등록견의 검수 초안이에요. 승인 전까지는 DB에 반영하지 않아요. */
export function getCuratedReviewDraft(item: Pick<ReviewQueueItem, 'petId' | 'name' | 'submittedTraits'>): CuratedReviewDraft | undefined {
  if (item.petId === TITI_ID) {
    return {
      displayName: '티티',
      traits: {
        ...item.submittedTraits,
        earShape: 'floppy',
        headShape: 'round',
        muzzle: 'medium',
        baseColor: 'gray',
        secondaryColor: 'gray',
        markingPattern: 'none',
      },
      style: {
        schemaVersion: 1,
        coatMode: 'solid',
        furStyle: 'fluffy',
        expression: { browStyle: 'soft', tongueShape: 'side' },
      },
      reviewNote: '회색 단색 털과 복슬한 윤곽을 유지하고, 사진 속 산책 가방을 티티 전용 회색 가방으로 반영함.',
      summary: '회색 복슬 털 · 자연스러운 진회색 귀 · 옆으로 나온 혀 · 전용 산책 가방',
    };
  }

  if (item.petId === BAECHU_ID) {
    return {
      displayName: item.name?.trim() || '배추',
      traits: {
        ...item.submittedTraits,
        earShape: 'floppy',
        headShape: 'oval',
        muzzle: 'medium',
        baseColor: 'white',
        secondaryColor: 'white',
        markingPattern: 'none',
      },
      style: {
        schemaVersion: 1,
        coatMode: 'solid',
        furStyle: 'cloud',
        expression: { browStyle: 'soft', tongueShape: 'round' },
      },
      reviewNote: '실사에 없는 얼굴 얼룩은 제거하고 몽글한 흰 털을 살림. 사진의 생일 모자와 턱받이를 배추 전용 생일 세트로 반영함.',
      summary: '흰색 몽글 털 · 얼굴 무늬 없음 · 분홍 생일 모자와 턱받이',
    };
  }

  return undefined;
}
