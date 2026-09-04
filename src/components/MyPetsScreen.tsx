import { Button, Top } from '@toss/tds-mobile';
import type { OwnedPetSummary, PetStatus } from '../types';
import { PetArtwork } from './PetArtwork';

const STATUS_COPY: Record<PetStatus, { label: string; description: string }> = {
  pending: { label: '검수 중', description: '사진은 나만 볼 수 있어요' },
  approved: { label: '승인됨', description: '다른 사람도 만날 수 있어요' },
  rejected: { label: '등록 보류', description: '사진을 다시 확인하고 있어요' },
  paused: { label: '공개 중지', description: '공개가 잠시 멈췄어요' },
  deleted: { label: '삭제됨', description: '더 이상 볼 수 없는 사진이에요' },
};

const STATUS_UX_COPY: Record<PetStatus, { label: string; description: string }> = {
  ...STATUS_COPY,
  approved: { label: '승인됨', description: '모두가 만날 수 있어요' },
  rejected: { label: '등록하지 못했어요', description: '반려 사유를 확인해 주세요' },
  paused: { label: '공개 일시정지', description: '공개가 잠시 멈췄어요' },
};

function getStatusCopy(status: PetStatus) {
  return STATUS_UX_COPY[status];
}

export function MyPetsScreen({ pets, loading, error, uploadRewardPetId, onRetry, onUpload, onMeet, onShare }: {
  pets: OwnedPetSummary[];
  loading: boolean;
  error: string;
  uploadRewardPetId?: string;
  onRetry: () => void;
  onUpload: () => void;
  onMeet: (pet: OwnedPetSummary) => void;
  onShare: (pet: OwnedPetSummary) => void;
}) {
  return (
    <main className="my-pets-screen">
      <Top
        className="my-pets-top"
        upperGap={18}
        lowerGap={10}
        title={<Top.TitleParagraph size={28}>내가 소개한 강아지</Top.TitleParagraph>}
        subtitleBottom={<Top.SubtitleParagraph>등록 상태와 사진을 한곳에서 확인해요.</Top.SubtitleParagraph>}
      />
      {loading ? <p className="my-pets-message">강아지들을 불러오는 중…</p>
        : error ? <div className="my-pets-message"><p>{error}</p><Button size="medium" color="dark" variant="weak" onClick={onRetry}>다시 불러오기</Button></div>
          : pets.length === 0 ? <div className="my-pets-message"><strong>아직 소개한 강아지가 없어요</strong><p>사진 한 장으로 귀여운 캐릭터를 만들어보세요.</p><Button size="medium" onClick={onUpload}>강아지 소개하기</Button></div>
            : <section className="my-pets-list" aria-label="내가 소개한 강아지 목록">
              {pets.map((pet) => {
                const copy = getStatusCopy(pet.approvalStatus);
                const publishable = pet.approvalStatus === 'pending' || pet.approvalStatus === 'approved';
                const canOpenPhoto = publishable && Boolean(pet.ownerPhotoAvailable);
                const hasUploadReward = pet.id === uploadRewardPetId;
                const canMeet = canOpenPhoto || hasUploadReward;
                const meetLabel = canOpenPhoto
                  ? '사진 바로 보기'
                  : hasUploadReward ? '간식 주고 사진 보기' : '사진 확인 중';
                return <article className="my-pet-card" key={`${pet.id}-${pet.designVersion ?? 1}`}>
                  <span className="my-pet-artwork" aria-hidden="true"><PetArtwork pet={pet} size={78} /></span>
                  <div className="my-pet-info">
                    <strong>{pet.name ?? '이름 없는 귀요미'}</strong>
                    <p><span className={`pet-status status-${pet.approvalStatus}`}>{copy.label}</span><span aria-hidden="true"> · </span>{copy.description}</p>
                    {pet.rejectionReason && <small>반려 사유 · {pet.rejectionReason}</small>}
                    {pet.approvalStatus === 'paused' && <small className="my-pet-guidance">오른쪽 위 ⋯ &gt; 문의하기에서 확인해 주세요.</small>}
                  </div>
                  {publishable && <div className="my-pet-actions">
                    <Button size="small" disabled={!canMeet} onClick={() => onMeet(pet)}>{meetLabel}</Button>
                    <Button size="small" color="dark" variant="weak" onClick={() => onShare(pet)}>{pet.approvalStatus === 'pending' ? '캐릭터 같이 보기' : '이 귀여움 같이 보기'}</Button>
                  </div>}
                  {pet.approvalStatus === 'rejected' && <div className="my-pet-actions"><Button size="small" onClick={onUpload}>다른 사진으로 다시 소개하기</Button></div>}
                </article>;
              })}
            </section>}
      {pets.length > 0 && <div className="my-pets-footer"><Button display="full" size="large" onClick={onUpload}>강아지 한 마리 더 소개하기</Button></div>}
      <p className="my-pets-support">사진 삭제는 오른쪽 위 ⋯ &gt; 문의하기에서 요청할 수 있어요.</p>
    </main>
  );
}
