import { useEffect, useId, useRef, useState } from 'react';
import { Asset, Button, Top } from '@toss/tds-mobile';
import type { AccessorySelectionMode, CoatColor, CoatMode, EarShape, FurStyle, MarkingPattern, PetAccessory, PetStyleV1, PetTraitsV1, SubmitPetResult } from '../types';
import { fetchSubmissionStatus, isUnknownPetApiOutcome, submitPet, type SubmitPetInput } from '../lib/api';
import { normalizeAndAnalyzePetImage } from '../lib/petImage';
import { getPetNameError, limitPetName, petNameLength, preparePetName } from '../lib/petName';
import { normalizePetTraitColors } from '../lib/petTraits';
import { applyCoatMode, getSoftPointColor } from '../lib/petStyle';
import { isPhotoPickerUnavailableError, pickPhotos, pickPhotosFromBrowser } from '../lib/toss';
import { COAT_COLOR_HEX } from './DogAvatar';
import { PetAccessoryPicker } from './PetAccessoryPicker';
import { PetArtwork } from './PetArtwork';
import { UploadPetPreview } from './UploadPetPreview';
import './UploadFlowPhotos.css';

const fallbackPreviewTraits: PetTraitsV1 = {
  schemaVersion: 1,
  earShape: 'floppy',
  headShape: 'round',
  baseColor: 'cream',
  secondaryColor: 'caramel',
  markingPattern: 'none',
  muzzle: 'short',
  confidence: 1,
};

const primaryEarShapeOptions: Array<{
  value: EarShape;
  label: string;
  description?: string;
}> = [
  { value: 'floppy', label: '포근한 귀' },
  { value: 'upright', label: '쫑긋 귀' },
];

const detailEarShapeOptions: typeof primaryEarShapeOptions = [
  { value: 'semi', label: '살짝 접힌 귀', description: '끝만 살포시 접혔어요' },
  { value: 'rounded', label: '작고 동그란 귀', description: '짧고 둥근 모양이에요' },
];

const markingOptions: Array<{ value: MarkingPattern; label: string }> = [
  { value: 'none', label: '없음' },
  { value: 'brow', label: '눈썹' },
  { value: 'mask', label: '마스크' },
  { value: 'blaze', label: '이마 포인트' },
  { value: 'spots', label: '점박이' },
];

const coatColorOptions: Array<{ value: CoatColor; label: string }> = [
  { value: 'cream', label: '크림' },
  { value: 'caramel', label: '캐러멜' },
  { value: 'chocolate', label: '초콜릿' },
  { value: 'black', label: '검정' },
  { value: 'gray', label: '회색' },
  { value: 'white', label: '흰색' },
];

const furStyleOptions: Array<{ value: FurStyle; label: string; description: string }> = [
  { value: 'neat', label: '단정한 털', description: '매끈하고 둥근 윤곽' },
  { value: 'fluffy', label: '복슬한 털', description: '볼에 짧은 털 굴곡' },
  { value: 'cloud', label: '몽글한 털', description: '구름처럼 부드러운 윤곽' },
];

export function FurStylePicker({ traits, style, disabled = false, onChange }: {
  traits: PetTraitsV1;
  style: PetStyleV1;
  disabled?: boolean;
  onChange: (value: FurStyle) => void;
}) {
  const pickerId = useId().replace(/:/g, '');
  return (
    <fieldset className="fur-style-fieldset">
      <legend>털 윤곽</legend>
      <p className="trait-choice-help" id={`${pickerId}-help`}>사진과 가까운 털의 바깥 모양을 골라주세요.</p>
      <div className="trait-choice-grid fur-style-grid">
        {furStyleOptions.map((option) => (
          <label key={option.value} className={`trait-choice-card fur-style-card ${style.furStyle === option.value ? 'is-selected' : ''}`}>
            <input
              className="trait-choice-input"
              type="radio"
              name={`${pickerId}-fur-style`}
              value={option.value}
              checked={style.furStyle === option.value}
              disabled={disabled}
              aria-describedby={`${pickerId}-help`}
              onChange={() => onChange(option.value)}
            />
            <span className="trait-artwork-preview fur-style-preview" aria-hidden="true">
              <PetArtwork traits={traits} style={{ ...style, furStyle: option.value }} size={72} />
            </span>
            <span className="trait-choice-copy"><strong>{option.label}</strong><small>{option.description}</small></span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}

export function CoatModePicker({ value, disabled = false, onChange }: {
  value: CoatMode;
  disabled?: boolean;
  onChange: (value: CoatMode) => void;
}) {
  const pickerId = useId().replace(/:/g, '');
  const options: Array<{ value: CoatMode; label: string; description: string }> = [
    { value: 'point', label: '포인트가 있어요', description: '귀나 얼굴에 다른 털색이 있어요' },
    { value: 'solid', label: '한 가지 색이에요', description: '전체가 거의 같은 털색이에요' },
  ];
  return (
    <fieldset className="coat-mode-fieldset">
      <legend>털색 방식</legend>
      <div className="coat-mode-grid">
        {options.map((option) => (
          <label key={option.value} className={`coat-mode-card ${value === option.value ? 'is-selected' : ''}`}>
            <input
              className="trait-choice-input"
              type="radio"
              name={`${pickerId}-coat-mode`}
              value={option.value}
              checked={value === option.value}
              disabled={disabled}
              onChange={() => onChange(option.value)}
            />
            <strong>{option.label}</strong>
            <small>{option.description}</small>
          </label>
        ))}
      </div>
    </fieldset>
  );
}

type EarShapePickerProps = {
  value: EarShape;
  traits?: PetTraitsV1;
  disabled?: boolean;
  onChange: (value: EarShape) => void;
};

export function EarShapePicker({ value, traits = fallbackPreviewTraits, disabled = false, onChange }: EarShapePickerProps) {
  const pickerId = useId().replace(/:/g, '');
  const helpId = `${pickerId}-help`;
  const detailsId = `${pickerId}-details`;
  const [detailsOpen, setDetailsOpen] = useState(() => detailEarShapeOptions.some((option) => option.value === value));

  useEffect(() => {
    if (detailEarShapeOptions.some((option) => option.value === value)) setDetailsOpen(true);
  }, [value]);

  const renderOptions = (options: typeof primaryEarShapeOptions) => options.map((option) => {
    const selected = value === option.value;
    const descriptionId = `${pickerId}-${option.value}-description`;
    return (
      <label key={option.value} className={`trait-choice-card ear-choice-card ${selected ? 'is-selected' : ''}`}>
        <input
          className="trait-choice-input"
          type="radio"
          name={`${pickerId}-pet-ear-shape`}
          value={option.value}
          checked={selected}
          disabled={disabled}
          aria-describedby={option.description ? `${helpId} ${descriptionId}` : helpId}
          onChange={() => onChange(option.value)}
        />
        <span className="trait-artwork-preview ear-choice-preview" aria-hidden="true">
          <PetArtwork traits={{ ...traits, earShape: option.value }} size={74} />
        </span>
        <span className="trait-choice-copy">
          <strong>{option.label}</strong>
          {option.description && <small id={descriptionId}>{option.description}</small>}
        </span>
      </label>
    );
  });

  return (
    <fieldset className="ear-choice-fieldset">
      <legend>귀 모양</legend>
      <p className="ear-choice-help" id={helpId}>사진과 가장 닮은 모양을 골라주세요.</p>
      <div className="trait-choice-grid ear-choice-grid">{renderOptions(primaryEarShapeOptions)}</div>
      <button
        type="button"
        className="ear-detail-toggle"
        aria-expanded={detailsOpen}
        aria-controls={detailsId}
        disabled={disabled}
        onClick={() => setDetailsOpen((open) => !open)}
      >
        {detailsOpen ? '다른 귀 모양 닫기' : '다른 귀 모양 보기'}
        <span aria-hidden="true">{detailsOpen ? '⌃' : '⌄'}</span>
      </button>
      {detailsOpen && <div className="trait-choice-grid ear-choice-grid ear-choice-details" id={detailsId}>{renderOptions(detailEarShapeOptions)}</div>}
    </fieldset>
  );
}

type FaceMarkingPickerProps = {
  traits: PetTraitsV1;
  disabled?: boolean;
  onChange: (value: MarkingPattern) => void;
};

export function FaceMarkingPicker({ traits, disabled = false, onChange }: FaceMarkingPickerProps) {
  const pickerId = useId().replace(/:/g, '');
  const helpId = `${pickerId}-help`;
  return (
    <fieldset className="marking-choice-fieldset">
      <legend>얼굴 무늬</legend>
      <p className="trait-choice-help" id={helpId}>얼굴에 보이는 무늬를 골라주세요.</p>
      <div className="trait-choice-grid marking-choice-grid">
        {markingOptions.map((option) => {
          const selected = traits.markingPattern === option.value;
          const previewTraits = normalizePetTraitColors({ ...traits, markingPattern: option.value });
          return (
            <label key={option.value} className={`trait-choice-card marking-choice-card ${selected ? 'is-selected' : ''}`}>
              <input
                className="trait-choice-input"
                type="radio"
                name={`${pickerId}-pet-marking-pattern`}
                value={option.value}
                checked={selected}
                disabled={disabled}
                aria-describedby={helpId}
                onChange={() => onChange(option.value)}
              />
              <span className="trait-artwork-preview marking-choice-preview" aria-hidden="true">
                <PetArtwork traits={previewTraits} size={70} />
              </span>
              <span className="trait-choice-copy"><strong>{option.label}</strong></span>
            </label>
          );
        })}
      </div>
    </fieldset>
  );
}

type CoatColorPickersProps = {
  traits: PetTraitsV1;
  disabled?: boolean;
  showBase?: boolean;
  showPoint?: boolean;
  onBaseColorChange: (value: CoatColor) => void;
  onPointColorChange: (value: CoatColor) => void;
};

function ColorSwatchGroup({
  legend,
  name,
  value,
  disabledColor,
  disabled,
  helpId,
  onChange,
}: {
  legend: string;
  name: string;
  value: CoatColor;
  disabledColor?: CoatColor;
  disabled?: boolean;
  helpId?: string;
  onChange: (value: CoatColor) => void;
}) {
  return (
    <fieldset className="coat-color-fieldset">
      <legend>{legend}</legend>
      <div className="coat-color-options">
        {coatColorOptions.map((option) => {
          const optionDisabled = disabled || option.value === disabledColor;
          return (
            <label key={option.value} className={`coat-color-option ${value === option.value ? 'is-selected' : ''} ${optionDisabled ? 'is-disabled' : ''}`}>
              <input
                className="trait-choice-input"
                type="radio"
                name={name}
                value={option.value}
                checked={value === option.value}
                disabled={optionDisabled}
                aria-describedby={helpId}
                onChange={() => onChange(option.value)}
              />
              <span className="coat-color-swatch" style={{ backgroundColor: COAT_COLOR_HEX[option.value] }} aria-hidden="true" />
              <span>{option.label}</span>
            </label>
          );
        })}
      </div>
    </fieldset>
  );
}

export function CoatColorPickers({ traits, disabled = false, showBase = true, showPoint = true, onBaseColorChange, onPointColorChange }: CoatColorPickersProps) {
  const pickerId = useId().replace(/:/g, '');
  const pointHelpId = `${pickerId}-point-help`;
  return (
    <section className="coat-color-editor" aria-label="털색">
      {showBase && <ColorSwatchGroup
        legend="기본 털색"
        name={`${pickerId}-base-color`}
        value={traits.baseColor}
        disabled={disabled}
        onChange={onBaseColorChange}
      />}
      {showPoint && <ColorSwatchGroup
        legend="포인트 털색"
        name={`${pickerId}-point-color`}
        value={traits.secondaryColor}
        disabledColor={traits.baseColor}
        disabled={disabled}
        helpId={pointHelpId}
        onChange={onPointColorChange}
      />}
      {showPoint && <p className="trait-choice-help coat-color-help" id={pointHelpId}>귀, 입 주변, 눈썹과 얼굴 무늬에 적용돼요. 기본 털색과 다른 색을 골라주세요.</p>}
    </section>
  );
}

type SubmissionPhase = 'editing' | 'submitting' | 'reconciling' | 'uncertain';

const UNKNOWN_SUBMISSION_MESSAGE = '등록됐는지 아직 확인하지 못했어요. 같은 내용으로 다시 확인해 주세요. 같은 강아지가 두 번 등록되지는 않아요.';
const MAX_UPLOAD_PHOTOS = 5;

type PhotoAnalysis = Awaited<ReturnType<typeof normalizeAndAnalyzePetImage>>;
type UploadPhoto = {
  id: string;
  sourceDataUri: string;
  dataUri?: string;
  status: 'queued' | 'processing' | 'ready' | 'error';
  error?: string;
  analysis?: PhotoAnalysis;
};

export function UploadFlow({ onSubmitted }: { onSubmitted: (result: SubmitPetResult) => void }) {
  const [photos, setPhotos] = useState<UploadPhoto[]>([]);
  const photosRef = useRef<UploadPhoto[]>([]);
  const [activePreviewPhotoId, setActivePreviewPhotoId] = useState<string>();
  const [picking, setPicking] = useState(false);
  const pickingRef = useRef(false);
  const processingRef = useRef(false);
  const mountedRef = useRef(true);
  const initialTraitsApplied = useRef(false);
  const [traits, setTraits] = useState<PetTraitsV1>();
  const [style, setStyle] = useState<PetStyleV1>();
  const [analysisNotice, setAnalysisNotice] = useState('');
  const [name, setName] = useState('');
  const [nameTouched, setNameTouched] = useState(false);
  const [accessorySelectionMode, setAccessorySelectionMode] = useState<AccessorySelectionMode>('reviewer');
  const [requestedAccessory, setRequestedAccessory] = useState<PetAccessory>();
  const [customizationOpen, setCustomizationOpen] = useState(false);
  const [submissionPhase, setSubmissionPhase] = useState<SubmissionPhase>('editing');
  const [consented, setConsented] = useState(false);
  const [error, setError] = useState('');
  const [useBrowserPhotoPicker, setUseBrowserPhotoPicker] = useState(false);
  const submissionId = useRef(crypto.randomUUID());
  const frozenSubmission = useRef<SubmitPetInput>();
  const lastPointSelection = useRef<Pick<PetTraitsV1, 'secondaryColor' | 'markingPattern'>>({
    secondaryColor: fallbackPreviewTraits.secondaryColor,
    markingPattern: fallbackPreviewTraits.markingPattern,
  });
  const submissionLocked = submissionPhase !== 'editing';
  const submissionBusy = submissionPhase === 'submitting' || submissionPhase === 'reconciling';
  const analyzing = photos.some((photo) => photo.status === 'queued' || photo.status === 'processing');
  const allPhotosReady = photos.length > 0 && photos.every((photo) => photo.status === 'ready' && photo.dataUri);
  const coverPhoto = photos[0];
  const activePreviewPhoto = photos.find((photo) => photo.id === activePreviewPhotoId) ?? coverPhoto;
  const activePreviewIndex = photos.findIndex((photo) => photo.id === activePreviewPhoto?.id);
  const activePreviewLabel = activePreviewIndex === 0 ? '대표 사진' : `${activePreviewIndex + 1}번 사진`;
  const nameValidationError = getPetNameError(name);
  const currentNameError = nameTouched || name ? nameValidationError : undefined;
  const draftDirty = Boolean(photos.length || name.trim() || traits || consented || accessorySelectionMode === 'owner');

  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  useEffect(() => {
    document.documentElement.dataset.uploadDraftDirty = String(draftDirty);
    window.dispatchEvent(new CustomEvent('cute-enough:upload-dirty-change', {
      detail: { dirty: draftDirty, busy: submissionBusy },
    }));
    const preventAccidentalExit = (event: BeforeUnloadEvent) => {
      if (!draftDirty || submissionBusy) return;
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', preventAccidentalExit);
    return () => {
      window.removeEventListener('beforeunload', preventAccidentalExit);
      delete document.documentElement.dataset.uploadDraftDirty;
      window.dispatchEvent(new CustomEvent('cute-enough:upload-dirty-change', {
        detail: { dirty: false, busy: false },
      }));
    };
  }, [draftDirty, submissionBusy]);

  function updatePhotos(nextPhotos: UploadPhoto[]) {
    photosRef.current = nextPhotos;
    setPhotos(nextPhotos);
    setActivePreviewPhotoId((current) => nextPhotos.some((photo) => photo.id === current) ? current : nextPhotos[0]?.id);
  }

  function initializePreviewFromCover() {
    const result = photosRef.current[0]?.analysis;
    if (!result || initialTraitsApplied.current) return;
    initialTraitsApplied.current = true;
    const nextTraits = normalizePetTraitColors({
      ...result.traits,
      secondaryColor: getSoftPointColor(result.traits.baseColor),
    });
    setTraits(nextTraits);
    setStyle({ schemaVersion: 1, coatMode: 'point', furStyle: 'neat' });
    lastPointSelection.current = {
      secondaryColor: nextTraits.secondaryColor,
      markingPattern: nextTraits.markingPattern,
    };
    setAnalysisNotice(result.notice
      ? `${result.notice} 강아지 사진인지와 실제 공개 여부는 검수에서 확인해요.`
      : '대표 사진의 털색을 참고해 모습을 만들었어요. 강아지 사진인지와 실제 공개 여부는 검수에서 확인해요.');
  }

  async function processPhotos(photoIds: string[]) {
    if (processingRef.current) return;
    processingRef.current = true;
    try {
      // Process one full-size source at a time to keep device memory bounded.
      for (const id of photoIds) {
        if (!mountedRef.current) return;
        const source = photosRef.current.find((photo) => photo.id === id);
        if (!source) continue;
        updatePhotos(photosRef.current.map((photo) => photo.id === id ? { ...photo, status: 'processing', error: undefined } : photo));
        try {
          const result = await normalizeAndAnalyzePetImage(source.sourceDataUri);
          if (!mountedRef.current) return;
          updatePhotos(photosRef.current.map((photo) => photo.id === id
            ? { ...photo, sourceDataUri: result.dataUri, dataUri: result.dataUri, analysis: result, status: 'ready' }
            : photo));
          initializePreviewFromCover();
        } catch (caught) {
          if (!mountedRef.current) return;
          updatePhotos(photosRef.current.map((photo) => photo.id === id
            ? { ...photo, dataUri: undefined, status: 'error', error: caught instanceof Error ? caught.message : '사진 준비를 마치지 못했어요.' }
            : photo));
        }
      }
    } finally {
      processingRef.current = false;
    }
  }

  async function choose() {
    if (pickingRef.current || processingRef.current || submissionLocked || frozenSubmission.current) return;
    const remaining = MAX_UPLOAD_PHOTOS - photosRef.current.length;
    if (remaining <= 0) return;
    pickingRef.current = true;
    setPicking(true);
    setError('');
    try {
      const selected = await (useBrowserPhotoPicker ? pickPhotosFromBrowser(remaining) : pickPhotos(remaining));
      if (!mountedRef.current || frozenSubmission.current || !selected.length) return;
      if (selected.length > MAX_UPLOAD_PHOTOS - photosRef.current.length) {
        setError(`사진은 최대 ${MAX_UPLOAD_PHOTOS}장까지 올릴 수 있어요. 남은 자리만큼 다시 골라주세요.`);
        return;
      }
      const addedPhotos: UploadPhoto[] = selected.map((source) => ({
        id: crypto.randomUUID(),
        sourceDataUri: source.startsWith('data:') ? source : `data:image/jpeg;base64,${source}`,
        status: 'queued',
      }));
      updatePhotos([...photosRef.current, ...addedPhotos]);
      setUseBrowserPhotoPicker(false);
      await processPhotos(addedPhotos.map((photo) => photo.id));
    } catch (caught) {
      if (!mountedRef.current) return;
      if (isPhotoPickerUnavailableError(caught)) setUseBrowserPhotoPicker(true);
      setError(caught instanceof Error ? caught.message : '사진을 불러오지 못했어요.');
    } finally {
      pickingRef.current = false;
      if (mountedRef.current) setPicking(false);
    }
  }

  async function retryAnalysis(id: string) {
    if (pickingRef.current || processingRef.current || submissionLocked || frozenSubmission.current) return;
    if (photosRef.current.find((photo) => photo.id === id)?.status !== 'error') return;
    await processPhotos([id]);
  }

  function removePhoto(id: string) {
    if (submissionLocked || frozenSubmission.current) return;
    updatePhotos(photosRef.current.filter((photo) => photo.id !== id));
    initializePreviewFromCover();
    setError('');
  }

  async function reconcile(input: SubmitPetInput): Promise<void> {
    setSubmissionPhase('reconciling');
    setError('');
    try {
      const status = await fetchSubmissionStatus(input.submissionId);
      if (status.found) {
        onSubmitted(status.result);
        return;
      }
    } catch { /* The outcome remains unknown until the same id can be checked again. */ }
    setSubmissionPhase('uncertain');
    setError(UNKNOWN_SUBMISSION_MESSAGE);
  }

  async function attemptSubmission(input: SubmitPetInput, unlockOnDefiniteError: boolean): Promise<void> {
    setSubmissionPhase('submitting');
    setError('');
    try {
      const result = await submitPet(input);
      onSubmitted(result);
    } catch (caught) {
      if (isUnknownPetApiOutcome(caught)) {
        await reconcile(input);
        return;
      }
      if (!unlockOnDefiniteError) {
        setSubmissionPhase('uncertain');
        setError(UNKNOWN_SUBMISSION_MESSAGE);
        return;
      }
      frozenSubmission.current = undefined;
      setSubmissionPhase('editing');
      setError(caught instanceof Error ? caught.message : '등록하지 못했어요.');
    }
  }

  async function submit() {
    if (!allPhotosReady || pickingRef.current || processingRef.current || !traits || !style || !consented || submissionPhase !== 'editing' || frozenSubmission.current) return;
    const nameError = getPetNameError(name);
    if (nameError) { setNameTouched(true); setError(nameError); return; }
    if (accessorySelectionMode === 'owner' && !requestedAccessory) {
      setError('소품을 고르거나 검수자에게 맡겨주세요.');
      return;
    }
    const input = frozenSubmission.current ?? {
      submissionId: submissionId.current,
      dataUris: photosRef.current.map((photo) => photo.dataUri!),
      name: preparePetName(name),
      traits: { ...traits },
      style: { ...style },
      accessorySelectionMode,
      requestedAccessory: accessorySelectionMode === 'owner' ? requestedAccessory : undefined,
    };
    frozenSubmission.current = input;
    await attemptSubmission(input, true);
  }

  async function recoverSubmission() {
    const input = frozenSubmission.current;
    if (!input || submissionPhase !== 'uncertain') return;
    setSubmissionPhase('reconciling');
    setError('');
    try {
      const status = await fetchSubmissionStatus(input.submissionId);
      if (status.found) {
        onSubmitted(status.result);
        return;
      }
    } catch {
      setSubmissionPhase('uncertain');
      setError(UNKNOWN_SUBMISSION_MESSAGE);
      return;
    }
    await attemptSubmission(input, false);
  }

  const update = <K extends keyof PetTraitsV1>(key: K, value: PetTraitsV1[K]) => {
    if (submissionLocked || frozenSubmission.current) return;
    setTraits((current) => current ? normalizePetTraitColors({ ...current, [key]: value }) : current);
  };

  const updateCoatMode = (coatMode: CoatMode) => {
    if (!traits || !style || submissionLocked || frozenSubmission.current || coatMode === style.coatMode) return;
    if (coatMode === 'solid') {
      lastPointSelection.current = {
        secondaryColor: traits.secondaryColor,
        markingPattern: traits.markingPattern,
      };
    }
    setTraits(applyCoatMode(traits, coatMode, lastPointSelection.current));
    setStyle({ ...style, coatMode });
  };

  const updateBaseColor = (baseColor: CoatColor) => {
    if (!traits || !style || submissionLocked || frozenSubmission.current) return;
    if (style.coatMode === 'solid') {
      setTraits({ ...traits, baseColor, secondaryColor: baseColor, markingPattern: 'none' });
      return;
    }
    const secondaryColor = traits.secondaryColor === baseColor
      ? getSoftPointColor(baseColor)
      : traits.secondaryColor;
    lastPointSelection.current = { ...lastPointSelection.current, secondaryColor };
    setTraits({ ...traits, baseColor, secondaryColor });
  };

  const updatePointColor = (secondaryColor: CoatColor) => {
    if (!traits || !style || style.coatMode !== 'point' || secondaryColor === traits.baseColor || submissionLocked || frozenSubmission.current) return;
    lastPointSelection.current = { ...lastPointSelection.current, secondaryColor };
    setTraits({ ...traits, secondaryColor });
  };

  const updateMarking = (markingPattern: MarkingPattern) => {
    if (!traits || !style || style.coatMode !== 'point' || submissionLocked || frozenSubmission.current) return;
    lastPointSelection.current = { ...lastPointSelection.current, markingPattern };
    setTraits({ ...traits, markingPattern });
  };

  return (
    <main className="upload-screen">
      <Top
        className="upload-top"
        upperGap={16}
        lowerGap={10}
        title={<Top.TitleParagraph size={28}>우리 집 강아지를<br />소개해 주세요</Top.TitleParagraph>}
        subtitleBottom={<Top.SubtitleParagraph>사진 1~5장으로 소개해요. 닮은 캐릭터가 집에 바로 놀러 와요.</Top.SubtitleParagraph>}
      />
      <section className="upload-card">
        <div className="upload-step-heading">
          <span aria-hidden="true">1</span>
          <div><strong>{photos.length ? '고른 사진을 확인해 주세요' : '사진을 골라주세요'}</strong><small>한 강아지의 사진을 최대 5장까지 올릴 수 있어요.</small></div>
        </div>
        {coverPhoto ? (
          <section className="upload-photo-gallery" aria-label="고른 강아지 사진">
            <div className="photo-picker has-photo upload-cover-photo">
              {activePreviewPhoto?.dataUri ? <img src={activePreviewPhoto.dataUri} alt={activePreviewIndex === 0 ? '대표 강아지 사진' : `${activePreviewIndex + 1}번 강아지 사진 미리보기`} /> : (
                <div className="upload-photo-placeholder"><span aria-hidden="true">🐾</span><strong>{activePreviewPhoto?.status === 'error' ? `${activePreviewLabel}을 다시 준비해 주세요` : `${activePreviewLabel}을 준비하고 있어요`}</strong></div>
              )}
              <span className="photo-change-badge">{activePreviewLabel}</span>
            </div>
            <div className="upload-photo-count"><strong>사진 {photos.length}/5</strong><span>첫 사진이 대표 사진이에요</span></div>
            <ol className="upload-photo-list" aria-label="사진 목록">
              {photos.map((photo, index) => (
                <li key={photo.id} className={`upload-photo-item is-${photo.status}`}>
                  <button
                    type="button"
                    className="upload-photo-thumb"
                    aria-label={`${index + 1}번 사진 크게 보기`}
                    aria-pressed={photo.id === activePreviewPhoto?.id}
                    onClick={() => setActivePreviewPhotoId(photo.id)}
                  >
                    {photo.dataUri ? <img src={photo.dataUri} alt={`${index + 1}번 강아지 사진`} /> : <span className="upload-photo-thumb-placeholder" aria-hidden="true">🐾</span>}
                    <span className="upload-photo-order">{index === 0 ? '대표' : `${index + 1}`}</span>
                  </button>
                  <small className="upload-photo-status">{photo.status === 'ready' ? '준비 완료' : photo.status === 'error' ? '다시 확인' : photo.status === 'processing' ? '준비 중…' : '대기 중'}</small>
                  <button
                    type="button"
                    className="upload-photo-remove"
                    aria-label={`${index + 1}번 사진 삭제`}
                    disabled={submissionLocked}
                    onClick={() => removePhoto(photo.id)}
                  >삭제</button>
                  {photo.status === 'error' && <button
                    type="button"
                    className="upload-photo-retry"
                    aria-label={`${index + 1}번 사진 다시 시도하기`}
                    disabled={analyzing || picking || submissionLocked}
                    onClick={() => void retryAnalysis(photo.id)}
                  >재시도</button>}
                </li>
              ))}
            </ol>
            <button
              type="button"
              className="upload-photo-add"
              disabled={photos.length >= MAX_UPLOAD_PHOTOS || analyzing || picking || submissionLocked}
              onClick={() => void choose()}
            ><span aria-hidden="true">＋</span>{useBrowserPhotoPicker ? '기기에서 사진 추가하기' : '사진 추가하기'}</button>
            <p className="upload-photo-help">{photos.length >= MAX_UPLOAD_PHOTOS ? '5장을 모두 골랐어요. 바꾸려면 사진을 먼저 삭제해 주세요.' : '사진을 추가해도 이름과 꾸민 모습은 그대로예요.'}</p>
            {photos.map((photo, index) => photo.status === 'error' && (
              <p className="error-message upload-photo-error" role="alert" key={photo.id}>{index + 1}번 사진: {photo.error} 재시도하거나 삭제해 주세요.</p>
            ))}
          </section>
        ) : (
          <button type="button" className="photo-picker" onClick={() => void choose()} disabled={picking || analyzing || submissionLocked}>
            <span className="photo-picker-icon"><Asset.Image src="https://static.toss.im/2d-emojis/png/4x/u1F4F7.png" frameShape={{ width: 64, height: 64 }} alt="카메라" /></span>
            <strong>{useBrowserPhotoPicker ? '기기에서 사진 고르기' : '강아지 사진 고르기'}</strong>
            <small>{useBrowserPhotoPicker ? '한 번 더 누르면 선택창이 열려요' : 'JPG, PNG, WEBP · 1~5장'}</small>
          </button>
        )}
        <p className="upload-review-promise">운영자가 귀여움을 꼼꼼히 확인한 뒤, 친구들에게 한 장씩 보여드려요 🐾</p>
        {!photos.length && (
          <div className="upload-flow-guide" aria-label="강아지 소개 과정">
            <strong className="upload-flow-guide-title">등록하면 이렇게 돼요</strong>
            <div><span aria-hidden="true">✓</span><p><strong>내 집에 바로 나타나요</strong><small>검수 중에도 캐릭터와 먼저 놀 수 있어요.</small></p></div>
            <div><span aria-hidden="true">✓</span><p><strong>친구에게 먼저 보여줄 수 있어요</strong><small>승인 전 공유 링크에는 캐릭터만 보여요.</small></p></div>
            <div><span aria-hidden="true">✓</span><p><strong>승인되면 모두가 만나요</strong><small>그때부터 실제 사진도 안전하게 공개돼요.</small></p></div>
          </div>
        )}
        {analyzing && (
          <div className="upload-analysis-progress" role="status" aria-live="polite" aria-busy="true">
            <span className="upload-analysis-progress-dot" aria-hidden="true" />
            <div><strong>사진을 살펴보고 있어요</strong><small>사진을 한 장씩 줄이고, 위치 등 촬영 정보를 지워요.</small></div>
          </div>
        )}
        {traits && style && <div className="trait-editor">
          <div className="upload-step-heading"><span aria-hidden="true">2</span><div><strong>이름과 기본 모습을 확인해요</strong><small>필요하면 더 닮게 꾸미기를 펼쳐 바꿀 수 있어요.</small></div></div>
          <UploadPetPreview
            traits={traits}
            style={style}
            name={name}
            accessory={accessorySelectionMode === 'owner' ? requestedAccessory : undefined}
          />
          {analysisNotice && <p className="input-help" role="status">{analysisNotice}</p>}
          <label>
            강아지 이름 <small>필수 · {petNameLength(name)}/4</small>
            <input
              value={name}
              required
              aria-label="강아지 이름"
              disabled={submissionLocked}
              onChange={(e) => { setName(limitPetName(e.target.value)); setError(''); }}
              onBlur={() => setNameTouched(true)}
              placeholder="예: 보리"
              aria-describedby="pet-name-help"
              aria-invalid={Boolean(currentNameError)}
            />
            <span className={`input-help${currentNameError ? ' input-help--error' : ''}`} id="pet-name-help" role={currentNameError ? 'alert' : undefined}>
              {currentNameError ?? '이름을 꼭 입력해 주세요. 한글, 영문, 숫자로 1~4자까지 가능해요.'}
            </span>
          </label>
          <EarShapePicker traits={traits} value={traits.earShape} disabled={submissionLocked} onChange={(earShape) => update('earShape', earShape)} />
          <CoatModePicker value={style.coatMode} disabled={submissionLocked} onChange={updateCoatMode} />
          <CoatColorPickers
            traits={traits}
            disabled={submissionLocked}
            showPoint={false}
            onBaseColorChange={updateBaseColor}
            onPointColorChange={updatePointColor}
          />
          {style.coatMode === 'solid' && <p className="trait-choice-help upload-solid-help">귀와 입 주변에 같은 색 계열의 음영을 살짝만 더해요.</p>}

          <section className={`upload-customization ${customizationOpen ? 'is-open' : ''}`} aria-label="더 닮게 꾸미기">
            <button
              type="button"
              className="upload-customization-toggle"
              aria-expanded={customizationOpen}
              aria-controls="upload-customization-options"
              disabled={submissionLocked}
              onClick={() => setCustomizationOpen((open) => !open)}
            >
              <span><strong>더 닮게 꾸미기</strong><small>털 윤곽, 얼굴 무늬와 소품은 선택이에요</small></span>
              <span aria-hidden="true">{customizationOpen ? '⌃' : '⌄'}</span>
            </button>
            {customizationOpen && <div className="upload-customization-options" id="upload-customization-options">
              <FurStylePicker traits={traits} style={style} disabled={submissionLocked} onChange={(furStyle) => setStyle((current) => current ? { ...current, furStyle } : current)} />
              {style.coatMode === 'point' && (
            <>
              <CoatColorPickers
                traits={traits}
                disabled={submissionLocked}
                showBase={false}
                onBaseColorChange={updateBaseColor}
                onPointColorChange={updatePointColor}
              />
              <FaceMarkingPicker traits={traits} disabled={submissionLocked} onChange={updateMarking} />
            </>
              )}
              {style.coatMode === 'solid' && (
              <p className="trait-choice-help coat-color-help">귀와 입 주변에는 같은 색 계열의 아주 옅은 음영만 더해 입체감을 살려요.</p>
              )}
              <PetAccessoryPicker
            traits={traits}
            mode={accessorySelectionMode}
            accessory={requestedAccessory}
            disabled={submissionLocked}
            onChange={(mode, accessory) => {
              if (submissionLocked || frozenSubmission.current) return;
              setAccessorySelectionMode(mode);
              setRequestedAccessory(mode === 'owner' ? accessory : undefined);
              setError('');
            }}
              />
            </div>}
          </section>
          <div className="upload-step-heading upload-submit-heading"><span aria-hidden="true">3</span><div><strong>소개를 마무리해요</strong><small>승인 전에는 다른 사람에게 실제 사진이 보이지 않아요.</small></div></div>
          <label className="consent"><input type="checkbox" checked={consented} disabled={submissionLocked} onChange={(e) => setConsented(e.target.checked)} /><span>고른 모든 사진을 올릴 권리가 있으며, 승인 후 공개와 강아지 이름표가 포함된 사진 저장에 동의해요.</span></label>
          <Button
            className="upload-cta"
            display="full"
            size="large"
            onClick={submissionPhase === 'uncertain' ? recoverSubmission : submit}
            disabled={submissionPhase === 'uncertain' ? false : !allPhotosReady || picking || !consented || Boolean(nameValidationError) || (accessorySelectionMode === 'owner' && !requestedAccessory) || analyzing || submissionBusy}
            loading={submissionBusy}
          >
            {submissionPhase === 'uncertain' ? '등록 상태 확인하기' : '이 모습으로 소개하기'}
          </Button>
        </div>}
        {error && error !== currentNameError && <p className="error-message" role="alert">{error}</p>}
      </section>
    </main>
  );
}
