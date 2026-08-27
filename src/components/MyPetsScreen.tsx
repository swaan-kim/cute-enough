import { Button, Top } from '@toss/tds-mobile';
import type { OwnedPetSummary, PetStatus } from '../types';
import { PetArtwork } from './PetArtwork';

const STATUS_COPY: Record<PetStatus, { label: string; description: string }> = {
  pending: { label: '검수 중', description: '내 집과 공유 링크에서 캐릭터를 먼저 만날 수 있어요.' },
  approved: { label: '승인됨', description: '이제 다른 사람의 집에도 놀러 갈 수 있어요.' },
  rejected: { label: '등록 보류', description: '현재 다른 사람에게 공개되지 않아요.' },
  paused: { label: '공개 중지', description: '확인을 위해 공개가 잠시 멈췄어요.' },
  deleted: { label: '삭제됨', description: '삭제된 사진이에요.' },
};

export function MyPetsScreen({ pets, loading, error, onRetry, onUpload, onMeet, onShare }: {
  pets: OwnedPetSummary[];
  loading: boolean;
  error: string;
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
        title={<Top.TitleParagraph size={28}>내가 소개한<br />귀여운 친구들이에요</Top.TitleParagraph>}
        subtitleBottom={<Top.SubtitleParagraph>내가 소개한 강아지만 모아볼 수 있어요.</Top.SubtitleParagraph>}
      />
      {loading ? <p className="my-pets-message">강아지들을 불러오는 중…</p>
        : error ? <div className="my-pets-message"><p>{error}</p><Button size="medium" color="dark" variant="weak" onClick={onRetry}>다시 불러오기</Button></div>
          : pets.length === 0 ? <div className="my-pets-message"><strong>아직 소개한 강아지가 없어요</strong><p>사진 한 장으로 귀여운 캐릭터를 만들어보세요.</p><Button size="medium" onClick={onUpload}>강아지 소개하기</Button></div>
            : <section className="my-pets-list" aria-label="내가 올린 강아지 목록">
              {pets.map((pet) => {
                const copy = STATUS_COPY[pet.approvalStatus];
                const canShare = pet.approvalStatus === 'pending' || pet.approvalStatus === 'approved';
                return <article className="my-pet-card" key={pet.id}>
                  <PetArtwork pet={pet} size={106} />
                  <div className="my-pet-info">
                    <span className={`pet-status status-${pet.approvalStatus}`}>{copy.label}</span>
                    <strong>{pet.name ?? '이름 없는 귀요미'}</strong>
                    <p>{copy.description}</p>
                    {pet.rejectionReason && <small>{pet.rejectionReason}</small>}
                  </div>
                  {canShare && <div className="my-pet-actions">
                    <Button size="small" onClick={() => onMeet(pet)}>만나기</Button>
                    <Button size="small" color="dark" variant="weak" onClick={() => onShare(pet)}>공유</Button>
                  </div>}
                </article>;
              })}
            </section>}
      {pets.length > 0 && <div className="my-pets-footer"><Button display="full" size="large" onClick={onUpload}>강아지 한 마리 더 소개하기</Button></div>}
      <p className="my-pets-support">사진 삭제는 오른쪽 위 ⋯ &gt; 문의하기에서 요청할 수 있어요.</p>
    </main>
  );
}
