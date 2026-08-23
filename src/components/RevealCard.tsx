import { useEffect, useRef } from 'react';
import { Asset, Button, TextButton } from '@toss/tds-mobile';
import type { PetSummary } from '../types';

export function RevealCard({ pet, photoUrl, onClose, onUpload, onReport, onShare }: { pet: PetSummary; photoUrl: string; onClose: () => void; onUpload: () => void; onReport: () => void; onShare?: () => void }) {
  const cardRef = useRef<HTMLElement>(null);
  const onCloseRef = useRef(onClose);

  useEffect(() => { onCloseRef.current = onClose; }, [onClose]);

  useEffect(() => {
    const previouslyFocused = document.activeElement instanceof HTMLElement ? document.activeElement : undefined;
    cardRef.current?.focus();
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onCloseRef.current();
      if (event.key !== 'Tab' || !cardRef.current) return;
      const focusable = Array.from(cardRef.current.querySelectorAll<HTMLElement>('button,[href],[tabindex]:not([tabindex="-1"])'))
        .filter((element) => !element.hasAttribute('disabled'));
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      previouslyFocused?.focus();
    };
  }, []);

  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true" aria-label="강아지 실사 사진">
      <article className="photo-card" ref={cardRef} tabIndex={-1}>
        <div className="photo-frame"><img src={photoUrl} alt={`${pet.name ?? '강아지'}의 실제 모습`} /></div>
        <div className="photo-meta"><Asset.Icon name="heart-line" color="#ff506f" frameShape={Asset.frameShape.CleanH24} aria-hidden="true" /><h2>{pet.name ?? '이름 없는 귀요미'}</h2><p>귀엽기만 해도, 오늘은 충분해요.</p></div>
        <div className="photo-card-actions">
          {pet.shareable && onShare && <Button display="full" size="large" onClick={onShare}>이 친구 공유하기</Button>}
          <Button display="full" size="large" onClick={onUpload}>우리 강아지도 소개하기</Button>
          <Button display="full" size="large" color="dark" variant="weak" onClick={onClose}>집으로 돌아가기</Button>
        </div>
        <TextButton className="report-button" size="small" variant="underline" color="#8b95a1" onClick={onReport}>이 사진 신고하기</TextButton>
      </article>
    </div>
  );
}
