import { Asset, Button, TextButton } from '@toss/tds-mobile';
import type { PetSummary } from '../types';

export function RevealCard({ pet, photoUrl, onClose, onUpload, onReport }: { pet: PetSummary; photoUrl: string; onClose: () => void; onUpload: () => void; onReport: () => void }) {
  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true" aria-label="강아지 실사 사진">
      <article className="photo-card">
        <div className="photo-frame"><img src={photoUrl} alt={`${pet.name ?? '강아지'}의 실제 모습`} /></div>
        <div className="photo-meta"><Asset.Icon name="heart-line" color="#ff506f" frameShape={Asset.frameShape.CleanH24} aria-hidden="true" /><h2>{pet.name ?? '이름 없는 귀요미'}</h2><p>귀엽기만 해도, 오늘은 충분해요.</p></div>
        <div className="photo-card-actions">
          <Button display="full" size="large" onClick={onUpload}>우리 강아지도 소개하기</Button>
          <Button display="full" size="large" color="dark" variant="weak" onClick={onClose}>집으로 돌아가기</Button>
        </div>
        <TextButton className="report-button" size="small" variant="underline" color="#8b95a1" onClick={onReport}>이 사진 신고하기</TextButton>
      </article>
    </div>
  );
}
