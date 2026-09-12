import { validatePetDesign } from '../../supabase/functions/_shared/pet-design';
import { PetDesignSvg } from '../components/PetDesignSvg';
import { ReviewPetArtwork } from './ReviewPetArtwork';
import type { ReviewCatalogItem } from './types';

export function catalogArtworkStatus(item: ReviewCatalogItem) {
  if (item.designStatus === 'unavailable') return 'unavailable';
  if (!item.publishedDesign) return 'missing';
  if (item.publishedDesign.designVersion !== item.designVersion) return 'version-mismatch';
  try { validatePetDesign(item.publishedDesign.document); return 'ready'; } catch { return 'unavailable'; }
}

export const CATALOG_ARTWORK_LABELS = {
  missing: 'SVG 미확정 · 현재 그림은 검수 초안',
  ready: '확정 SVG 저장됨 · 디자인 버전 일치',
  'version-mismatch': '저장 SVG와 디자인 버전 불일치 · 재확인 필요',
  unavailable: '확정 SVG 불러오기 실패 · 새로고침 필요',
};

export function ReviewCatalogArtwork({ item, loading, onReload }: {
  item: ReviewCatalogItem; loading: boolean; onReload: () => void;
}) {
  const status = catalogArtworkStatus(item);
  if (status === 'missing') return <ReviewPetArtwork pet={{
    id: item.petId, name: item.name ?? undefined, traits: item.traits,
    publishedStyle: item.publishedStyle, publishedAccessory: item.publishedAccessory ?? undefined,
    designVersion: item.designVersion,
  }} document={item.draftDesign?.document} size={114} />;

  return <figure className="review-saved-artwork" data-artwork-status={status} data-design-sha256={item.publishedDesign?.sha256}>
    {status === 'ready' ? <PetDesignSvg document={item.publishedDesign!.document} name={item.name ?? undefined} size={114} />
      : <div role="status">{status === 'version-mismatch' ? 'SVG 버전 확인 필요' : 'SVG 확인 필요'}
        <button type="button" onClick={onReload} disabled={loading}>저장본 새로고침</button>
      </div>}
  </figure>;
}
