import { useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type PointerEvent as ReactPointerEvent } from 'react';
import { Asset, Button, TextButton } from '@toss/tds-mobile';
import type { PetSummary } from '../types';

type RevealCardProps = {
  pet: PetSummary;
  photoUrl: string;
  onClose: () => void;
  onUpload: () => void;
  onReport: () => void;
  onShare?: () => void;
  onSave?: () => Promise<void> | void;
};

export function RevealCard({ pet, photoUrl, onClose, onUpload, onReport, onShare, onSave }: RevealCardProps) {
  const cardRef = useRef<HTMLElement>(null);
  const onCloseRef = useRef(onClose);
  const heartIdRef = useRef(0);
  const [tapHeart, setTapHeart] = useState<{ id: number; x: number; y: number }>();
  const [saving, setSaving] = useState(false);

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

  useEffect(() => {
    if (!tapHeart) return;
    const timer = window.setTimeout(() => setTapHeart(undefined), 900);
    return () => window.clearTimeout(timer);
  }, [tapHeart]);

  function showHeart(x: number, y: number) {
    heartIdRef.current += 1;
    setTapHeart({ id: heartIdRef.current, x, y });
  }

  function handlePhotoPointerDown(event: ReactPointerEvent<HTMLButtonElement>) {
    const bounds = event.currentTarget.getBoundingClientRect();
    const x = bounds.width > 0 ? ((event.clientX - bounds.left) / bounds.width) * 100 : 50;
    const y = bounds.height > 0 ? ((event.clientY - bounds.top) / bounds.height) * 100 : 50;
    showHeart(Math.max(12, Math.min(88, x)), Math.max(12, Math.min(88, y)));
  }

  function handlePhotoKeyDown(event: ReactKeyboardEvent<HTMLButtonElement>) {
    if (event.key !== 'Enter' && event.key !== ' ') return;
    event.preventDefault();
    showHeart(50, 50);
  }

  async function handleSave() {
    if (!onSave || saving) return;
    setSaving(true);
    try {
      await onSave();
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true" aria-label="강아지 실사 사진">
      <article className="photo-card" ref={cardRef} tabIndex={-1}>
        <div className="photo-media">
          <button
            className="photo-frame photo-like-surface"
            type="button"
            aria-label={`${pet.name ?? '강아지'} 사진에 하트 보내기`}
            onPointerDown={handlePhotoPointerDown}
            onKeyDown={handlePhotoKeyDown}
          >
            <img src={photoUrl} alt={`${pet.name ?? '강아지'}의 실제 모습`} />
            <span className="photo-watermark-preview" aria-hidden="true"><i />{pet.name || '강아지'}</span>
            {tapHeart && (
              <span
                key={tapHeart.id}
                className="photo-tap-heart"
                style={{ left: `${tapHeart.x}%`, top: `${tapHeart.y}%` }}
                aria-hidden="true"
              >♥</span>
            )}
          </button>
          {onSave && (
            <button
              className="photo-save-button"
              type="button"
              disabled={saving}
              onClick={() => void handleSave()}
            >{saving ? '저장 중' : '사진 저장'}</button>
          )}
        </div>
        <div className="photo-meta"><Asset.Icon name="heart-line" color="#ff506f" frameShape={Asset.frameShape.CleanH24} aria-hidden="true" /><h2>{pet.name ?? '이름 없는 귀요미'}</h2><p>귀엽기만 해도, 오늘은 충분해요.</p></div>
        <div className="photo-card-actions">
          {pet.shareable && onShare && <Button display="full" size="large" onClick={onShare}>이 귀여움 같이 보기</Button>}
          <Button display="full" size="large" onClick={onUpload}>우리 강아지도 소개하기</Button>
          <Button display="full" size="large" color="dark" variant="weak" onClick={onClose}>집으로 돌아가기</Button>
        </div>
        <TextButton className="report-button" size="small" variant="underline" color="#8b95a1" onClick={onReport}>이 사진 신고하기</TextButton>
      </article>
    </div>
  );
}
