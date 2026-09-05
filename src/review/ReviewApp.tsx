import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { PetArtwork } from '../components/PetArtwork';
import {
  PET_ACCESSORY_COLORS,
  PET_ACCESSORY_COLOR_HEX,
  PET_ACCESSORY_COLOR_LABELS,
  PET_ACCESSORY_KINDS,
  PET_ACCESSORY_KIND_LABELS,
  createPetAccessory,
  petAccessoryLabel,
} from '../lib/petAccessory';
import { getPetExpression } from '../lib/petExpression';
import { applyCoatMode, getSoftPointColor } from '../lib/petStyle';
import type { BrowStyle, CoatColor, EarShape, FurStyle, HeadShape, MarkingPattern, PetAccessory, PetStyleV1, PetTraitsV1, TongueShape } from '../types';
import { reviewApi as defaultReviewApi } from './api';
import { getCuratedReviewDraft } from './curatedDrafts';
import type { PublicationAction, ReviewApi, ReviewCatalogItem, ReviewDecision, ReviewQueueItem } from './types';

type LoadPhase = 'loading' | 'ready' | 'error';

type PendingReview = {
  item: ReviewQueueItem;
  decision: ReviewDecision;
};

type ReviewDialogResult = {
  reason: string;
  finalName: string;
  finalTraits: PetTraitsV1;
  finalStyle: PetStyleV1;
  publishedAccessory: PetAccessory | null;
  reviewNote: string;
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

async function decodeReviewPhoto(blob: Blob): Promise<CanvasImageSource & { width: number; height: number }> {
  if (typeof createImageBitmap === 'function') return createImageBitmap(blob);
  return new Promise((resolve, reject) => {
    const image = new Image();
    const objectUrl = URL.createObjectURL(blob);
    image.onload = () => { URL.revokeObjectURL(objectUrl); resolve(image); };
    image.onerror = () => { URL.revokeObjectURL(objectUrl); reject(new Error('PHOTO_DECODE_FAILED')); };
    image.src = objectUrl;
  });
}

export async function saveReviewPhoto(url: string, name: string) {
  const response = await fetch(url, { credentials: 'same-origin' });
  if (!response.ok) throw new Error('PHOTO_DOWNLOAD_FAILED');
  const source = await decodeReviewPhoto(await response.blob());
  const scale = Math.min(1, 768 / Math.max(source.width, source.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(source.width * scale));
  canvas.height = Math.max(1, Math.round(source.height * scale));
  const context = canvas.getContext('2d');
  if (!context) throw new Error('CANVAS_UNAVAILABLE');
  context.drawImage(source, 0, 0, canvas.width, canvas.height);
  const cleanBlob = await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((nextBlob) => nextBlob ? resolve(nextBlob) : reject(new Error('PHOTO_EXPORT_FAILED')), 'image/jpeg', 0.88);
  });
  const downloadUrl = URL.createObjectURL(cleanBlob);
  const link = document.createElement('a');
  link.href = downloadUrl;
  link.download = `${name.replace(/[^\p{L}\p{N}-]+/gu, '-') || 'pet'}-review.jpg`;
  link.click();
  window.setTimeout(() => URL.revokeObjectURL(downloadUrl), 1_000);
}

export function buildReviewCopy(item: ReviewQueueItem) {
  const requested = item.requestedAccessory
    ? `사용자 선택 소품: ${petAccessoryLabel(item.requestedAccessory)}`
    : '사용자 선택 소품: 검수자에게 맡김';
  const similar = item.similarPets.length
    ? item.similarPets.map((pet) => pet.name || pet.id).join(', ')
    : '없음';
  return [
    `[오늘의 강아지 수동 검수] ${getPetDisplayName(item)}`,
    requested,
    `기본 털색: ${item.submittedTraits.baseColor} / 포인트색: ${item.submittedTraits.secondaryColor}`,
    `털색 방식: ${item.submittedStyle.coatMode} / 털 윤곽: ${item.submittedStyle.furStyle}`,
    `귀: ${item.submittedTraits.earShape} / 얼굴 무늬: ${item.submittedTraits.markingPattern}`,
    `꾸밈 설정이 모두 같은 기존 강아지: ${similar}`,
    '',
    '사진 속 강아지의 털색과 캐릭터 설정이 자연스러운지 확인해 주세요.',
    '작은 64px 화면에서도 구분되는지, 소품 대비가 충분한지만 추천해 주세요.',
    '실사에 맞는 보정 방향만 추천하고 SVG/HTML 코드는 만들지 마세요.',
  ].join('\n');
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

function PhotoPanel({ item, onPhotoLoaded, onNotice }: { item: ReviewQueueItem; onPhotoLoaded: () => void; onNotice: (message: string) => void }) {
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
      {hasPhoto && !selectedFailed && (
        <button
          className="review-button review-button--secondary review-photo-download"
          type="button"
          onClick={() => void saveReviewPhoto(selectedUrl, displayName)
            .then(() => onNotice('768px 이하 검수용 사진을 저장했어요.'))
            .catch(() => onNotice('검수용 사진을 저장하지 못했어요.'))}
        >
          검수용 사진 저장
        </button>
      )}
    </div>
  );
}

function ReviewCard({
  item,
  disabled,
  onOpenReview,
  onNotice,
}: {
  item: ReviewQueueItem;
  disabled: boolean;
  onOpenReview: (item: ReviewQueueItem, decision: ReviewDecision) => void;
  onNotice: (message: string) => void;
}) {
  const displayName = getPetDisplayName(item);
  const [photoSeen, setPhotoSeen] = useState(false);
  const curatedDraft = useMemo(() => getCuratedReviewDraft(item), [item]);
  const pet = useMemo(() => ({
    id: item.petId,
    name: displayName,
    traits: item.submittedTraits,
    publishedStyle: item.submittedStyle,
    publishedAccessory: item.publishedAccessory ?? undefined,
    designVersion: item.designVersion,
  }), [displayName, item.designVersion, item.petId, item.publishedAccessory, item.submittedStyle, item.submittedTraits]);
  const suggestedPet = useMemo(() => curatedDraft ? ({
    id: item.petId,
    name: curatedDraft.displayName,
    traits: curatedDraft.traits,
    publishedStyle: curatedDraft.style,
    designVersion: item.designVersion,
  }) : undefined, [curatedDraft, item.designVersion, item.petId]);

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
        <PhotoPanel item={item} onPhotoLoaded={() => setPhotoSeen(true)} onNotice={onNotice} />
        <div className="review-character-panel">
          <div className="review-section-heading">
            <span>{curatedDraft ? '캐릭터 비교' : '생성 캐릭터'}</span>
            <span className="review-character-status">{curatedDraft ? '검수 제안 있음' : '미리보기'}</span>
          </div>
          {curatedDraft && suggestedPet ? (
            <div className="review-character-frame review-curated-compare">
              <figure><PetArtwork pet={pet} size={114} /><figcaption>사용자 초안</figcaption></figure>
              <span className="review-curated-arrow" aria-hidden="true">→</span>
              <figure><PetArtwork pet={suggestedPet} size={114} /><figcaption>검수 제안</figcaption></figure>
              <p><strong>{curatedDraft.displayName}</strong><span>{curatedDraft.summary}</span></p>
            </div>
          ) : (
            <div className="review-character-frame review-character-sizes">
              {[64, 114, 190].map((size) => (
                <figure key={size}>
                  <PetArtwork pet={pet} size={size} />
                  <figcaption>{size}px</figcaption>
                </figure>
              ))}
            </div>
          )}
        </div>
      </div>

      <section className="review-manual-tools" aria-label="수동 ChatGPT 검수 도구">
        <div>
          <strong>수동 ChatGPT 검수</strong>
          <small>사진을 저장한 뒤 강아지 중심으로 자르고, 사람 얼굴·주소·불필요한 배경은 제외해 이 대화에 올리세요. AI 답변은 서버에 저장하지 않습니다.</small>
        </div>
        <button
          className="review-button review-button--secondary"
          type="button"
          onClick={() => void navigator.clipboard.writeText(buildReviewCopy(item))
            .then(() => onNotice('검수 정보를 복사했어요.'))
            .catch(() => onNotice('검수 정보를 복사하지 못했어요.'))}
        >
          검수 정보 복사
        </button>
      </section>

      <section className="review-similar" aria-label="꾸밈 설정이 같은 강아지">
        <div className="review-section-heading"><span>꾸밈 설정이 같은 강아지</span><span className="review-character-status">완전 일치만</span></div>
        {item.similarPets.length ? (
          <div className="review-similar-list">
            {item.similarPets.map((similar) => (
              <figure key={`${similar.id}-${similar.designVersion ?? 1}`}>
                <PetArtwork pet={similar} size={64} />
                <figcaption>{similar.name || '이름 없음'}</figcaption>
              </figure>
            ))}
          </div>
        ) : <p className="review-similar-empty">모든 꾸밈 설정이 같은 강아지는 없어요.</p>}
      </section>

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

const REVIEW_OPTIONS = {
  earShape: [['floppy', '포근한 귀'], ['upright', '쫑긋 귀'], ['semi', '살짝 접힌 귀'], ['rounded', '작고 동그란 귀']] as Array<[EarShape, string]>,
  headShape: [['round', '둥근 머리'], ['oval', '타원형 머리'], ['long', '긴 머리']] as Array<[HeadShape, string]>,
  muzzle: [['short', '짧은 주둥이'], ['medium', '보통 주둥이'], ['long', '긴 주둥이']] as Array<[PetTraitsV1['muzzle'], string]>,
  furStyle: [['neat', '단정한 털'], ['fluffy', '복슬한 털'], ['cloud', '몽글한 털']] as Array<[FurStyle, string]>,
  coatColor: [['white', '흰색'], ['cream', '크림'], ['caramel', '캐러멜'], ['chocolate', '초콜릿'], ['gray', '회색'], ['black', '검정']] as Array<[CoatColor, string]>,
  marking: [['none', '없음'], ['brow', '눈썹'], ['mask', '마스크'], ['blaze', '이마 포인트'], ['spots', '점박이']] as Array<[MarkingPattern, string]>,
  brow: [['none', '없음'], ['soft', '부드러운 눈썹'], ['caterpillar', '송충이 눈썹'], ['angled', '팔자 눈썹']] as Array<[BrowStyle, string]>,
  tongue: [['drop', '물방울 혀'], ['round', '둥근 혀'], ['wide', '넓은 혀'], ['side', '옆으로 나온 혀']] as Array<[TongueShape, string]>,
};

export function reviewSimilarityScore(
  traits: PetTraitsV1,
  style: PetStyleV1,
  otherTraits: PetTraitsV1,
  otherStyle?: PetStyleV1,
) {
  const resolvedOtherStyle = otherStyle ?? {
    schemaVersion: 1,
    coatMode: otherTraits.baseColor === otherTraits.secondaryColor && otherTraits.markingPattern === 'none' ? 'solid' : 'point',
    furStyle: 'neat',
  };
  const traitsMatch = traits.schemaVersion === otherTraits.schemaVersion
    && traits.earShape === otherTraits.earShape
    && traits.headShape === otherTraits.headShape
    && traits.baseColor === otherTraits.baseColor
    && traits.secondaryColor === otherTraits.secondaryColor
    && traits.markingPattern === otherTraits.markingPattern
    && traits.muzzle === otherTraits.muzzle;
  const styleMatch = JSON.stringify(style) === JSON.stringify(resolvedOtherStyle);
  return traitsMatch && styleMatch ? 100 : 0;
}

function ReviewDesignEditor({ item, name, traits, style, accessory, photoUrl, accessoryLocked = false, disabled, onTraits, onStyle, onAccessory }: {
  item: Pick<ReviewQueueItem, 'petId' | 'name' | 'designVersion'>;
  name?: string;
  traits: PetTraitsV1;
  style: PetStyleV1;
  accessory: PetAccessory | null;
  photoUrl?: string;
  accessoryLocked?: boolean;
  disabled: boolean;
  onTraits: (traits: PetTraitsV1) => void;
  onStyle: (style: PetStyleV1) => void;
  onAccessory: (accessory: PetAccessory | null) => void;
}) {
  const expression = style.expression ?? getPetExpression(item.petId);
  const previewPet = {
    id: item.petId,
    name: name ?? getPetDisplayName(item),
    traits,
    publishedStyle: { ...style, expression },
    publishedAccessory: accessory ?? undefined,
    designVersion: item.designVersion,
  };
  const selectTrait = <K extends keyof PetTraitsV1>(key: K, value: PetTraitsV1[K]) => onTraits({ ...traits, [key]: value });
  const setBaseColor = (baseColor: CoatColor) => {
    if (style.coatMode === 'solid') {
      onTraits({ ...traits, baseColor, secondaryColor: baseColor, markingPattern: 'none' });
      return;
    }
    onTraits({ ...traits, baseColor, secondaryColor: traits.secondaryColor === baseColor ? getSoftPointColor(baseColor) : traits.secondaryColor });
  };
  const setCoatMode = (coatMode: PetStyleV1['coatMode']) => {
    onTraits(applyCoatMode(traits, coatMode));
    onStyle({ ...style, coatMode });
  };
  return (
    <section className="review-design-editor" aria-label="최종 캐릭터 보정">
      <div className="review-section-heading"><span>최종 캐릭터 보정</span><span className="review-character-status">실사 기준</span></div>
      <div className="review-design-workspace">
        <aside className="review-design-reference" aria-label="검수 기준 미리보기">
          {photoUrl && <figure className="review-design-photo"><img src={photoUrl} alt={`${name ?? getPetDisplayName(item)} 검수 실사`} /><figcaption>등록 실사</figcaption></figure>}
          <div className="review-design-size-previews" aria-label="최종 크기 미리보기">
            {[64, 114, 190].map((size) => <figure key={size}><PetArtwork pet={previewPet} size={size} /><figcaption>{size}px</figcaption></figure>)}
          </div>
        </aside>
        <div className="review-design-controls">
          <div className="review-design-fields">
        <label>귀<select disabled={disabled} value={traits.earShape} onChange={(event) => selectTrait('earShape', event.target.value as EarShape)}>{REVIEW_OPTIONS.earShape.map(([value,label]) => <option key={value} value={value}>{label}</option>)}</select></label>
        <label>머리<select disabled={disabled} value={traits.headShape} onChange={(event) => selectTrait('headShape', event.target.value as HeadShape)}>{REVIEW_OPTIONS.headShape.map(([value,label]) => <option key={value} value={value}>{label}</option>)}</select></label>
        <label>주둥이<select disabled={disabled} value={traits.muzzle} onChange={(event) => selectTrait('muzzle', event.target.value as PetTraitsV1['muzzle'])}>{REVIEW_OPTIONS.muzzle.map(([value,label]) => <option key={value} value={value}>{label}</option>)}</select></label>
        <label>털 윤곽<select disabled={disabled} value={style.furStyle} onChange={(event) => onStyle({ ...style, furStyle: event.target.value as FurStyle })}>{REVIEW_OPTIONS.furStyle.map(([value,label]) => <option key={value} value={value}>{label}</option>)}</select></label>
        <label>털색 방식<select disabled={disabled} value={style.coatMode} onChange={(event) => setCoatMode(event.target.value as PetStyleV1['coatMode'])}><option value="point">포인트형</option><option value="solid">한 가지 색</option></select></label>
        <label>기본색<select disabled={disabled} value={traits.baseColor} onChange={(event) => setBaseColor(event.target.value as CoatColor)}>{REVIEW_OPTIONS.coatColor.map(([value,label]) => <option key={value} value={value}>{label}</option>)}</select></label>
        {style.coatMode === 'point' && <label>포인트색<select disabled={disabled} value={traits.secondaryColor} onChange={(event) => selectTrait('secondaryColor', event.target.value === traits.baseColor ? getSoftPointColor(traits.baseColor) : event.target.value as CoatColor)}>{REVIEW_OPTIONS.coatColor.filter(([value]) => value !== traits.baseColor).map(([value,label]) => <option key={value} value={value}>{label}</option>)}</select></label>}
        {style.coatMode === 'point' && <label>얼굴 무늬<select disabled={disabled} value={traits.markingPattern} onChange={(event) => selectTrait('markingPattern', event.target.value as MarkingPattern)}>{REVIEW_OPTIONS.marking.map(([value,label]) => <option key={value} value={value}>{label}</option>)}</select></label>}
        <label>눈썹<select disabled={disabled} value={expression.browStyle} onChange={(event) => onStyle({ ...style, expression: { ...expression, browStyle: event.target.value as BrowStyle } })}>{REVIEW_OPTIONS.brow.map(([value,label]) => <option key={value} value={value}>{label}</option>)}</select></label>
        <label>혀<select disabled={disabled} value={expression.tongueShape} onChange={(event) => onStyle({ ...style, expression: { ...expression, tongueShape: event.target.value as TongueShape } })}>{REVIEW_OPTIONS.tongue.map(([value,label]) => <option key={value} value={value}>{label}</option>)}</select></label>
          </div>
          <div className="review-accessory-kind-options">
            <button type="button" className={!accessory ? 'is-selected' : ''} onClick={() => onAccessory(null)} disabled={disabled || accessoryLocked}>소품 없음</button>
            {PET_ACCESSORY_KINDS.map((kind) => <button type="button" key={kind} className={accessory?.kind === kind ? 'is-selected' : ''} onClick={() => onAccessory(createPetAccessory(kind, accessory?.color ?? 'pink'))} disabled={disabled || accessoryLocked}>{PET_ACCESSORY_KIND_LABELS[kind]}</button>)}
          </div>
          {accessory && <div className="review-accessory-color-options" aria-label="소품 색상">{PET_ACCESSORY_COLORS.map((color) => <button type="button" key={color} className={accessory.color === color ? 'is-selected' : ''} aria-pressed={accessory.color === color} onClick={() => onAccessory(createPetAccessory(accessory.kind, color))} disabled={disabled || accessoryLocked}><span style={{ background: PET_ACCESSORY_COLOR_HEX[color] }} />{PET_ACCESSORY_COLOR_LABELS[color]}</button>)}</div>}
          {accessoryLocked && <p className="review-accessory-lock-note">사용자가 직접 고른 소품이라 검수에서 바꾸지 않아요.</p>}
        </div>
      </div>
    </section>
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
  onSubmit: (result: ReviewDialogResult) => void;
}) {
  const [reason, setReason] = useState('');
  const curatedDraft = useMemo(() => getCuratedReviewDraft(pending.item), [pending.item]);
  const [reviewNote, setReviewNote] = useState(() => curatedDraft?.reviewNote ?? '');
  const [finalName, setFinalName] = useState(() => curatedDraft?.displayName ?? getPetDisplayName(pending.item));
  const [finalTraits, setFinalTraits] = useState<PetTraitsV1>(() => ({ ...(curatedDraft?.traits ?? pending.item.submittedTraits) }));
  const [finalStyle, setFinalStyle] = useState<PetStyleV1>(() => ({ ...(curatedDraft?.style ?? pending.item.submittedStyle) }));
  const [publishedAccessory, setPublishedAccessory] = useState<PetAccessory | null>(() => pending.item.requestedAccessory ?? pending.item.publishedAccessory);
  const dialogRef = useRef<HTMLDivElement>(null);
  const isReject = pending.decision === 'rejected';
  const trimmedReason = reason.trim();
  const trimmedFinalName = finalName.trim();
  const finalNameValid = /^[가-힣A-Za-z0-9]{1,4}$/u.test(trimmedFinalName);
  const displayName = getPetDisplayName(pending.item);
  const hasExactDecorationMatch = !isReject && pending.item.similarPets.some((pet) => (
    reviewSimilarityScore(finalTraits, finalStyle, pet.traits, pet.publishedStyle) === 100
      && JSON.stringify(publishedAccessory) === JSON.stringify(pet.publishedAccessory ?? null)
  ));

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
        className={`review-dialog ${isReject ? '' : 'review-dialog--design'}`}
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

        {!isReject && (
          <>
            <label className="review-name-field">
              <span>최종 이름 <strong>필수</strong></span>
              <input value={finalName} onChange={(event) => setFinalName(event.target.value)} maxLength={4} disabled={submitting} aria-invalid={!finalNameValid} />
              <small>{finalName.length}/4 · 한글, 영문, 숫자만 사용할 수 있어요.</small>
            </label>
            <ReviewDesignEditor
              item={pending.item}
              name={trimmedFinalName || undefined}
              traits={finalTraits}
              style={finalStyle}
              accessory={publishedAccessory}
              photoUrl={pending.item.photoUrls[0]}
              accessoryLocked={pending.item.accessorySelectionMode === 'owner'}
              disabled={submitting}
              onTraits={setFinalTraits}
              onStyle={setFinalStyle}
              onAccessory={setPublishedAccessory}
            />
          </>
        )}

        {hasExactDecorationMatch && (
          <p className="review-similarity-warning" role="note">
            모든 꾸밈 설정이 같은 승인 강아지가 있어요. 사진과 이름만 확인한 뒤 그대로 승인해도 됩니다.
          </p>
        )}

        <label className="review-reason-field">
          <span>검수 메모 <strong>선택</strong></span>
          <textarea
            value={reviewNote}
            onChange={(event) => setReviewNote(event.target.value)}
            placeholder="예: 흰 털에서 분홍 리본의 대비가 가장 잘 보임"
            rows={3}
            maxLength={500}
            disabled={submitting}
          />
          <small>{reviewNote.length}/500 · ChatGPT 답변 전체는 붙여넣지 마세요.</small>
        </label>

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
            onClick={() => onSubmit({
              reason: trimmedReason,
              finalName: trimmedFinalName,
              finalTraits,
              finalStyle,
              publishedAccessory: isReject
                ? null
                : pending.item.accessorySelectionMode === 'owner'
                  ? pending.item.requestedAccessory
                  : publishedAccessory,
              reviewNote: reviewNote.trim(),
            })}
            disabled={submitting || (isReject && !trimmedReason) || (!isReject && !finalNameValid) || reason.length > 300 || reviewNote.length > 500}
          >
            {submitting ? '저장 중…' : isReject ? '반려 확정' : '승인 확정'}
          </button>
        </div>
      </div>
    </div>
  );
}

function CatalogPanel({ items, query, loading, disabled, onQuery, onSearch, onManage }: {
  items: ReviewCatalogItem[];
  query: string;
  loading: boolean;
  disabled: boolean;
  onQuery: (query: string) => void;
  onSearch: () => void;
  onManage: (item: ReviewCatalogItem, action: PublicationAction) => void;
}) {
  return (
    <section className="review-catalog" aria-label="승인 강아지 관리">
      <div className="review-section-heading"><span>승인된 강아지 관리</span><span className="review-character-status">이름 또는 ID</span></div>
      <form className="review-catalog-search" onSubmit={(event) => { event.preventDefault(); onSearch(); }}>
        <input value={query} onChange={(event) => onQuery(event.target.value)} placeholder="예: 우유 또는 강아지 ID" maxLength={50} disabled={loading || disabled} />
        <button className="review-button review-button--secondary" type="submit" disabled={loading || disabled}>{loading ? '찾는 중…' : '검색'}</button>
      </form>
      {items.length > 0 && <div className="review-catalog-list">{items.map((item) => (
        <article key={`${item.petId}-${item.designVersion}`}>
          <PetArtwork pet={{ id:item.petId, name:item.name ?? undefined, traits:item.traits, publishedStyle:item.publishedStyle, publishedAccessory:item.publishedAccessory ?? undefined, designVersion:item.designVersion }} size={78} />
          <div><strong>{item.name || '이름 없음'}</strong><small>{item.petId}</small><span className={item.status === 'paused' ? 'is-paused' : ''}>{item.status === 'paused' ? '공개 중지' : '공개 중'}</span></div>
          <div className="review-catalog-actions">
            <button type="button" onClick={() => onManage(item, item.status === 'paused' ? 'republish' : 'revise')} disabled={disabled}>{item.status === 'paused' ? '보정 후 재공개' : '디자인 보정'}</button>
            {item.status === 'approved' && <button type="button" onClick={() => onManage(item, 'pause')} disabled={disabled}>공개 중지</button>}
          </div>
        </article>
      ))}</div>}
    </section>
  );
}

function PublicationDialog({ item, action, submitting, error, onCancel, onSubmit }: {
  item: ReviewCatalogItem;
  action: PublicationAction;
  submitting: boolean;
  error: string;
  onCancel: () => void;
  onSubmit: (value: { traits: PetTraitsV1; style: PetStyleV1; accessory: PetAccessory | null; note: string }) => void;
}) {
  const [traits, setTraits] = useState(() => ({ ...item.traits }));
  const [style, setStyle] = useState(() => ({ ...item.publishedStyle }));
  const [accessory, setAccessory] = useState<PetAccessory | null>(item.publishedAccessory);
  const [note, setNote] = useState('');
  const isPause = action === 'pause';
  return (
    <div className="review-dialog-backdrop">
      <div className="review-dialog" role="dialog" aria-modal="true" aria-labelledby="publication-dialog-title">
        <p className={`review-dialog-kicker ${isPause ? 'is-reject' : 'is-approve'}`}>승인 강아지 관리</p>
        <h2 id="publication-dialog-title">{item.name || '이름 없는 강아지'} · {isPause ? '공개 중지' : action === 'republish' ? '재공개' : '디자인 보정'}</h2>
        {!isPause && <ReviewDesignEditor item={{ petId:item.petId, name:item.name, designVersion:item.designVersion }} traits={traits} style={style} accessory={accessory} disabled={submitting} onTraits={setTraits} onStyle={setStyle} onAccessory={setAccessory} />}
        <label className="review-reason-field"><span>변경 메모 <strong>필수</strong></span><textarea value={note} onChange={(event) => setNote(event.target.value)} rows={3} maxLength={500} placeholder={isPause ? '예: 원본 사진 재확인이 필요해 임시 중지' : '예: 실사에 맞춰 복슬한 털로 보정'} disabled={submitting} /><small>{note.length}/500</small></label>
        {error && <p className="review-dialog-error" role="alert">{error}</p>}
        <div className="review-dialog-actions"><button className="review-button review-button--secondary" type="button" onClick={onCancel} disabled={submitting}>취소</button><button className={`review-button ${isPause ? 'review-button--reject-confirm' : 'review-button--approve'}`} type="button" disabled={submitting || !note.trim()} onClick={() => onSubmit({ traits, style, accessory, note:note.trim() })}>{submitting ? '저장 중…' : '변경 저장'}</button></div>
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
  const [catalogQuery, setCatalogQuery] = useState('');
  const [catalogItems, setCatalogItems] = useState<ReviewCatalogItem[]>([]);
  const [catalogLoading, setCatalogLoading] = useState(false);
  const [managing, setManaging] = useState<{ item: ReviewCatalogItem; action: PublicationAction } | null>(null);
  const [manageError, setManageError] = useState('');
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

  const loadCatalog = useCallback(async () => {
    setCatalogLoading(true);
    try {
      const results = await api.getCatalog(catalogQuery);
      setCatalogItems(results);
      if (!results.length) showToast('조건에 맞는 승인 강아지가 없어요.');
    } catch {
      showToast('승인 강아지를 찾지 못했어요.');
    } finally {
      setCatalogLoading(false);
    }
  }, [api, catalogQuery, showToast]);

  const submitPublication = async ({ traits, style, accessory, note }: { traits: PetTraitsV1; style: PetStyleV1; accessory: PetAccessory | null; note: string }) => {
    if (!managing) return;
    setSubmitting(true);
    setManageError('');
    try {
      const result = await api.manage({
        petId: managing.item.petId,
        action: managing.action,
        ...(managing.action !== 'pause' ? { finalTraits: traits, finalStyle: style, publishedAccessory: accessory } : {}),
        reviewNote: note,
      });
      setCatalogItems((current) => current.map((item) => item.petId === managing.item.petId
        ? { ...item, status: result.status, traits, publishedStyle: style, publishedAccessory: accessory, designVersion:item.designVersion + 1 }
        : item));
      showToast(`${managing.item.name || '강아지'}의 ${managing.action === 'pause' ? '공개를 중지했어요.' : '디자인을 저장했어요.'}`);
      setManaging(null);
    } catch {
      setManageError('변경을 저장하지 못했어요. 잠시 후 다시 시도해 주세요.');
    } finally {
      setSubmitting(false);
    }
  };

  const submitReview = async ({ reason, finalName, finalTraits, finalStyle, publishedAccessory, reviewNote }: ReviewDialogResult) => {
    if (!pending) return;
    setSubmitting(true);
    setDialogError('');

    try {
      await api.review({
        petId: pending.item.petId,
        decision: pending.decision,
        ...(pending.decision === 'rejected' ? { reason } : {}),
        ...(pending.decision === 'approved' ? { finalName, finalTraits, finalStyle, publishedAccessory } : {}),
        ...(reviewNote ? { reviewNote } : {}),
      });
      setItems((current) => current.filter((item) => item.petId !== pending.item.petId));
      showToast(`${pending.decision === 'approved' ? finalName : getPetDisplayName(pending.item)} 등록을 ${pending.decision === 'approved' ? '승인' : '반려'}했어요.`);
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
        <CatalogPanel
          items={catalogItems}
          query={catalogQuery}
          loading={catalogLoading}
          disabled={submitting}
          onQuery={setCatalogQuery}
          onSearch={() => void loadCatalog()}
          onManage={(item, action) => { setManageError(''); setManaging({ item, action }); }}
        />
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
                onNotice={showToast}
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
          onSubmit={(result) => void submitReview(result)}
        />
      )}

      {managing && <PublicationDialog item={managing.item} action={managing.action} submitting={submitting} error={manageError} onCancel={() => { if (!submitting) setManaging(null); }} onSubmit={(value) => void submitPublication(value)} />}

      {toast && <CompletionToast notice={toast} onDismiss={() => setToast(null)} />}
    </div>
  );
}
