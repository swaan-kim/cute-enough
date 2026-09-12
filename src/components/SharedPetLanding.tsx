import { Button, Top } from '@toss/tds-mobile';
import type { PetSummary } from '../types';
import { withSubjectParticle } from '../lib/koreanCopy';
import { isPetRevisitActive } from '../lib/petAccess';
import type { PetAccessDecision } from '../lib/petAccess';
import { PetArtwork } from './PetArtwork';

export function SharedPetLanding({ pet, accessDecision, onMeet, onHome }: {
  pet: PetSummary;
  accessDecision?: PetAccessDecision;
  onMeet: () => void;
  onHome: () => void;
}) {
  const pending = pet.approvalStatus === 'pending';
  const canRevisit = isPetRevisitActive(pet);
  const canOpenOwnerPhoto = Boolean(pet.isMine && pet.ownerPhotoAvailable);
  const ownerPhotoAccess = accessDecision?.kind === 'ownerPhoto' || canOpenOwnerPhoto;
  const primaryAction = ownerPhotoAccess
    ? '내 강아지 사진 보기'
    : pending || accessDecision?.kind === 'characterOnly'
      ? '캐릭터와 놀아보기'
      : accessDecision?.kind === 'revisit' || canRevisit
        ? '사진 다시 보기'
        : accessDecision?.kind === 'reveal' && accessDecision.method === 'FREE'
          ? '무료 티켓으로 만나기'
          : accessDecision?.kind === 'reveal' && accessDecision.method === 'REWARDED'
            ? '광고 보고 지금 만나기'
            : accessDecision?.kind === 'unavailable'
              ? '지금은 만날 수 없어요'
              : accessDecision?.kind === 'exhausted'
                ? '티켓 충전 중'
                : '간식 주고 만나기';
  const primaryDisabled = accessDecision?.kind === 'unavailable' || accessDecision?.kind === 'exhausted';
  return (
    <main className="shared-screen">
      <Top
        className="shared-top"
        upperGap={24}
        lowerGap={8}
        title={<Top.TitleParagraph size={28}>{withSubjectParticle(pet.name ?? '이 친구')}<br />기다리고 있어요</Top.TitleParagraph>}
        subtitleBottom={<Top.SubtitleParagraph>{pending
          ? ownerPhotoAccess
            ? <>검수 중 · 사진은 나만 볼 수 있어요.<br />승인되면 이 링크로 함께 볼 수 있어요.</>
            : <>검수 중 · 캐릭터와 먼저 놀아보세요.<br />실제 사진은 승인 후 공개해요.</>
          : canRevisit ? '방금 만난 친구예요. 사진을 바로 다시 볼 수 있어요.' : '간식을 주고 귀여운 모습을 만나보세요.'}</Top.SubtitleParagraph>}
      />
      <section className="shared-stage" aria-label={`${pet.name ?? '강아지'} 초대장`}>
        <span className={`shared-status-badge ${pending ? 'is-pending' : 'is-approved'}`}>{pending ? '검수 중' : '승인됨'}</span>
        <span className="shared-heart" aria-hidden="true">♥</span>
        <PetArtwork pet={pet} size={255} panting />
      </section>
      {pending && (ownerPhotoAccess
        ? <p className="shared-pending-boundary" role="status"><strong>사진은 올린 사람에게만 보여요</strong><span>승인되면 같은 링크에서 다른 사람도 만날 수 있어요. 티켓은 사용하지 않아요.</span></p>
        : <p className="shared-pending-boundary" role="status"><strong>오늘은 캐릭터와만 놀아요</strong><span>실제 사진은 승인 후 이 링크에서 볼 수 있어요. 티켓은 사용하지 않아요.</span></p>)}
      <div className="shared-actions">
        <Button display="full" size="large" disabled={primaryDisabled} onClick={onMeet}>{primaryAction}</Button>
        <Button display="full" size="large" color="dark" variant="weak" onClick={onHome}>다른 친구도 보기</Button>
      </div>
    </main>
  );
}
