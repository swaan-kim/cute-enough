import { useEffect, useRef, useState } from 'react';
import type { ReviewApi, ReviewPhoto, ReviewPhotoSet } from './types';

export function legacyReviewPhotos(urls: string[]): ReviewPhoto[] {
  return urls.map((url, index) => ({ photoId: `legacy:${url}`, url, caption: null, sortOrder: index, isActive: true, available: true }));
}

export function activeReviewPhotos(photos: ReviewPhoto[]) {
  return photos.filter((photo) => photo.isActive).sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0));
}

export function reviewPhotoCaptionError(caption: string) {
  if (Array.from(caption).length > 30) return '문구는 30자까지 입력해 주세요.';
  if (/[<>\u0000-\u001f\u007f-\u009f\u200b-\u200f\u2028-\u202e\u2060-\u206f\ufeff]/u.test(caption)) return '문구에는 한 줄의 일반 텍스트만 입력해 주세요.';
  return '';
}

type GalleryProps = {
  name: string;
  photos: ReviewPhoto[];
  selectedId?: string;
  onSelect?: (photoId: string) => void;
  onPhotoLoaded?: (url: string) => void;
  onPhotoFailed?: (url: string) => void;
  onDownload?: (url: string) => void;
  disabled?: boolean;
  reference?: boolean;
};

export function ReviewPhotoGallery({ name, photos, selectedId, onSelect, onPhotoLoaded, onPhotoFailed, onDownload, disabled, reference }: GalleryProps) {
  const [localId, setLocalId] = useState('');
  const [failed, setFailed] = useState<ReadonlySet<string>>(() => new Set());
  const requestedId = selectedId ?? localId;
  const index = Math.max(0, photos.findIndex((photo) => photo.photoId === requestedId));
  const current = photos[index];
  const currentKey = current ? `${current.photoId}:${current.url}` : '';
  const currentKeyRef = useRef(currentKey);
  currentKeyRef.current = currentKey;
  const touchStart = useRef<number | null>(null);
  const canShow = current?.available && current.url && !failed.has(currentKey);
  const select = (nextIndex: number) => {
    if (disabled || !photos[nextIndex]) return;
    setLocalId(photos[nextIndex].photoId);
    onSelect?.(photos[nextIndex].photoId);
  };
  return (
    <div className={`review-photo-gallery${reference ? ' review-photo-gallery--reference' : ''}`}>
      <div className="review-photo-frame" onTouchStart={(event) => { touchStart.current = event.touches[0]?.clientX ?? null; }}
        onTouchEnd={(event) => {
          if (touchStart.current === null) return;
          const delta = (event.changedTouches[0]?.clientX ?? touchStart.current) - touchStart.current;
          if (Math.abs(delta) > 40) select(index + (delta < 0 ? 1 : -1));
          touchStart.current = null;
        }}>
        {canShow ? <img key={currentKey} src={current.url!} alt={reference ? `${name} 검수 실사` : `${name} 실사 사진 ${index + 1}`}
          onLoad={() => { if (currentKeyRef.current === currentKey) onPhotoLoaded?.(current.url!); }}
          onError={() => { setFailed((value) => new Set(value).add(currentKey)); onPhotoFailed?.(current.url!); }} />
          : <div className="review-photo-placeholder" role="img" aria-label={`${name} 실사 사진 없음`}>
            <span aria-hidden="true">사진</span><strong>{current ? '사진을 불러올 수 없어요' : '저장된 사진이 없어요'}</strong>
            <small>{current ? '다른 사진을 선택하거나 다시 불러와 주세요.' : '사진이 확인되어야 승인할 수 있습니다.'}</small>
          </div>}
      </div>
      {photos.length > 1 && <div className="review-photo-navigation">
        <button type="button" aria-label="이전 사진" disabled={disabled || index === 0} onClick={() => select(index - 1)}>‹</button>
        <span aria-live="polite">{index + 1} / {photos.length}</span>
        <button type="button" aria-label="다음 사진" disabled={disabled || index === photos.length - 1} onClick={() => select(index + 1)}>›</button>
      </div>}
      {current?.caption && <p className="review-photo-caption">{current.caption}</p>}
      {photos.length > 1 && <div className="review-photo-thumbnails" aria-label={`${name} 사진 목록`}>
        {photos.map((photo, photoIndex) => <button className={index === photoIndex ? 'is-selected' : ''} key={photo.photoId} type="button"
          aria-label={`${name} 사진 ${photoIndex + 1} 보기`} aria-pressed={index === photoIndex} disabled={disabled} onClick={() => select(photoIndex)}>
          {photo.available && photo.url && !failed.has(`${photo.photoId}:${photo.url}`)
            ? <img src={photo.url} alt="" loading="lazy" onError={() => { setFailed((value) => new Set(value).add(`${photo.photoId}:${photo.url}`)); onPhotoFailed?.(photo.url!); }} />
            : <span aria-hidden="true">!</span>}
        </button>)}
      </div>}
      {canShow && onDownload && <button className="review-button review-button--secondary review-photo-download" type="button" disabled={disabled} onClick={() => onDownload(current.url!)}>검수용 사진 저장</button>}
    </div>
  );
}

/** Only opened editors fetch the complete collection; catalog cards never sign all photos. */
export function ReviewPhotoReference({ api, petId, name, fallbackUrls = [] }: { api: ReviewApi; petId: string; name: string; fallbackUrls?: string[] }) {
  const [photos, setPhotos] = useState(() => legacyReviewPhotos(fallbackUrls));
  const [loadError, setLoadError] = useState(false);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    if (!api.getPhotos) return;
    const controller = new AbortController();
    setLoadError(false);
    void api.getPhotos(petId, controller.signal).then((set) => { if (!controller.signal.aborted) setPhotos(activeReviewPhotos(set.photos)); })
      .catch(() => { if (!controller.signal.aborted) setLoadError(true); });
    return () => controller.abort();
  }, [api, petId, attempt]);
  return <div className="review-design-photo">
    <ReviewPhotoGallery name={name} photos={photos} reference />
    {loadError && <button className="review-photo-reload" type="button" onClick={() => setAttempt((value) => value + 1)}>원본 사진 다시 불러오기</button>}
  </div>;
}

function editablePhotos(photos: ReviewPhoto[]) {
  return activeReviewPhotos(photos).map(({ photoId, caption }) => ({ photoId, caption: caption ?? '' }));
}

export function ReviewPhotoManager({ api, petId, name, status, fallbackUrls = [], onClose, onSaved, onDownload }: {
  api: ReviewApi; petId: string; name: string; status: 'pending' | 'approved' | 'paused'; fallbackUrls?: string[];
  onClose: () => void; onSaved: (set: ReviewPhotoSet) => void; onDownload: (url: string) => void;
}) {
  const [snapshot, setSnapshot] = useState<ReviewPhotoSet | null>(null);
  const [kept, setKept] = useState<Array<{ photoId: string; caption: string }>>([]);
  const [selectedId, setSelectedId] = useState('');
  const [excludedCaptions, setExcludedCaptions] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [attempt, setAttempt] = useState(0);
  const dialogRef = useRef<HTMLDivElement>(null);
  useEffect(() => { dialogRef.current?.focus(); }, []);
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true); setError('');
    if (!api.getPhotos) { setLoading(false); setError('사진 관리 연결 전이에요. 기존 사진만 볼 수 있어요.'); return () => controller.abort(); }
    void api.getPhotos(petId, controller.signal).then((result) => {
      if (controller.signal.aborted) return;
      setSnapshot(result); setKept(editablePhotos(result.photos)); setExcludedCaptions({});
      setSelectedId(activeReviewPhotos(result.photos)[0]?.photoId ?? '');
    }).catch((cause) => { if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : '사진을 불러오지 못했어요.'); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [api, petId, attempt]);
  const dirty = snapshot !== null && JSON.stringify(kept) !== JSON.stringify(editablePhotos(snapshot.photos));
  const selectedIndex = Math.max(0, kept.findIndex((photo) => photo.photoId === selectedId));
  const selected = kept[selectedIndex];
  const photoMap = new Map(snapshot?.photos.map((photo) => [photo.photoId, photo]));
  const shown = snapshot ? kept.map((photo, index) => ({ ...photoMap.get(photo.photoId)!, caption: photo.caption, sortOrder: index })) : legacyReviewPhotos(fallbackUrls);
  const excluded = snapshot?.photos.filter((photo) => !kept.some((value) => value.photoId === photo.photoId)) ?? [];
  const captionError = kept.map((photo) => reviewPhotoCaptionError(photo.caption)).find(Boolean) ?? '';
  const disabled = saving || loading;
  const canEdit = Boolean(snapshot && api.savePhotos);
  const move = (direction: number) => {
    const target = selectedIndex + direction;
    if (target < 0 || target >= kept.length) return;
    setSelectedId(selected.photoId);
    setKept((current) => { const next = [...current]; [next[target], next[selectedIndex]] = [next[selectedIndex], next[target]]; return next; });
  };
  const save = async () => {
    if (!snapshot || !api.savePhotos || captionError || !kept.length || kept.length > 16 || saving) return;
    setSaving(true); setError('');
    try {
      const result = await api.savePhotos({ petId, expectedRevision: snapshot.revision,
        photos: kept.map(({ photoId, caption }) => ({ photoId, caption: caption.trim() || null })) });
      setSnapshot(result); setKept(editablePhotos(result.photos)); onSaved(result);
    } catch (cause) { setError(cause instanceof Error ? cause.message : '사진 변경을 저장하지 못했어요.'); }
    finally { setSaving(false); }
  };
  return <div className="review-dialog-backdrop">
    <div className="review-dialog review-photo-dialog" role="dialog" aria-modal="true" aria-labelledby="review-photo-title" tabIndex={-1} ref={dialogRef}>
      <h2 id="review-photo-title">{name} · 사진 관리</h2>
      <p>{status === 'pending' ? '사진을 저장해도 승인 대기는 유지돼요.' : '저장하면 앱에 보이는 사진 순서와 문구가 바뀌어요.'} 첫 사진이 대표 사진이에요.</p>
      {loading && <p role="status">사진을 불러오는 중…</p>}
      <ReviewPhotoGallery name={name} photos={shown} selectedId={selected?.photoId} onSelect={setSelectedId} disabled={disabled} onDownload={onDownload} />
      {canEdit && selected && <fieldset className="review-photo-edit" disabled={disabled}>
        <div className="review-photo-edit-actions">
          <button type="button" disabled={selectedIndex === 0} onClick={() => move(-1)}>앞으로</button>
          <button type="button" disabled={selectedIndex === kept.length - 1} onClick={() => move(1)}>뒤로</button>
          <button type="button" disabled={kept.length <= 1} onClick={() => {
            setExcludedCaptions((current) => ({ ...current, [selected.photoId]: selected.caption }));
            setKept((current) => current.filter((photo) => photo.photoId !== selected.photoId));
            setSelectedId(kept[selectedIndex + 1]?.photoId ?? kept[selectedIndex - 1]?.photoId ?? '');
          }}>사진 제외</button>
        </div>
        <label htmlFor="review-photo-caption">사진 문구 <small>{Array.from(selected.caption).length}/30</small></label>
        <input id="review-photo-caption" value={selected.caption} placeholder="예: 산책을 좋아해요" aria-invalid={Boolean(reviewPhotoCaptionError(selected.caption))}
          onChange={(event) => setKept((current) => current.map((photo) => photo.photoId === selected.photoId ? { ...photo, caption: event.target.value } : photo))} />
      </fieldset>}
      {canEdit && excluded.length > 0 && <details className="review-photo-excluded"><summary>제외한 사진 {excluded.length}장</summary>
        <p>원본은 보관되며 다시 포함할 수 있어요.</p>
        <div>{excluded.map((photo) => <button type="button" key={photo.photoId} disabled={disabled || kept.length >= 16} onClick={() => {
          setKept((current) => [...current, { photoId: photo.photoId, caption: excludedCaptions[photo.photoId] ?? photo.caption ?? '' }]); setSelectedId(photo.photoId);
        }} aria-label={`${photo.caption || '제외한 사진'} 다시 포함`}>
          {photo.url && photo.available ? <img src={photo.url} alt="" loading="lazy" /> : <span>사진</span>}<span>다시 포함</span>
        </button>)}</div>
      </details>}
      {captionError && <p className="review-dialog-error" role="alert">{captionError}</p>}
      {error && <div className="review-dialog-error" role="alert"><p>{error}</p><button type="button" disabled={disabled} onClick={() => setAttempt((value) => value + 1)}>{dirty ? '변경 버리고 최신 사진 불러오기' : '다시 불러오기'}</button></div>}
      {snapshot && !api.savePhotos && <p role="note">사진 관리 연결 전이에요. 기존 사진만 볼 수 있어요.</p>}
      {dirty && <p className="review-photo-unsaved" role="status">아직 저장하지 않은 사진 변경이 있어요.</p>}
      {canEdit && <p className="review-photo-save-note">제외한 사진은 앱·앨범에서 숨겨져요. 원본과 수집 기록은 보관돼요.</p>}
      <div className="review-dialog-actions">
        <button className="review-button review-button--secondary" type="button" disabled={saving} onClick={onClose}>{dirty ? '변경 버리고 닫기' : '닫기'}</button>
        {canEdit && <button className="review-button review-button--primary" type="button" disabled={disabled || !dirty || Boolean(captionError) || kept.length < 1 || kept.length > 16} onClick={() => void save()}>{saving ? '저장 중…' : '사진 변경 저장'}</button>}
      </div>
    </div>
  </div>;
}
