import { useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type PointerEvent as ReactPointerEvent } from 'react';
import { Button, TextButton } from '@toss/tds-mobile';
import { playHaptic } from '../lib/haptics';
import type { PetSummary } from '../types';
import '../album.css';

const PHOTO_HEART_HAPTIC_COOLDOWN_MS = 300;
// The normal caption is .8125rem at the default 16px root size (13px).
// Viewport media queries alone do not detect native/text-only font scaling.
const LARGE_CAPTION_FONT_PX = 13 * 1.4;

type RevealCardProps = {
  pet: PetSummary;
  photoUrl?: string;
  photoCaption?: string;
  loading?: boolean;
  loadError?: string;
  onClose: () => void;
  onUpload: () => void;
  onReport: () => void;
  onShare?: () => void;
  onSave?: () => Promise<void> | void;
  onRetryPhoto?: () => Promise<void> | void;
  retryPhotoLabel?: string;
  isFavorite?: boolean;
  favoritePending?: boolean;
  onFavoriteChange?: (isFavorite: boolean) => void;
  onPreviousPhoto?: () => void;
  onNextPhoto?: () => void;
  photoPosition?: { index: number; total: number };
};

export function RevealCard({ pet, photoUrl, photoCaption, loading = false, loadError, onClose, onUpload, onReport, onShare, onSave, onRetryPhoto, retryPhotoLabel = '다시 불러오기', isFavorite = false, favoritePending = false, onFavoriteChange, onPreviousPhoto, onNextPhoto, photoPosition }: RevealCardProps) {
  const cardRef = useRef<HTMLElement>(null);
  const captionRowRef = useRef<HTMLParagraphElement>(null);
  const onCloseRef = useRef(onClose);
  const heartIdRef = useRef(0);
  const lastHeartHapticAtRef = useRef(Number.NEGATIVE_INFINITY);
  const [tapHeart, setTapHeart] = useState<{ id: number; x: number; y: number }>();
  const [saving, setSaving] = useState(false);
  const [imageError, setImageError] = useState(false);
  const [retryingPhoto, setRetryingPhoto] = useState(false);
  const [photoAttempt, setPhotoAttempt] = useState(0);
  const [largeCaptionText, setLargeCaptionText] = useState(false);

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
  const caption = photoCaption?.trim() ?? '';
  const ownerPhoto = Boolean(pet.isMine || pet.ownerPhotoAvailable);
  const collection = !ownerPhoto ? pet.collection : undefined;
  const allPhotosCollected = Boolean(collection && collection.totalCount > 0 && collection.collectedCount >= collection.totalCount);
  const captionVisible = ready && Boolean(collection || caption);

  useEffect(() => {
    const row = captionRowRef.current;
    if (!captionVisible || !row) return;
    const measureFont = () => {
      const fontSize = Number.parseFloat(window.getComputedStyle(row).fontSize);
      setLargeCaptionText(Number.isFinite(fontSize) && fontSize >= LARGE_CAPTION_FONT_PX);
    };
    measureFont();
    const resizeObserver = typeof ResizeObserver === 'undefined' ? undefined : new ResizeObserver(measureFont);
    resizeObserver?.observe(row);
    // Native font settings and text-only zoom may keep viewport width unchanged.
    const styleObserver = new MutationObserver(measureFont);
    for (const element of [document.documentElement, document.body]) {
      styleObserver.observe(element, { attributes: true, attributeFilter: ['style', 'class'] });
    }
    window.addEventListener('resize', measureFont);
    return () => {
      resizeObserver?.disconnect();
      styleObserver.disconnect();
      window.removeEventListener('resize', measureFont);
    };
  }, [captionVisible]);

  const favoriteButton = onFavoriteChange ? <button type="button" className="photo-favorite" aria-label={isFavorite ? '마음에 담았어요, 마음에 담기 취소' : '또 보고 싶어요, 마음에 담기'} aria-pressed={isFavorite} aria-busy={favoritePending} disabled={favoritePending} onClick={() => onFavoriteChange(!isFavorite)}><span aria-hidden="true">{isFavorite ? '♥' : '♡'}</span><span>{isFavorite ? '마음에 담았어요' : '또 보고 싶어요'}</span></button> : null;

  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true" aria-label="강아지 실사 사진">
      <article className="photo-card" ref={cardRef} tabIndex={-1} data-large-text={largeCaptionText ? 'true' : undefined}>
        <header className="photo-card-header photo-card-header--close-only">
          <button type="button" onClick={onClose} aria-label="사진 닫기">×</button>
        </header>
        <div className="photo-card-content">
        <div className="photo-card-main">
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
              <Button size="medium" color="dark" variant="weak" disabled={retryingPhoto} loading={retryingPhoto} onClick={() => void handleRetryPhoto()}>{retryPhotoLabel}</Button>
            </div>
          ) : photoUrl ? (
            <button
              className="photo-frame photo-like-surface"
              type="button"
              aria-label={`${pet.name ?? '강아지'} 사진에 하트 효과 보기`}
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
        {photoPosition && photoPosition.total > 1 && <nav className="photo-album-navigation" aria-label="모은 사진 넘기기">
          <button type="button" aria-label="이전 사진" disabled={loading || photoPosition.index <= 0 || !onPreviousPhoto} onClick={onPreviousPhoto}>‹</button>
          <span aria-live="polite" aria-atomic="true">사진 {photoPosition.index + 1}/{photoPosition.total}</span>
          <button type="button" aria-label="다음 사진" disabled={loading || photoPosition.index >= photoPosition.total - 1 || !onNextPhoto} onClick={onNextPhoto}>›</button>
        </nav>}
        {ready && <>
          <div className={`photo-meta${favoriteButton ? ' photo-meta--with-favorite' : ''}`}>
            <div className="photo-meta-heading"><h2>{pet.name ?? '이름 없는 귀요미'}</h2>{favoriteButton}</div>
            {(collection || caption) && <p className="photo-caption-row" ref={captionRowRef}>
              {collection && <span className="photo-collection-count">모은 사진 {collection.collectedCount}/{collection.totalCount}</span>}
              {collection && caption && <span className="photo-caption-divider" aria-hidden="true">·</span>}
              {caption && <span className="photo-caption" title={caption}>{caption}</span>}
            </p>}
            {collection && <p className="photo-collection-hint">{allPhotosCollected ? '모두 모았어요' : '다시 놀러 오면 다음 사진도 만나요'}</p>}
          </div>
        </>}
        </div>
        {ready && <div className="photo-card-secondary-actions">
            <TextButton className="photo-upload-link" size="small" onClick={onUpload}>우리 강아지도 소개하기</TextButton>
            <TextButton className="report-button" size="small" variant="underline" color="#6b7684" onClick={onReport}>이 사진 신고하기</TextButton>
        </div>}
        </div>
        {ready && pet.shareable && onShare && <footer className="photo-card-actions">
          <Button display="full" size="large" onClick={onShare}>이 귀여움 같이 보기</Button>
        </footer>}
      </article>
    </div>
  );
}
