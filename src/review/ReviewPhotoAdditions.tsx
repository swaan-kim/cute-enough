import { useEffect, useRef, useState } from 'react';
import type { ReviewApi, ReviewPhotoAddition } from './types';

function AdditionCard({ batch, api, onSaved }: { batch: ReviewPhotoAddition; api: ReviewApi; onSaved: () => void }) {
  const [checked, setChecked] = useState<Set<string>>(() => new Set());
  const [loaded, setLoaded] = useState<Set<string>>(() => new Set());
  const [note, setNote] = useState('');
  const [decision, setDecision] = useState<'approved' | 'rejected' | null>(null);
  const [busy, setBusy] = useState(false);
  const inFlight = useRef(false);
  const [error, setError] = useState('');
  const name = batch.name || '이름 없는 강아지';
  const canApprove = ['pending', 'approved'].includes(batch.petStatus)
    && batch.photos.every((photo) => photo.url && loaded.has(photo.photoId) && checked.has(photo.photoId));
  async function save() {
    if (!decision || !api.reviewPhotoAddition || inFlight.current || (decision === 'approved' ? !canApprove : !note.trim())) return;
    inFlight.current = true; setBusy(true); setError('');
    try {
      await api.reviewPhotoAddition({ batchId: batch.batchId, expectedRevision: batch.expectedRevision, decision, note });
      onSaved();
    } catch (cause) {
      setError(`${cause instanceof Error ? cause.message : '저장하지 못했어요.'} 목록을 다시 불러와 확인해 주세요.`);
      setDecision(null);
    } finally { inFlight.current = false; setBusy(false); }
  }
  return <article className="review-addition-card" aria-label={`${name} 추가 사진 검수`}>
    <h3>{name} · 추가 사진 {batch.photos.length}장</h3>
    <p>사진을 모두 확인한 뒤 이번 접수 묶음을 승인하거나 반려해 주세요. 기존 외형과 사진은 그대로 유지돼요.</p>
    {batch.petStatus === 'pending' && <p>강아지 자체는 검수 중이에요. 사진을 승인해도 강아지가 자동 공개되지는 않아요.</p>}
    <div className="review-addition-photos">{batch.photos.map((photo, index) => <label key={photo.photoId}>
      {photo.url ? <a href={photo.url} target="_blank" rel="noreferrer"><img src={photo.url} alt={`${name} 추가 사진 ${index + 1}`}
        onLoad={() => setLoaded((old) => new Set(old).add(photo.photoId))}
        onError={() => { setLoaded((old) => { const next = new Set(old); next.delete(photo.photoId); return next; }); }} /></a>
        : <span>사진을 불러오지 못했어요. 목록을 다시 불러와 주세요.</span>}
      <span><input type="checkbox" aria-label={`사진 ${index + 1} 확인`} checked={checked.has(photo.photoId)} disabled={busy || !loaded.has(photo.photoId)}
        onChange={(event) => setChecked((old) => { const next = new Set(old); if (event.target.checked) next.add(photo.photoId); else next.delete(photo.photoId); return next; })} />사진 {index + 1} 확인</span>
    </label>)}</div>
    <label>검수 메모 · 반려할 때는 이유 필수<input aria-label={`${name} 검수 메모`} value={note} maxLength={500} disabled={busy}
      onChange={(event) => setNote(event.target.value)} /></label>
    {error && <p role="alert">{error}</p>}
    {decision ? <div role="group" aria-label="추가 사진 확정">
      <p>{decision === 'approved' ? `추가 사진 ${batch.photos.length}장을 승인할까요? 승인된 강아지라면 주인과 다른 사용자에게 공개됩니다.` : '이번 추가 사진 전체를 반려할까요? 기존 공개 사진은 유지됩니다.'}</p>
      <button className="review-button" type="button" disabled={busy || (decision === 'approved' ? !canApprove : !note.trim())} onClick={() => void save()}>{busy ? '저장 중' : '확정하기'}</button>
      <button type="button" disabled={busy} onClick={() => setDecision(null)}>취소</button>
    </div> : <div>
      <button className="review-button" type="button" disabled={!canApprove || busy} onClick={() => setDecision('approved')}>추가 사진 승인</button>
      <button type="button" disabled={!note.trim() || busy} onClick={() => setDecision('rejected')}>추가 사진 반려</button>
    </div>}
  </article>;
}

export function ReviewPhotoAdditions({ api }: { api: ReviewApi }) {
  const [items, setItems] = useState<ReviewPhotoAddition[]>([]);
  const [attempt, setAttempt] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  useEffect(() => {
    if (!api.getPhotoAdditions) return;
    const controller = new AbortController();
    setLoading(true); setError('');
    void api.getPhotoAdditions(controller.signal).then((result) => { if (!controller.signal.aborted) setItems(result); })
      .catch(() => { if (!controller.signal.aborted) setError('추가 사진 목록을 불러오지 못했어요. 검수 서버 연결을 확인해 주세요.'); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [api, attempt]);
  if (!api.getPhotoAdditions || !api.reviewPhotoAddition) return null;
  return <section className="review-additions" aria-label="추가 사진 승인 대기">
    <h2>추가 사진 검수</h2>
    <button type="button" disabled={loading} onClick={() => setAttempt((n) => n + 1)}>추가 사진 다시 불러오기</button>
    {notice && <p role="status">{notice}</p>}
    {loading ? <p role="status">추가 사진을 불러오는 중이에요</p> : error ? <p role="alert">{error}</p>
      : items.length === 0 ? <p>검수를 기다리는 추가 사진이 없어요.</p>
        : items.map((batch) => <AdditionCard key={`${attempt}:${batch.batchId}`} batch={batch} api={api}
          onSaved={() => { setNotice('추가 사진 검수 결과를 저장했어요.'); setAttempt((n) => n + 1); }} />)}
  </section>;
}
