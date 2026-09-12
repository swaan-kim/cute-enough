import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ReviewPetArtwork as PetArtwork } from './ReviewPetArtwork';
import { ReviewPhotoAdditions } from './ReviewPhotoAdditions';
import { validatePetDesign } from '../../supabase/functions/_shared/pet-design';
import { updateDesignEditor, type PetDesignEditorState } from '../design/designEditor';
import { createReviewEditor } from './reviewDesign';
import type { ReviewEditorState, ReviewDesignDraft, ReviewPhotoSet } from './types';
import { activeReviewPhotos, legacyReviewPhotos, ReviewPhotoGallery, ReviewPhotoManager, ReviewPhotoReference } from './ReviewPhotos';
import { normalizePetStyle } from '../lib/petStyle';
import { CATALOG_ARTWORK_LABELS, catalogArtworkStatus, ReviewCatalogArtwork } from './ReviewCatalogArtwork';
import {
  PET_ACCESSORY_COLORS,
  PET_ACCESSORY_COLOR_HEX,
  PET_ACCESSORY_COLOR_LABELS,
  PET_ACCESSORY_KINDS,
  PET_ACCESSORY_KIND_LABELS,
  createPetAccessory,
  petAccessoryLabel,
} from '../lib/petAccessory';
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
  editorState: ReviewEditorState;
  draftOnly?: boolean;
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

function PhotoPanel({ item, onPhotoLoaded, onPhotoFailed, onNotice, onManage, disabled }: { item: ReviewQueueItem; onPhotoLoaded: (url: string) => void; onPhotoFailed: (url: string) => void; onNotice: (message: string) => void; onManage: () => void; disabled: boolean }) {
  const displayName = getPetDisplayName(item);
  return <div className="review-photo-panel">
    <div className="review-section-heading"><span>등록 실사</span><span className={`review-photo-status ${item.photoPresent ? 'is-present' : 'is-missing'}`}>{item.photoPresent ? '사진 있음' : '사진 없음'}</span></div>
    <ReviewPhotoGallery name={displayName} photos={legacyReviewPhotos(item.photoUrls)} onPhotoLoaded={onPhotoLoaded} onPhotoFailed={onPhotoFailed}
      onDownload={(url) => void saveReviewPhoto(url, displayName).then(() => onNotice('768px 이하 검수용 사진을 저장했어요.')).catch(() => onNotice('검수용 사진을 저장하지 못했어요.'))} />
    <button className="review-button review-button--secondary review-photo-manage" type="button" disabled={disabled} onClick={onManage}>사진 관리</button>
  </div>;
}

function ReviewCard({
  item,
  disabled,
  onOpenReview,
  onManagePhotos,
  onNotice,
}: {
  item: ReviewQueueItem;
  disabled: boolean;
  onOpenReview: (item: ReviewQueueItem, decision: ReviewDecision) => void;
  onManagePhotos: (item: ReviewQueueItem) => void;
  onNotice: (message: string) => void;
}) {
  const displayName = getPetDisplayName(item);
  const [seenPhotos, setSeenPhotos] = useState<ReadonlySet<string>>(() => new Set());
  const photoCount = item.photoCount ?? item.photoUrls.length;
  const photosMissing = photoCount > item.photoUrls.length;
  const seenCount = item.photoUrls.filter((url) => seenPhotos.has(url)).length;
  const photoSeen = photoCount > 0 && !photosMissing && seenCount === photoCount;
  useEffect(() => { setSeenPhotos(new Set()); }, [item.photoUrls]);
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
        <PhotoPanel item={item}
          onPhotoLoaded={(url) => setSeenPhotos((current) => new Set(current).add(url))}
          onPhotoFailed={(url) => setSeenPhotos((current) => { const next = new Set(current); next.delete(url); return next; })}
          onNotice={onNotice} onManage={() => onManagePhotos(item)} disabled={disabled} />
        <div className="review-character-panel">
          <div className="review-section-heading">
            <span>{item.draftDesign ? '저장된 SVG 초안' : curatedDraft ? '캐릭터 비교' : '생성 캐릭터'}</span>
            <span className="review-character-status">{item.draftDesign ? 'DB 저장본 · 미공개' : curatedDraft ? '검수 제안 있음' : '미리보기'}</span>
          </div>
          {!item.draftDesign && curatedDraft && suggestedPet ? (
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
                  <PetArtwork pet={pet} document={item.draftDesign?.document} size={size} />
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
          <p className="review-card-warning" role="note">{photosMissing
            ? '일부 사진을 불러오지 못했어요. 새로고침 후 모든 사진을 확인해 주세요.'
            : photoCount > 1 ? `사진 ${seenCount}/${photoCount}장 확인 · 모든 사진을 확인하면 승인할 수 있습니다.`
              : '실사 사진을 확인하면 승인할 수 있습니다.'}</p>
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

function useReviewDesign(item: ReviewQueueItem | ReviewCatalogItem) {
  const [editor, setEditor] = useState(() => createReviewEditor(item));
  const savedRevision = item.draftDesign?.draftRevision;
  useEffect(() => {
    if (item.draftDesign) setEditor(createReviewEditor(item));
  }, [savedRevision]); // A successful save displays the document read back from DB.
  const traits = editor.input.traits;
  const style = normalizePetStyle(traits, editor.input.style);
  const accessory = editor.input.accessory ?? null;
  const setTraits = (value: PetTraitsV1) => setEditor((current) => updateDesignEditor(current, { traits: value }));
  const setStyle = (value: PetStyleV1) => setEditor((current) => updateDesignEditor(current, { style: value, expression: value.expression ?? current.input.expression }));
  const setAccessory = (value: PetAccessory | null) => setEditor((current) => updateDesignEditor(current, { accessory: value ?? undefined }));
  const editorState: ReviewEditorState = { finalTraits: traits, finalStyle: style, publishedAccessory: accessory, editor };
  return { editor, setEditor, traits, style, accessory, setTraits, setStyle, setAccessory, editorState };
}

function ReviewDesignEditor({ item, name, traits, style, accessory, api, photoUrls, editor, onEditor, disabled, onTraits, onStyle, onAccessory }: {
  item: Pick<ReviewQueueItem, 'petId' | 'name' | 'designVersion'>;
  name?: string;
  traits: PetTraitsV1;
  style: PetStyleV1;
  accessory: PetAccessory | null;
  api: ReviewApi;
  photoUrls?: string[];
  editor: PetDesignEditorState;
  onEditor: (editor: PetDesignEditorState) => void;
  disabled: boolean;
  onTraits: (traits: PetTraitsV1) => void;
  onStyle: (style: PetStyleV1) => void;
  onAccessory: (accessory: PetAccessory | null) => void;
}) {
  const expression = style.expression ?? editor.input.expression ?? { browStyle: 'none', tongueShape: 'drop' };
  const [importError, setImportError] = useState('');
  const [animate, setAnimate] = useState(false);
  const hasCustomParts = Boolean(editor.input.signature) || JSON.stringify(editor.document) !== JSON.stringify(editor.baseDocument);
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
          <ReviewPhotoReference api={api} petId={item.petId} name={name ?? getPetDisplayName(item)} fallbackUrls={photoUrls} />
          <div className="review-design-size-previews" aria-label="최종 크기 미리보기">
            {[64, 114, 190].map((size) => <figure key={size}><PetArtwork pet={previewPet} document={editor.document} size={size} active={animate} eating={animate} panting={animate} /><figcaption>{size}px</figcaption></figure>)}
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
          {hasCustomParts && <p className="review-accessory-lock-note">전용 소품·특수 도형은 SVG 미리보기에 포함되어 있어요. 아래에서 기본 소품을 더할 수 있어요.</p>}
          <div className="review-accessory-kind-options">
            <button type="button" className={!accessory ? 'is-selected' : ''} onClick={() => onAccessory(null)} disabled={disabled}>{hasCustomParts ? '추가 소품 없음' : '소품 없음'}</button>
            {PET_ACCESSORY_KINDS.map((kind) => <button type="button" key={kind} className={accessory?.kind === kind ? 'is-selected' : ''} onClick={() => onAccessory(createPetAccessory(kind, accessory?.color ?? 'pink'))} disabled={disabled}>{PET_ACCESSORY_KIND_LABELS[kind]}</button>)}
          </div>
          {accessory && <div className="review-accessory-color-options" aria-label="소품 색상">{PET_ACCESSORY_COLORS.map((color) => <button type="button" key={color} className={accessory.color === color ? 'is-selected' : ''} aria-pressed={accessory.color === color} onClick={() => onAccessory(createPetAccessory(accessory.kind, color))} disabled={disabled}><span style={{ background: PET_ACCESSORY_COLOR_HEX[color] }} />{PET_ACCESSORY_COLOR_LABELS[color]}</button>)}</div>}
          <p className="review-accessory-lock-note">사용자가 고른 원래 소품은 보관하고, 최종 소품은 제작자가 결정합니다.</p>
          <label><input type="checkbox" checked={animate} onChange={(event) => setAnimate(event.target.checked)} /> 기존 동작 확인</label>
          <details><summary>제작자 SVG 도형 가져오기</summary>
            <p>새 소품이 포함된 디자인 JSON을 불러와 검수합니다. 확정 저장하면 같은 도형이 앱에 표시됩니다.</p>
            <input type="file" accept="application/json,.json" disabled={disabled} aria-label="SVG 디자인 JSON 불러오기" onChange={async (event) => {
              const file = event.target.files?.[0];
              if (!file) return;
              try {
                if (file.size > 200000) throw new Error('디자인 파일은 200KB 이하여야 해요.');
                const document = validatePetDesign(JSON.parse(await file.text()));
                onEditor({ ...editor, document }); setImportError('');
              } catch (error) { setImportError(error instanceof Error ? error.message : '도형을 확인해 주세요.'); }
              event.target.value = '';
            }} />
            {importError && <p role="alert">{importError}</p>}
          </details>
        </div>
      </div>
    </section>
  );
}

function ReviewDialog({
  api,
  pending,
  submitting,
  error,
  onCancel,
  onSubmit,
}: {
  api: ReviewApi;
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
  const { editor, setEditor, traits: finalTraits, style: finalStyle, accessory: publishedAccessory,
    setTraits: setFinalTraits, setStyle: setFinalStyle, setAccessory: setPublishedAccessory, editorState } = useReviewDesign(pending.item);
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
            : '지금 보이는 SVG 도형과 소품을 확정하고 승인합니다. 앱에서도 같은 디자인으로 기존 동작을 보여줍니다.'}
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
              api={api}
              photoUrls={pending.item.photoUrls}
              editor={editor}
              onEditor={setEditor}
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
          {!isReject && <button className="review-button review-button--secondary" type="button" disabled={submitting}
            onClick={() => onSubmit({ reason: '', finalName: trimmedFinalName, finalTraits, finalStyle, publishedAccessory, reviewNote: reviewNote.trim(), editorState, draftOnly: true })}>초안 저장</button>}
          <button
            className={`review-button ${isReject ? 'review-button--reject-confirm' : 'review-button--approve'}`}
            type="button"
            onClick={() => onSubmit({
              reason: trimmedReason,
              finalName: trimmedFinalName,
              finalTraits,
              finalStyle,
              publishedAccessory: isReject ? null : publishedAccessory,
              editorState,
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

function CatalogPanel({ items, query, loading, disabled, onQuery, onSearch, onManage, onManagePhotos }: {
  items: ReviewCatalogItem[];
  query: string;
  loading: boolean;
  disabled: boolean;
  onQuery: (query: string) => void;
  onSearch: () => void;
  onManage: (item: ReviewCatalogItem, action: PublicationAction) => void;
  onManagePhotos: (item: ReviewCatalogItem) => void;
}) {
  return (
    <section className="review-catalog" aria-label="승인 강아지 관리">
      <div className="review-section-heading"><span>승인된 강아지 관리</span><span className="review-character-status">이름 또는 ID</span></div>
      <form className="review-catalog-search" onSubmit={(event) => { event.preventDefault(); onSearch(); }}>
        <input value={query} onChange={(event) => onQuery(event.target.value)} placeholder="예: 우유 또는 강아지 ID" maxLength={50} disabled={loading || disabled} />
        <button className="review-button review-button--secondary" type="submit" disabled={loading || disabled}>{loading ? '찾는 중…' : '검색'}</button>
      </form>
      {items.length > 0 && <p className="review-catalog-summary" role="note">조회 {items.length}마리 · 확정 SVG {items.filter((item) => catalogArtworkStatus(item) === 'ready').length}마리 · 확인 필요 {items.filter((item) => catalogArtworkStatus(item) !== 'ready').length}마리</p>}
      {items.length > 0 && <div className="review-catalog-list">{items.map((item) => (
        <article key={`${item.petId}-${item.designVersion}`}>
          <ReviewCatalogArtwork item={item} loading={loading || disabled} onReload={onSearch} />
          <div><strong>{item.name || '이름 없음'}</strong><small>{item.petId}</small><span className={item.status === 'paused' ? 'is-paused' : ''}>{item.status === 'paused' ? '공개 중지' : '공개 중'}</span><small>{CATALOG_ARTWORK_LABELS[catalogArtworkStatus(item)]}</small></div>
          <div className="review-catalog-actions">
            <button type="button" onClick={() => onManagePhotos(item)} disabled={disabled}>사진 관리</button>
            <button type="button" onClick={() => onManage(item, item.status === 'paused' ? 'republish' : 'revise')} disabled={disabled}>{item.status === 'paused' ? '보정 후 재공개' : item.publishedDesign ? '디자인 보정' : '확정 SVG 저장'}</button>
            {item.status === 'approved' && <button type="button" onClick={() => onManage(item, 'pause')} disabled={disabled}>공개 중지</button>}
          </div>
        </article>
      ))}</div>}
    </section>
  );
}

function PublicationDialog({ api, item, action, submitting, error, onCancel, onSubmit }: {
  api: ReviewApi;
  item: ReviewCatalogItem;
  action: PublicationAction;
  submitting: boolean;
  error: string;
  onCancel: () => void;
  onSubmit: (value: { editorState: ReviewEditorState; note: string; draftOnly?: boolean }) => void;
}) {
  const { editor, setEditor, traits, style, accessory, setTraits, setStyle, setAccessory, editorState } = useReviewDesign(item);
  const [note, setNote] = useState('');
  const isPause = action === 'pause';
  return (
    <div className="review-dialog-backdrop">
      <div className="review-dialog" role="dialog" aria-modal="true" aria-labelledby="publication-dialog-title">
        <p className={`review-dialog-kicker ${isPause ? 'is-reject' : 'is-approve'}`}>승인 강아지 관리</p>
        <h2 id="publication-dialog-title">{item.name || '이름 없는 강아지'} · {isPause ? '공개 중지' : action === 'republish' ? '재공개' : item.publishedDesign ? '디자인 보정' : '확정 SVG 저장'}</h2>
        {!isPause && <p>아래 SVG 도형을 확인한 뒤 공개 확정합니다. 초안 저장은 공개 모습을 바꾸지 않습니다.</p>}
        {!isPause && <ReviewDesignEditor api={api} item={{ petId:item.petId, name:item.name, designVersion:item.designVersion }} traits={traits} style={style} accessory={accessory} editor={editor} onEditor={setEditor} disabled={submitting} onTraits={setTraits} onStyle={setStyle} onAccessory={setAccessory} />}
        <label className="review-reason-field"><span>변경 메모 <strong>필수</strong></span><textarea value={note} onChange={(event) => setNote(event.target.value)} rows={3} maxLength={500} placeholder={isPause ? '예: 원본 사진 재확인이 필요해 임시 중지' : '예: 실사에 맞춰 복슬한 털로 보정'} disabled={submitting} /><small>{note.length}/500</small></label>
        {error && <p className="review-dialog-error" role="alert">{error}</p>}
        <div className="review-dialog-actions"><button className="review-button review-button--secondary" type="button" onClick={onCancel} disabled={submitting}>취소</button>{!isPause && <button className="review-button review-button--secondary" type="button" disabled={submitting} onClick={() => onSubmit({ editorState, note: note.trim(), draftOnly: true })}>초안 저장</button>}<button className={`review-button ${isPause ? 'review-button--reject-confirm' : 'review-button--approve'}`} type="button" disabled={submitting || !note.trim()} onClick={() => onSubmit({ editorState, note:note.trim() })}>{submitting ? '저장 중…' : isPause ? '공개 중지 확정' : 'SVG 공개 확정'}</button></div>
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
  const [photoItem, setPhotoItem] = useState<ReviewQueueItem | ReviewCatalogItem | null>(null);
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
    } catch (error) {
      showToast(error instanceof TypeError
        ? '검수 서버에 연결하지 못했어요. 서버 실행 상태를 확인해 주세요.'
        : error instanceof Error ? error.message : '승인 강아지 목록을 불러오지 못했어요. 다시 시도해 주세요.');
    } finally {
      setCatalogLoading(false);
    }
  }, [api, catalogQuery, showToast]);

  const rememberDraft = (draft: ReviewDesignDraft) => {
    setItems((current) => current.map((item) => item.petId === draft.petId ? { ...item, draftDesign: draft } : item));
    setCatalogItems((current) => current.map((item) => item.petId === draft.petId ? { ...item, draftDesign: draft } : item));
    setPending((current) => current?.item.petId === draft.petId ? { ...current, item: { ...current.item, draftDesign: draft } } : current);
    setManaging((current) => current?.item.petId === draft.petId ? { ...current, item: { ...current.item, draftDesign: draft } } : current);
  };
  const persistDraft = async (item: ReviewQueueItem | ReviewCatalogItem, editorState: ReviewEditorState) => {
    const draft = await api.saveDraft({ petId: item.petId, expectedDraftRevision: item.draftDesign?.draftRevision ?? 0,
      expectedDesignVersion: item.designVersion, document: editorState.editor.document, editorState });
    rememberDraft(draft);
    return draft;
  };
  const submitPublication = async ({ editorState, note, draftOnly }: { editorState: ReviewEditorState; note: string; draftOnly?: boolean }) => {
    if (!managing) return;
    setSubmitting(true); setManageError('');
    try {
      const draft = managing.action !== 'pause' ? await persistDraft(managing.item, editorState) : undefined;
      if (draftOnly) { showToast('SVG 초안을 저장하고 DB 저장본을 다시 불러왔어요.'); return; }
      await api.manage({ petId: managing.item.petId, action: managing.action, reviewNote: note,
        expectedDraftRevision: draft?.draftRevision, expectedDesignVersion: managing.item.designVersion });
      setManaging(null);
      showToast(managing.action === 'pause' ? '공개를 중지했어요.' : 'SVG 디자인을 확정했어요.');
      void api.getCatalog(catalogQuery).then(setCatalogItems).catch(() => showToast('확정은 완료됐어요. 저장본은 검색으로 다시 불러와 주세요.'));
    } catch (error) { setManageError(error instanceof Error ? error.message : '저장하지 못했어요. 새로고침 후 확인해 주세요.'); }
    finally { setSubmitting(false); }
  };
  const submitReview = async ({ reason, finalName, reviewNote, editorState, draftOnly }: ReviewDialogResult) => {
    if (!pending) return;
    setSubmitting(true); setDialogError('');
    try {
      const draft = pending.decision === 'approved' ? await persistDraft(pending.item, editorState) : undefined;
      if (draftOnly) { showToast('SVG 초안을 저장하고 DB 저장본을 다시 불러왔어요.'); return; }
      await api.review({ petId: pending.item.petId, decision: pending.decision,
        ...(pending.decision === 'rejected' ? { reason } : { finalName, expectedDraftRevision: draft?.draftRevision, expectedDesignVersion: pending.item.designVersion }), reviewNote });
      setItems((current) => current.filter((item) => item.petId !== pending.item.petId));
      showToast(pending.decision === 'approved' ? finalName + ' 등록을 승인했어요.' : '등록을 반려했어요.');
      setPending(null);
      if (pending.decision === 'approved') void api.getCatalog('').then(setCatalogItems).catch(() => showToast('승인은 완료됐어요. 저장본은 검색으로 다시 불러와 주세요.'));
    } catch (error) { setDialogError(error instanceof Error ? error.message : '저장하지 못했어요. 새로고침 후 확인해 주세요.'); }
    finally { setSubmitting(false); }
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
          disabled={phase === 'loading' || refreshing || submitting || Boolean(photoItem)}
        >
          <span className={refreshing ? 'is-spinning' : ''} aria-hidden="true">↻</span>
          {refreshing ? '새로고침 중' : '새로고침'}
        </button>
      </header>

      <main className="review-main">
        <ReviewPhotoAdditions api={api} />
        <CatalogPanel
          items={catalogItems}
          query={catalogQuery}
          loading={catalogLoading}
          disabled={submitting || Boolean(photoItem)}
          onQuery={setCatalogQuery}
          onSearch={() => void loadCatalog()}
          onManage={(item, action) => { setManageError(''); setManaging({ item, action }); }}
          onManagePhotos={setPhotoItem}
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
                disabled={submitting || Boolean(photoItem)}
                onManagePhotos={setPhotoItem}
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
          api={api}
          key={`${pending.item.petId}-${pending.decision}`}
          pending={pending}
          submitting={submitting}
          error={dialogError}
          onCancel={closeReview}
          onSubmit={(result) => void submitReview(result)}
        />
      )}

      {managing && <PublicationDialog api={api} item={managing.item} action={managing.action} submitting={submitting} error={manageError} onCancel={() => { if (!submitting) setManaging(null); }} onSubmit={(value) => void submitPublication(value)} />}

      {photoItem && <ReviewPhotoManager key={photoItem.petId} api={api} petId={photoItem.petId} name={getPetDisplayName(photoItem)}
        status={'status' in photoItem ? photoItem.status : 'pending'} fallbackUrls={'photoUrls' in photoItem ? photoItem.photoUrls : []}
        onClose={() => setPhotoItem(null)} onSaved={(set: ReviewPhotoSet) => {
          const active = activeReviewPhotos(set.photos);
          setItems((current) => current.map((item) => item.petId === set.petId ? { ...item, photoUrls: active.flatMap((photo) => photo.url ? [photo.url] : []), photoCount: active.length, photoPresent: active.length > 0 } : item));
          showToast('사진 변경을 저장하고 저장본을 다시 불러왔어요.');
        }} onDownload={(url) => void saveReviewPhoto(url, getPetDisplayName(photoItem)).then(() => showToast('768px 이하 검수용 사진을 저장했어요.')).catch(() => showToast('검수용 사진을 저장하지 못했어요.'))} />}

      {toast && <CompletionToast notice={toast} onDismiss={() => setToast(null)} />}
    </div>
  );
}
