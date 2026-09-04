import { useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type PointerEvent as ReactPointerEvent } from 'react';
import { Asset, Button, TextButton } from '@toss/tds-mobile';
import { playHaptic } from '../lib/haptics';
import type { PetSummary } from '../types';

const PHOTO_HEART_HAPTIC_COOLDOWN_MS = 300;

type RevealCardProps = {
  pet: PetSummary;
  photoUrl?: string;
  loading?: boolean;
  loadError?: string;
  milestoneText?: string;
  onClose: () => void;
  onUpload: () => void;
  onReport: () => void;
  onShare?: () => void;
  onSave?: () => Promise<void> | void;
  onRetryPhoto?: () => Promise<void> | void;
};

export function RevealCard({ pet, photoUrl, loading = false, loadError, milestoneText, onClose, onUpload, onReport, onShare, onSave, onRetryPhoto }: RevealCardProps) {
  const cardRef = useRef<HTMLElement>(null);
  const onCloseRef = useRef(onClose);
  const heartIdRef = useRef(0);
  const lastHeartHapticAtRef = useRef(Number.NEGATIVE_INFINITY);
  const [tapHeart, setTapHeart] = useState<{ id: number; x: number; y: number }>();
  const [saving, setSaving] = useState(false);
  const [imageError, setImageError] = useState(false);
  const [retryingPhoto, setRetryingPhoto] = useState(false);
  const [photoAttempt, setPhotoAttempt] = useState(0);

  useEffect(() => { onCloseRef.current = onClose; }, [onClose]);

  useEffect(() => {
    setImageError(false);
    setRetryingPhoto(false);
    setPhotoAttempt(0);
  }, [photoUrl]);

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
    const now = Date.now();
    if (now - lastHeartHapticAtRef.current >= PHOTO_HEART_HAPTIC_COOLDOWN_MS) {
      lastHeartHapticAtRef.current = now;
      void playHaptic('photoHeart');
    }
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

  async function handleRetryPhoto() {
    if (retryingPhoto) return;
    setRetryingPhoto(true);
    try {
      await onRetryPhoto?.();
      setPhotoAttempt((attempt) => attempt + 1);
      setImageError(false);
    } catch {
      setImageError(true);
    } finally {
      setRetryingPhoto(false);
    }
  }

  const failed = Boolean(loadError) || imageError;
  const ready = Boolean(photoUrl) && !loading && !failed;

  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true" aria-label="강아지 실사 사진">
      <article className="photo-card" ref={cardRef} tabIndex={-1}>
        <header className="photo-card-header">
          <span>{milestoneText ?? `${pet.name ?? '강아지'}의 사진`}</span>
          <button type="button" onClick={onClose} aria-label="사진 닫기">×</button>
        </header>
        <div className="photo-media">
          {loading ? (
            <div className="photo-frame photo-skeleton" role="status" aria-live="polite">
              <span className="photo-skeleton-heart" aria-hidden="true">♡</span>
              <strong>사진을 꺼내고 있어요</strong>
            </div>
          ) : failed ? (
            <div className="photo-frame photo-error" role="status" aria-live="polite">
              <span className="photo-error-icon" aria-hidden="true">♡</span>
              <strong>사진을 불러오지 못했어요</strong>
              <p>{loadError ?? '잠시 후 다시 불러와 주세요.'}</p>
              <Button size="medium" color="dark" variant="weak" disabled={retryingPhoto} loading={retryingPhoto} onClick={() => void handleRetryPhoto()}>다시 불러오기</Button>
            </div>
          ) : photoUrl ? (
            <button
              className="photo-frame photo-like-surface"
              type="button"
              aria-label={`${pet.name ?? '강아지'} 사진에 하트 보내기`}
              onPointerDown={handlePhotoPointerDown}
              onKeyDown={handlePhotoKeyDown}
            >
              <img
                key={`${photoUrl}-${photoAttempt}`}
                src={photoUrl}
                alt={`${pet.name ?? '강아지'}의 실제 모습`}
                onLoad={() => void playHaptic('photoReveal')}
                onError={() => setImageError(true)}
              />
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
          ) : null}
          {onSave && ready && (
            <button
              className="photo-save-button"
              type="button"
              disabled={saving}
              onClick={() => void handleSave()}
            >{saving ? '저장 중' : '사진 저장'}</button>
          )}
        </div>
        {ready && <>
          <div className="photo-meta"><Asset.Icon name="heart-line" color="#ff506f" frameShape={Asset.frameShape.CleanH24} aria-hidden="true" /><h2>{pet.name ?? '이름 없는 귀요미'}</h2><p>귀엽기만 해도, 오늘은 충분해요.</p></div>
          <div className="photo-card-actions">
            {pet.shareable && onShare && <Button display="full" size="large" onClick={onShare}>이 귀여움 같이 보기</Button>}
            <Button display="full" size="large" color="dark" variant="weak" onClick={onClose}>돌아가기</Button>
            <TextButton className="photo-upload-link" size="small" onClick={onUpload}>우리 강아지도 소개하기</TextButton>
          </div>
          <TextButton className="report-button" size="small" variant="underline" color="#6b7684" onClick={onReport}>이 사진 신고하기</TextButton>
        </>}
      </article>
    </div>
  );
}
