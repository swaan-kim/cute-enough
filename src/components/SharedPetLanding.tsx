import { Button, Top } from '@toss/tds-mobile';
import type { PetSummary } from '../types';
import { PetArtwork } from './PetArtwork';

export function SharedPetLanding({ pet, onMeet, onHome }: { pet: PetSummary; onMeet: () => void; onHome: () => void }) {
  const pending = pet.approvalStatus === 'pending';
  return (
    <main className="shared-screen">
      <Top
        className="shared-top"
        upperGap={24}
        lowerGap={8}
        title={<Top.TitleParagraph size={28}>{pet.name ?? '이 친구'}가<br />기다리고 있어요</Top.TitleParagraph>}
        subtitleBottom={<Top.SubtitleParagraph>{pending ? <>검수 중 · 캐릭터와 먼저 놀아보세요.<br />실제 사진은 승인 후 공개해요.</> : '간식을 주고 귀여운 모습을 만나보세요.'}</Top.SubtitleParagraph>}
      />
      <section className="shared-stage" aria-label={`${pet.name ?? '강아지'} 초대장`}>
        <span className="shared-heart" aria-hidden="true">♥</span>
        <PetArtwork pet={pet} size={255} panting />
      </section>
      <div className="shared-actions">
        <Button display="full" size="large" onClick={onMeet}>{pending ? '캐릭터와 놀아보기' : '이 친구 만나기'}</Button>
        <Button display="full" size="large" color="dark" variant="weak" onClick={onHome}>다른 친구도 보기</Button>
      </div>
    </main>
  );
}
