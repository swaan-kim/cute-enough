import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { PetArtwork } from '../components/PetArtwork';
import { reviewApi as defaultReviewApi } from './api';
import type { ReviewApi, ReviewDecision, ReviewQueueItem } from './types';

type LoadPhase = 'loading' | 'ready' | 'error';

type PendingReview = {
  item: ReviewQueueItem;
  decision: ReviewDecision;
};

type ToastNotice = {
  id: number;
  message: string;
};

type ReviewAppProps = {
  api?: ReviewApi;
};

const submittedAtFormatter = new Intl.DateTimeFormat('ko-KR', {
  dateStyle: 'medium',
  timeStyle: 'short',
});

export function formatSubmittedAt(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '등록 시간 확인 불가' : submittedAtFormatter.format(date);
}

export function getPetDisplayName(item: Pick<ReviewQueueItem, 'name'>) {
  return item.name?.trim() || '이름 없는 강아지';
}

function LoadingState() {
  return (
    <section className="review-state review-state--loading" aria-live="polite" aria-busy="true">
      <span className="review-spinner" aria-hidden="true" />
      <h2>검수 목록을 불러오고 있어요</h2>
      <p>등록된 사진과 캐릭터를 안전하게 준비하는 중입니다.</p>
    </section>
  );
}

function ErrorState({ onRetry }: { onRetry: () => void }) {
  return (
    <section className="review-state review-state--error" role="alert">
      <span className="review-state-mark" aria-hidden="true">!</span>
      <h2>목록을 불러오지 못했어요</h2>
      <p>잠시 후 다시 시도해 주세요.</p>
      <button className="review-button review-button--primary" type="button" onClick={onRetry}>
        다시 불러오기
      </button>
    </section>
  );
}

function EmptyState() {
  return (
    <section className="review-state review-state--empty">
      <span className="review-state-mark review-state-mark--done" aria-hidden="true">✓</span>
      <h2>검수할 강아지가 없어요</h2>
      <p>새 등록이 들어오면 이곳에 표시됩니다.</p>
    </section>
  );
}

function PhotoPanel({ item, onPhotoLoaded }: { item: ReviewQueueItem; onPhotoLoaded: () => void }) {
  const [selectedPhoto, setSelectedPhoto] = useState(0);
  const [failedPhotos, setFailedPhotos] = useState<ReadonlySet<number>>(() => new Set());
  const hasPhoto = item.photoPresent && item.photoUrls.length > 0;
  const selectedUrl = item.photoUrls[selectedPhoto];
  const selectedFailed = failedPhotos.has(selectedPhoto);
  const displayName = getPetDisplayName(item);

  useEffect(() => {
    setSelectedPhoto(0);
    setFailedPhotos(new Set());
  }, [item.photoUrls]);

  const markPhotoFailed = () => {
    setFailedPhotos((current) => new Set(current).add(selectedPhoto));
  };

  return (
    <div className="review-photo-panel">
      <div className="review-section-heading">
        <span>등록 실사</span>
        <span className={`review-photo-status ${item.photoPresent ? 'is-present' : 'is-missing'}`}>
          {item.photoPresent ? '사진 있음' : '사진 없음'}
        </span>
      </div>

      <div className="review-photo-frame">
        {hasPhoto && !selectedFailed ? (
          <img
            src={selectedUrl}
            alt={`${displayName} 실사 사진 ${selectedPhoto + 1}`}
            onLoad={onPhotoLoaded}
            onError={markPhotoFailed}
          />
        ) : (
          <div className="review-photo-placeholder" role="img" aria-label={`${displayName} 실사 사진 없음`}>
            <span aria-hidden="true">사진</span>
            <strong>{selectedFailed || item.photoPresent ? '사진을 불러올 수 없어요' : '저장된 사진이 없어요'}</strong>
            <small>{selectedFailed || item.photoPresent ? '다른 사진을 선택하거나 새로고침해 주세요.' : '사진이 확인되어야 승인할 수 있습니다.'}</small>
          </div>
        )}
      </div>

      {item.photoUrls.length > 1 && (
        <div className="review-photo-thumbnails" aria-label={`${displayName} 사진 목록`}>
          {item.photoUrls.map((url, index) => (
            <button
              className={index === selectedPhoto ? 'is-selected' : ''}
              type="button"
              key={`${item.petId}-${index}`}
              aria-label={`${displayName} 사진 ${index + 1} 보기`}
              aria-pressed={index === selectedPhoto}
              onClick={() => setSelectedPhoto(index)}
            >
              {failedPhotos.has(index) ? (
                <span aria-hidden="true">!</span>
              ) : (
                <img src={url} alt="" onError={() => setFailedPhotos((current) => new Set(current).add(index))} />
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function ReviewCard({
  item,
  disabled,
  onOpenReview,
}: {
  item: ReviewQueueItem;
  disabled: boolean;
  onOpenReview: (item: ReviewQueueItem, decision: ReviewDecision) => void;
}) {
  const displayName = getPetDisplayName(item);
  const [photoSeen, setPhotoSeen] = useState(false);
  const pet = useMemo(() => ({
    id: item.petId,
    name: displayName,
    traits: item.traits,
  }), [displayName, item.petId, item.traits]);

  useEffect(() => {
    setPhotoSeen(false);
  }, [item.photoUrls]);

  return (
    <article className="review-card" aria-labelledby={`review-pet-${item.petId}`}>
      <div className="review-card-topline">
        <div>
          <p className="review-card-eyebrow">승인 대기</p>
          <h2 id={`review-pet-${item.petId}`}>{displayName}</h2>
        </div>
        <time dateTime={item.createdAt}>{formatSubmittedAt(item.createdAt)}</time>
      </div>

      <div className="review-visuals">
        <PhotoPanel item={item} onPhotoLoaded={() => setPhotoSeen(true)} />
        <div className="review-character-panel">
          <div className="review-section-heading">
            <span>생성 캐릭터</span>
            <span className="review-character-status">미리보기</span>
          </div>
          <div className="review-character-frame">
            <PetArtwork pet={pet} size={176} />
          </div>
        </div>
      </div>

      <div className="review-card-footer">
        {(!item.photoPresent || item.photoUrls.length === 0) && (
          <p className="review-card-warning" role="note">사진이 없어 승인할 수 없습니다.</p>
        )}
        {item.photoPresent && item.photoUrls.length > 0 && !photoSeen && (
          <p className="review-card-warning" role="note">실사 사진을 확인하면 승인할 수 있습니다.</p>
        )}
        <div className="review-card-actions">
          <button
            className="review-button review-button--reject"
            type="button"
            disabled={disabled}
            onClick={() => onOpenReview(item, 'rejected')}
            aria-label={`${displayName} 반려`}
          >
            반려
          </button>
          <button
            className="review-button review-button--approve"
            type="button"
            disabled={disabled || !item.photoPresent || item.photoUrls.length === 0 || !photoSeen}
            onClick={() => onOpenReview(item, 'approved')}
            aria-label={`${displayName} 승인`}
          >
            승인
          </button>
        </div>
      </div>
    </article>
  );
}

function ReviewDialog({
  pending,
  submitting,
  error,
  onCancel,
  onSubmit,
}: {
  pending: PendingReview;
  submitting: boolean;
  error: string;
  onCancel: () => void;
  onSubmit: (reason: string) => void;
}) {
  const [reason, setReason] = useState('');
  const dialogRef = useRef<HTMLDivElement>(null);
  const isReject = pending.decision === 'rejected';
  const trimmedReason = reason.trim();
  const displayName = getPetDisplayName(pending.item);

  useEffect(() => {
    dialogRef.current?.focus();
  }, []);

  useEffect(() => {
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !submitting) onCancel();
    };
    window.addEventListener('keydown', closeOnEscape);
    return () => window.removeEventListener('keydown', closeOnEscape);
  }, [onCancel, submitting]);

  return (
    <div
      className="review-dialog-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !submitting) onCancel();
      }}
    >
      <div
        className="review-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="review-dialog-title"
        aria-describedby="review-dialog-description"
        tabIndex={-1}
        ref={dialogRef}
      >
        <p className={`review-dialog-kicker ${isReject ? 'is-reject' : 'is-approve'}`}>
          {isReject ? '반려 확인' : '승인 확인'}
        </p>
        <h2 id="review-dialog-title">
          {isReject ? `${displayName} 등록을 반려할까요?` : `${displayName} 등록을 승인할까요?`}
        </h2>
        <p id="review-dialog-description">
          {isReject
            ? '등록자에게 안내할 사유를 입력해 주세요.'
            : '승인 즉시 공유 링크에 반영되고, 다른 사용자의 집에는 다음날부터 등장합니다.'}
        </p>

        {isReject && (
          <label className="review-reason-field">
            <span>반려 사유 <strong>필수</strong></span>
            <textarea
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              placeholder="예: 강아지 얼굴이 잘 보이는 사진으로 다시 등록해 주세요."
              rows={4}
              maxLength={300}
              disabled={submitting}
              autoFocus
            />
            <small>{reason.length}/300</small>
          </label>
        )}

        {error && <p className="review-dialog-error" role="alert">{error}</p>}

        <div className="review-dialog-actions">
          <button
            className="review-button review-button--secondary"
            type="button"
            onClick={onCancel}
            disabled={submitting}
          >
            취소
          </button>
          <button
            className={`review-button ${isReject ? 'review-button--reject-confirm' : 'review-button--approve'}`}
            type="button"
            onClick={() => onSubmit(trimmedReason)}
            disabled={submitting || (isReject && !trimmedReason) || reason.length > 300}
          >
            {submitting ? '저장 중…' : isReject ? '반려 확정' : '승인 확정'}
          </button>
        </div>
      </div>
    </div>
  );
}

function CompletionToast({ notice, onDismiss }: { notice: ToastNotice; onDismiss: () => void }) {
  useEffect(() => {
    const timer = window.setTimeout(onDismiss, 3_500);
    return () => window.clearTimeout(timer);
  }, [notice.id, onDismiss]);

  return (
    <div className="review-toast" role="status" aria-live="polite">
      <span aria-hidden="true">✓</span>
      {notice.message}
      <button type="button" onClick={onDismiss} aria-label="알림 닫기">×</button>
    </div>
  );
}

export default function ReviewApp({ api = defaultReviewApi }: ReviewAppProps) {
  const [items, setItems] = useState<ReviewQueueItem[]>([]);
  const [phase, setPhase] = useState<LoadPhase>('loading');
  const [refreshing, setRefreshing] = useState(false);
  const [pending, setPending] = useState<PendingReview | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [dialogError, setDialogError] = useState('');
  const [toast, setToast] = useState<ToastNotice | null>(null);
  const toastId = useRef(0);

  const showToast = useCallback((message: string) => {
    toastId.current += 1;
    setToast({ id: toastId.current, message });
  }, []);

  const loadQueue = useCallback(async (background = false, signal?: AbortSignal) => {
    if (background) setRefreshing(true);
    else setPhase('loading');

    try {
      const nextItems = await api.getQueue(signal);
      setItems(nextItems);
      setPhase('ready');
      if (background) showToast('검수 목록을 새로고침했어요.');
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') return;
      if (!background) setPhase('error');
      else showToast('목록을 새로고침하지 못했어요.');
    } finally {
      if (background) setRefreshing(false);
    }
  }, [api, showToast]);

  useEffect(() => {
    const controller = new AbortController();
    void loadQueue(false, controller.signal);
    return () => controller.abort();
  }, [loadQueue]);

  const openReview = (item: ReviewQueueItem, decision: ReviewDecision) => {
    setDialogError('');
    setPending({ item, decision });
  };

  const closeReview = useCallback(() => {
    if (submitting) return;
    setPending(null);
    setDialogError('');
  }, [submitting]);

  const submitReview = async (reason: string) => {
    if (!pending) return;
    setSubmitting(true);
    setDialogError('');

    try {
      await api.review({
        petId: pending.item.petId,
        decision: pending.decision,
        ...(pending.decision === 'rejected' ? { reason } : {}),
      });
      setItems((current) => current.filter((item) => item.petId !== pending.item.petId));
      showToast(`${getPetDisplayName(pending.item)} 등록을 ${pending.decision === 'approved' ? '승인' : '반려'}했어요.`);
      setPending(null);
    } catch {
      setDialogError('결과를 저장하지 못했어요. 잠시 후 다시 시도해 주세요.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="review-shell">
      <header className="review-header">
        <div>
          <p className="review-brand">CUTE ENOUGH · INTERNAL</p>
          <div className="review-title-row">
            <h1>강아지 검수</h1>
            {phase === 'ready' && <span className="review-count" aria-label={`대기 ${items.length}건`}>{items.length}</span>}
          </div>
          <p className="review-subtitle">실사와 캐릭터를 비교한 뒤 승인하거나 반려해 주세요.</p>
        </div>
        <button
          className="review-refresh"
          type="button"
          onClick={() => void loadQueue(true)}
          disabled={phase === 'loading' || refreshing || submitting}
        >
          <span className={refreshing ? 'is-spinning' : ''} aria-hidden="true">↻</span>
          {refreshing ? '새로고침 중' : '새로고침'}
        </button>
      </header>

      <main className="review-main">
        {phase === 'loading' && <LoadingState />}
        {phase === 'error' && <ErrorState onRetry={() => void loadQueue()} />}
        {phase === 'ready' && items.length === 0 && <EmptyState />}
        {phase === 'ready' && items.length > 0 && (
          <section className="review-grid" aria-label="승인 대기 목록" aria-busy={refreshing}>
            {items.map((item) => (
              <ReviewCard
                key={item.petId}
                item={item}
                disabled={submitting}
                onOpenReview={openReview}
              />
            ))}
          </section>
        )}
      </main>

      <footer className="review-footer">내부 운영 전용 · 검수 결과는 감사 기록에 남습니다.</footer>

      {pending && (
        <ReviewDialog
          key={`${pending.item.petId}-${pending.decision}`}
          pending={pending}
          submitting={submitting}
          error={dialogError}
          onCancel={closeReview}
          onSubmit={(reason) => void submitReview(reason)}
        />
      )}

      {toast && <CompletionToast notice={toast} onDismiss={() => setToast(null)} />}
    </div>
  );
}
