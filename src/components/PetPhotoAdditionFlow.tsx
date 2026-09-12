import { useEffect, useRef, useState } from 'react';
import { Button, Top } from '@toss/tds-mobile';
import type { OwnedPetSummary } from '../types';
import { isUnknownPetApiOutcome } from '../lib/api';
import { fetchPhotoAdditionStatus, submitPhotoAddition } from '../lib/petPhotoAdditions';
import { normalizeAndAnalyzePetImage } from '../lib/petImage';
import { isPhotoPickerUnavailableError, pickPhotos, pickPhotosFromBrowser } from '../lib/toss';
import './UploadFlowPhotos.css';
import './PetPhotoAdditionFlow.css';

type AdditionStatus = Awaited<ReturnType<typeof fetchPhotoAdditionStatus>>;
type AdditionInput = Parameters<typeof submitPhotoAddition>[0];
type SubmissionPhase = 'editing' | 'submitting' | 'reconciling' | 'uncertain';
type AdditionPhoto = {
  id: string;
  sourceDataUri: string;
  dataUri?: string;
  status: 'queued' | 'processing' | 'ready' | 'error';
  error?: string;
};

const REVIEW_PROMISE = '새로운 귀여움도 검수 중이에요. 확인이 끝나면 이 친구의 앨범에 살포시 더해져요 🐾';
const UNKNOWN_SUBMISSION_MESSAGE = '사진이 접수됐는지 아직 확인하지 못했어요. 같은 사진으로 접수 상태를 다시 확인해 주세요. 사진이 두 번 추가되지는 않아요.';

type PhotoAdditionFlowProps = {
  pet: OwnedPetSummary;
  onSubmitted: () => void;
  onCancel: () => void;
};

export function PetPhotoAdditionFlow(props: PhotoAdditionFlowProps) {
  return <PetPhotoAdditionDraft key={props.pet.id} {...props} />;
}

function PetPhotoAdditionDraft({ pet, onSubmitted, onCancel }: PhotoAdditionFlowProps) {
  const [status, setStatus] = useState<AdditionStatus>();
  const [loading, setLoading] = useState(true);
  const [statusError, setStatusError] = useState('');
  const [photos, setPhotos] = useState<AdditionPhoto[]>([]);
  const photosRef = useRef<AdditionPhoto[]>([]);
  const [activePhotoId, setActivePhotoId] = useState<string>();
  const [picking, setPicking] = useState(false);
  const pickingRef = useRef(false);
  const processingRef = useRef(false);
  const mountedRef = useRef(true);
  const recoveryRef = useRef(false);
  const statusLoadRef = useRef(0);
  const [browserPicker, setBrowserPicker] = useState(false);
  const [consented, setConsented] = useState(false);
  const [phase, setPhase] = useState<SubmissionPhase>('editing');
  const [error, setError] = useState('');
  const submissionId = useRef(crypto.randomUUID());
  const frozenSubmission = useRef<AdditionInput>();
  const locked = phase !== 'editing';
  const busy = phase === 'submitting' || phase === 'reconciling';
  const processing = photos.some((photo) => photo.status === 'queued' || photo.status === 'processing');
  const ready = photos.length > 0 && photos.every((photo) => photo.status === 'ready' && photo.dataUri);
  const eligiblePet = pet.approvalStatus === 'approved' || pet.approvalStatus === 'pending';
  const remaining = status ? Math.max(0, Math.min(5, status.remainingCount, 5 - status.activePhotoCount - status.pendingPhotoCount)) : 0;
  const canSubmit = Boolean(eligiblePet && status?.canSubmit && !status.pendingPhotoCount && status.submission?.status !== 'pending' && remaining > 0 && !loading && !statusError);
  const draftDirty = Boolean(photos.length || consented || locked);
  const previewPhoto = photos.find((photo) => photo.id === activePhotoId) ?? photos[0];
  const previewIndex = photos.findIndex((photo) => photo.id === previewPhoto?.id);

  useEffect(() => {
    mountedRef.current = true;
    void loadStatus();
    return () => {
      mountedRef.current = false;
      statusLoadRef.current += 1;
    };
  }, [pet.id]);

  useEffect(() => {
    document.documentElement.dataset.uploadDraftDirty = String(draftDirty);
    // An uncertain request retains its frozen payload until its result is resolved.
    window.dispatchEvent(new CustomEvent('cute-enough:upload-dirty-change', { detail: { dirty: draftDirty, busy: locked } }));
    const preventExit = (event: BeforeUnloadEvent) => {
      if (!draftDirty) return;
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', preventExit);
    return () => {
      window.removeEventListener('beforeunload', preventExit);
      delete document.documentElement.dataset.uploadDraftDirty;
      window.dispatchEvent(new CustomEvent('cute-enough:upload-dirty-change', { detail: { dirty: false, busy: false } }));
    };
  }, [draftDirty, locked]);

  async function loadStatus() {
    const request = ++statusLoadRef.current;
    setLoading(true);
    setStatusError('');
    try {
      const nextStatus = await fetchPhotoAdditionStatus(pet.id);
      if (mountedRef.current && request === statusLoadRef.current) setStatus(nextStatus);
    } catch (caught) {
      if (mountedRef.current && request === statusLoadRef.current) {
        setStatus(undefined);
        setStatusError(caught instanceof Error ? caught.message : '사진을 더 올릴 수 있는지 확인하지 못했어요.');
      }
    } finally {
      if (mountedRef.current && request === statusLoadRef.current) setLoading(false);
    }
  }

  function updatePhotos(next: AdditionPhoto[]) {
    photosRef.current = next;
    setPhotos(next);
    setActivePhotoId((current) => next.some((photo) => photo.id === current) ? current : next[0]?.id);
  }

  async function processPhotos(ids: string[]) {
    if (processingRef.current) return;
    processingRef.current = true;
    try {
      // Normalize sequentially to bound full-resolution memory and remove source metadata.
      for (const id of ids) {
        if (!mountedRef.current) return;
        const source = photosRef.current.find((photo) => photo.id === id);
        if (!source) continue;
        updatePhotos(photosRef.current.map((photo) => photo.id === id ? { ...photo, status: 'processing', error: undefined } : photo));
        try {
          const normalized = await normalizeAndAnalyzePetImage(source.sourceDataUri);
          if (!mountedRef.current) return;
          // Photo additions never replace the pet's traits, design, name, or accessories.
          updatePhotos(photosRef.current.map((photo) => photo.id === id
            ? { ...photo, sourceDataUri: normalized.dataUri, dataUri: normalized.dataUri, status: 'ready' }
            : photo));
        } catch (caught) {
          if (!mountedRef.current) return;
          updatePhotos(photosRef.current.map((photo) => photo.id === id
            ? { ...photo, status: 'error', error: caught instanceof Error ? caught.message : '사진을 준비하지 못했어요.' }
            : photo));
        }
      }
    } finally {
      processingRef.current = false;
    }
  }

  async function choosePhotos() {
    if (!canSubmit || pickingRef.current || processingRef.current || locked || frozenSubmission.current) return;
    const available = remaining - photosRef.current.length;
    if (available <= 0) return;
    pickingRef.current = true;
    setPicking(true);
    setError('');
    try {
      const selected = await (browserPicker ? pickPhotosFromBrowser(available) : pickPhotos(available));
      if (!mountedRef.current || frozenSubmission.current || !selected.length) return;
      if (selected.length > remaining - photosRef.current.length) {
        setError(`지금은 사진을 ${remaining - photosRef.current.length}장까지 더 고를 수 있어요. 남은 자리만큼 다시 골라주세요.`);
        return;
      }
      const additions: AdditionPhoto[] = selected.map((source) => ({
        id: crypto.randomUUID(),
        sourceDataUri: source.startsWith('data:') ? source : `data:image/jpeg;base64,${source}`,
        status: 'queued',
      }));
      updatePhotos([...photosRef.current, ...additions]);
      setConsented(false);
      await processPhotos(additions.map((photo) => photo.id));
    } catch (caught) {
      if (!mountedRef.current) return;
      if (isPhotoPickerUnavailableError(caught)) setBrowserPicker(true);
      setError(caught instanceof Error ? caught.message : '사진을 불러오지 못했어요.');
    } finally {
      pickingRef.current = false;
      if (mountedRef.current) setPicking(false);
    }
  }

  function removePhoto(id: string) {
    if (locked || frozenSubmission.current) return;
    updatePhotos(photosRef.current.filter((photo) => photo.id !== id));
    setConsented(false);
    setError('');
  }

  async function retryPhoto(id: string) {
    if (locked || frozenSubmission.current || pickingRef.current || processingRef.current) return;
    if (photosRef.current.find((photo) => photo.id === id)?.status === 'error') await processPhotos([id]);
  }

  function hasExactSubmission(result: AdditionStatus, input: AdditionInput) {
    return result.found !== false && result.petId === input.petId
      && result.submission?.petId === input.petId && result.submission.submissionId === input.submissionId;
  }

  function markUncertain() {
    if (!mountedRef.current) return;
    setPhase('uncertain');
    setError(UNKNOWN_SUBMISSION_MESSAGE);
  }

  async function reconcile(input: AdditionInput) {
    setPhase('reconciling');
    try {
      const result = await fetchPhotoAdditionStatus(input.petId, input.submissionId);
      if (!mountedRef.current) return;
      if (hasExactSubmission(result, input)) {
        onSubmitted();
        return;
      }
    } catch { /* Keep the same submission frozen while its outcome is unknown. */ }
    markUncertain();
  }

  async function attemptSubmission(input: AdditionInput, unlockOnDefiniteError: boolean) {
    setPhase('submitting');
    setError('');
    try {
      await submitPhotoAddition(input);
      if (mountedRef.current) onSubmitted();
    } catch (caught) {
      if (!mountedRef.current) return;
      if (isUnknownPetApiOutcome(caught)) {
        await reconcile(input);
      } else if (!unlockOnDefiniteError) {
        markUncertain();
      } else {
        frozenSubmission.current = undefined;
        setPhase('editing');
        setError(caught instanceof Error ? caught.message : '사진을 검수에 보내지 못했어요.');
        await loadStatus();
      }
    }
  }

  async function submit() {
    if (!canSubmit || !ready || !consented || locked || frozenSubmission.current || pickingRef.current || processingRef.current) return;
    if (photosRef.current.length > remaining) {
      setError(`사진은 ${remaining}장까지 더 올릴 수 있어요. 고른 사진 수를 확인해 주세요.`);
      return;
    }
    const input: AdditionInput = { petId: pet.id, submissionId: submissionId.current, dataUris: photosRef.current.map((photo) => photo.dataUri!) };
    frozenSubmission.current = input;
    await attemptSubmission(input, true);
  }

  async function recoverSubmission() {
    const input = frozenSubmission.current;
    if (!input || phase !== 'uncertain' || recoveryRef.current) return;
    recoveryRef.current = true;
    setPhase('reconciling');
    setError('');
    try {
      const result = await fetchPhotoAdditionStatus(input.petId, input.submissionId);
      if (!mountedRef.current) return;
      if (hasExactSubmission(result, input)) {
        onSubmitted();
      } else if (result.found === false) {
        await attemptSubmission(input, false);
      } else {
        markUncertain();
      }
    } catch {
      markUncertain();
    } finally {
      recoveryRef.current = false;
    }
  }

  const pending = Boolean(status?.pendingPhotoCount || status?.submission?.status === 'pending');
  return (
    <main className="upload-screen photo-addition-screen">
      <Top className="upload-top" upperGap={16} lowerGap={10}
        title={<Top.TitleParagraph size={28}>{pet.name ?? '우리 강아지'}의<br />사진을 더 모아요</Top.TitleParagraph>}
        subtitleBottom={<Top.SubtitleParagraph>이름과 꾸민 모습은 그대로, 같은 친구의 사진만 더해요.</Top.SubtitleParagraph>}
      />
      <section className="upload-card">
        <p className="photo-addition-boundary">기존에 공개된 사진은 그대로 보여요. 새 사진은 검수 승인 후 이 친구의 앨범에 추가돼요.</p>
        {loading ? <p role="status" className="photo-addition-message">사진을 더 올릴 수 있는지 확인하고 있어요…</p>
          : statusError ? <div className="photo-addition-message"><p role="alert">{statusError}</p><Button size="medium" variant="weak" onClick={() => void loadStatus()}>다시 확인하기</Button></div>
            : status && <>
              <section className="photo-addition-capacity" aria-label="강아지 사진 수">
                <strong>기존 사진 {status.activePhotoCount}장 · 검수 중 {status.pendingPhotoCount}장</strong>
                <span>최대 5장 중 {remaining}장 더 올릴 수 있어요</span>
              </section>
              {pending && <div className="photo-addition-feedback" role="status"><strong>새 사진을 확인하고 있어요</strong><p>{REVIEW_PROMISE}</p><small>확인이 끝나면 남은 자리에 다시 올릴 수 있어요.</small></div>}
              {status.submission?.status === 'rejected' && <div className="photo-addition-feedback is-rejected"><strong>지난 사진을 추가하지 못했어요</strong><p>{status.submission.reviewNote || '같은 강아지가 잘 보이는 다른 사진으로 다시 보내주세요.'}</p></div>}
              {!canSubmit && !pending && <p className="photo-addition-message">{status.unavailableReason || (remaining === 0 ? '사진이 5장 이상 모였어요. 기존 사진은 그대로 보관돼요.' : '지금은 이 강아지의 사진을 더 올릴 수 없어요.')}</p>}
              {canSubmit && <>
                {photos.length > 0 ? <section className="upload-photo-gallery" aria-label="새로 고른 강아지 사진">
                  <div className="photo-picker has-photo upload-cover-photo">
                    {previewPhoto?.dataUri ? <img src={previewPhoto.dataUri} alt={`${previewIndex + 1}번 추가 사진 미리보기`} />
                      : <div className="upload-photo-placeholder"><span aria-hidden="true">🐾</span><strong>{previewPhoto?.status === 'error' ? '사진을 다시 준비해 주세요' : '사진을 준비하고 있어요'}</strong></div>}
                    <span className="photo-change-badge">새 사진 {previewIndex + 1}</span>
                  </div>
                  <div className="upload-photo-count"><strong>고른 사진 {photos.length}/{remaining}</strong><span>이 친구의 앨범에 추가할 사진이에요</span></div>
                  <ol className="upload-photo-list" aria-label="추가할 사진 목록">
                    {photos.map((photo, index) => <li key={photo.id} className={`upload-photo-item is-${photo.status}`}>
                      <button type="button" className="upload-photo-thumb" aria-label={`${index + 1}번 사진 크게 보기`} aria-pressed={photo.id === previewPhoto?.id} onClick={() => setActivePhotoId(photo.id)}>
                        {photo.dataUri ? <img src={photo.dataUri} alt={`${index + 1}번 추가 사진`} /> : <span className="upload-photo-thumb-placeholder" aria-hidden="true">🐾</span>}
                        <span className="upload-photo-order">{index + 1}</span>
                      </button>
                      <small className="upload-photo-status">{photo.status === 'ready' ? '준비 완료' : photo.status === 'error' ? '다시 확인' : photo.status === 'processing' ? '준비 중…' : '대기 중'}</small>
                      <button type="button" className="upload-photo-remove" aria-label={`${index + 1}번 사진 삭제`} disabled={locked} onClick={() => removePhoto(photo.id)}>삭제</button>
                      {photo.status === 'error' && <button type="button" className="upload-photo-retry" aria-label={`${index + 1}번 사진 다시 시도하기`} disabled={locked || picking || processing} onClick={() => void retryPhoto(photo.id)}>재시도</button>}
                    </li>)}
                  </ol>
                  <button type="button" className="upload-photo-add" disabled={photos.length >= remaining || locked || picking || processing} onClick={() => void choosePhotos()}>{browserPicker ? '기기에서 사진 추가하기' : '사진 추가하기'}</button>
                  {photos.map((photo, index) => photo.status === 'error' && <p key={photo.id} role="alert" className="error-message upload-photo-error">{index + 1}번 사진: {photo.error} 재시도하거나 삭제해 주세요.</p>)}
                </section> : <button type="button" className="photo-picker" disabled={locked || picking || processing} onClick={() => void choosePhotos()}>
                  <span className="photo-addition-camera" aria-hidden="true">📷</span><strong>{browserPicker ? '기기에서 사진 고르기' : '강아지 사진 고르기'}</strong><small>JPG, PNG, WEBP · 1~{remaining}장</small>
                </button>}
                {processing && <div className="upload-analysis-progress" role="status" aria-live="polite" aria-busy="true"><span className="upload-analysis-progress-dot" aria-hidden="true" /><div><strong>사진을 준비하고 있어요</strong><small>한 장씩 크기를 줄이고, 위치 등 촬영 정보를 지워요.</small></div></div>}
                <p className="upload-review-promise">새 사진을 검수에 보내면 귀여움을 꼼꼼히 확인해요. 승인되면 이 친구의 앨범에 살포시 더해져요 🐾</p>
                {photos.length > 0 && <>
                  <label className="consent"><input type="checkbox" checked={consented} disabled={locked || picking || processing} onChange={(event) => setConsented(event.target.checked)} /><span>이번에 고른 모든 사진을 올릴 권리가 있으며, 승인 후 공개와 강아지 이름표가 포함된 사진 저장에 동의해요.</span></label>
                  <Button className="upload-cta" display="full" size="large" loading={busy} disabled={phase === 'uncertain' ? false : !ready || !consented || locked || picking || processing || photos.length > remaining} onClick={phase === 'uncertain' ? () => void recoverSubmission() : () => void submit()}>{phase === 'uncertain' ? '사진 접수 상태 확인하기' : `사진 ${photos.length}장 검수 보내기`}</Button>
                </>}
              </>}
            </>}
        {error && <p className="error-message" role="alert">{error}</p>}
        <Button className="photo-addition-cancel" display="full" size="medium" color="dark" variant="weak" disabled={locked} onClick={onCancel}>내 강아지로 돌아가기</Button>
      </section>
    </main>
  );
}
