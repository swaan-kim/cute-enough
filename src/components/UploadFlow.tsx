import { useEffect, useId, useRef, useState } from 'react';
import { Asset, Button, Top } from '@toss/tds-mobile';
import type { CoatColor, EarShape, MarkingPattern, PetTraitsV1, SubmitPetResult } from '../types';
import { submitPet } from '../lib/api';
import { normalizeAndAnalyzePetImage } from '../lib/petImage';
import { getPetNameError, limitPetName, petNameLength, preparePetName } from '../lib/petName';
import { normalizePetTraitColors } from '../lib/petTraits';
import { pickOnePhoto } from '../lib/toss';
import { COAT_COLOR_HEX } from './DogAvatar';
import { PetArtwork } from './PetArtwork';

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
  description: string;
}> = [
  { value: 'floppy', label: '포근한 귀', description: '구르미처럼' },
  { value: 'upright', label: '쫑긋 귀', description: '하늘처럼' },
];

const detailEarShapeOptions: typeof primaryEarShapeOptions = [
  { value: 'semi', label: '살짝 접힌 귀', description: '하늘형 · 끝만 살포시' },
  { value: 'rounded', label: '작고 동그란 귀', description: '구르미형 · 짧고 둥글게' },
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

type EarShapePickerProps = {
  value: EarShape;
  traits?: PetTraitsV1;
  onChange: (value: EarShape) => void;
};

export function EarShapePicker({ value, traits = fallbackPreviewTraits, onChange }: EarShapePickerProps) {
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
          aria-describedby={`${helpId} ${descriptionId}`}
          onChange={() => onChange(option.value)}
        />
        <span className="trait-artwork-preview ear-choice-preview" aria-hidden="true">
          <PetArtwork traits={{ ...traits, earShape: option.value }} size={74} />
        </span>
        <span className="trait-choice-copy">
          <strong>{option.label}</strong>
          <small id={descriptionId}>{option.description}</small>
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
  onChange: (value: MarkingPattern) => void;
};

export function FaceMarkingPicker({ traits, onChange }: FaceMarkingPickerProps) {
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
  onBaseColorChange: (value: CoatColor) => void;
  onPointColorChange: (value: CoatColor) => void;
};

function ColorSwatchGroup({
  legend,
  name,
  value,
  disabledColor,
  helpId,
  onChange,
}: {
  legend: string;
  name: string;
  value: CoatColor;
  disabledColor?: CoatColor;
  helpId?: string;
  onChange: (value: CoatColor) => void;
}) {
  return (
    <fieldset className="coat-color-fieldset">
      <legend>{legend}</legend>
      <div className="coat-color-options">
        {coatColorOptions.map((option) => {
          const disabled = option.value === disabledColor;
          return (
            <label key={option.value} className={`coat-color-option ${value === option.value ? 'is-selected' : ''} ${disabled ? 'is-disabled' : ''}`}>
              <input
                className="trait-choice-input"
                type="radio"
                name={name}
                value={option.value}
                checked={value === option.value}
                disabled={disabled}
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

export function CoatColorPickers({ traits, onBaseColorChange, onPointColorChange }: CoatColorPickersProps) {
  const pickerId = useId().replace(/:/g, '');
  const pointHelpId = `${pickerId}-point-help`;
  const hasMarking = traits.markingPattern !== 'none';
  return (
    <section className="coat-color-editor" aria-label="털색">
      <ColorSwatchGroup
        legend="기본 털색"
        name={`${pickerId}-base-color`}
        value={traits.baseColor}
        onChange={onBaseColorChange}
      />
      <ColorSwatchGroup
        legend="포인트 털색"
        name={`${pickerId}-point-color`}
        value={traits.secondaryColor}
        disabledColor={hasMarking ? traits.baseColor : undefined}
        helpId={pointHelpId}
        onChange={onPointColorChange}
      />
      <p className="trait-choice-help coat-color-help" id={pointHelpId}>귀, 입 주변, 눈썹과 얼굴 무늬에 적용돼요.{hasMarking && ' 얼굴 무늬가 있을 때는 기본 털색과 다른 색을 골라주세요.'}</p>
    </section>
  );
}

export function UploadFlow({ onSubmitted }: { onSubmitted: (result: SubmitPetResult) => void }) {
  const [dataUri, setDataUri] = useState<string>();
  const [traits, setTraits] = useState<PetTraitsV1>();
  const [analysisNotice, setAnalysisNotice] = useState('');
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [consented, setConsented] = useState(false);
  const [error, setError] = useState('');
  const submissionId = useRef(crypto.randomUUID());

  async function choose() {
    setError('');
    try {
      const selected = await pickOnePhoto();
      if (!selected) return;
      setDataUri(selected.startsWith('data:') ? selected : `data:image/jpeg;base64,${selected}`);
      setTraits(undefined);
      setAnalysisNotice('');
      submissionId.current = crypto.randomUUID();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '사진을 불러오지 못했어요.');
    }
  }

  async function analyze() {
    if (!dataUri) return;
    setBusy(true); setError('');
    try {
      const result = await normalizeAndAnalyzePetImage(dataUri);
      setDataUri(result.dataUri);
      setTraits(normalizePetTraitColors(result.traits));
      setAnalysisNotice(result.notice
        ? `${result.notice} 강아지 사진인지와 실제 공개 여부는 검수에서 확인해요.`
        : '사진의 털색을 참고해 모습을 만들었어요. 강아지 사진인지와 실제 공개 여부는 검수에서 확인해요.');
    } catch (e) { setError(e instanceof Error ? e.message : '사진을 분석하지 못했어요.'); }
    finally { setBusy(false); }
  }

  async function submit() {
    if (!dataUri || !traits || !consented) return;
    const nameError = getPetNameError(name);
    if (nameError) { setError(nameError); return; }
    setBusy(true); setError('');
    try { const result = await submitPet({ submissionId: submissionId.current, dataUri, name: preparePetName(name) || undefined, traits }); onSubmitted(result); }
    catch (e) { setError(e instanceof Error ? e.message : '등록하지 못했어요.'); }
    finally { setBusy(false); }
  }

  const update = <K extends keyof PetTraitsV1>(key: K, value: PetTraitsV1[K]) => setTraits((current) => current ? normalizePetTraitColors({ ...current, [key]: value }) : current);

  return (
    <main className="upload-screen">
      <Top
        className="upload-top"
        upperGap={16}
        lowerGap={10}
        title={<Top.TitleParagraph size={28}>우리 집 강아지를<br />소개해 주세요</Top.TitleParagraph>}
        subtitleBottom={<Top.SubtitleParagraph>사진 한 장이면 닮은 캐릭터가 집에 바로 놀러 와요.</Top.SubtitleParagraph>}
      />
      <section className="upload-card">
        {!dataUri && (
          <div className="upload-step-heading">
            <span aria-hidden="true">1</span>
            <div><strong>사진을 골라주세요</strong><small>얼굴과 귀가 잘 보이는 사진이 좋아요.</small></div>
          </div>
        )}
        <button type="button" className={`photo-picker ${dataUri ? 'has-photo' : ''}`} onClick={choose}>
          {dataUri ? <><img src={dataUri} alt="선택한 강아지" /><span className="photo-change-badge">사진 바꾸기</span></> : <><span className="photo-picker-icon"><Asset.Image src="https://static.toss.im/2d-emojis/png/4x/u1F4F7.png" frameShape={{ width: 64, height: 64 }} alt="카메라" /></span><strong>사진 한 장 고르기</strong><small>JPG, PNG, WEBP · 최대 1장</small></>}
        </button>
        {!dataUri && (
          <div className="upload-flow-guide" aria-label="강아지 소개 과정">
            <div><span aria-hidden="true">1</span><p><strong>내 집에 바로 나타나요</strong><small>검수 중에도 캐릭터와 먼저 놀 수 있어요.</small></p></div>
            <div><span aria-hidden="true">2</span><p><strong>친구에게 먼저 보여줄 수 있어요</strong><small>승인 전 공유 링크에는 캐릭터만 보여요.</small></p></div>
            <div><span aria-hidden="true">3</span><p><strong>승인되면 모두가 만나요</strong><small>그때부터 실제 사진도 안전하게 공개돼요.</small></p></div>
          </div>
        )}
        {dataUri && !traits && <><div className="upload-step-heading upload-step-heading--after-photo"><span aria-hidden="true">2</span><div><strong>사진을 확인해 주세요</strong><small>캐릭터는 기기에서 무료로 만들어요.</small></div></div><Button className="upload-cta" display="full" size="large" onClick={analyze} disabled={busy} loading={busy}>캐릭터 만들어보기</Button></>}
        {traits && <div className="trait-editor">
          <div className="upload-step-heading"><span aria-hidden="true">2</span><div><strong>캐릭터를 확인해 주세요</strong><small>조금 다르면 아래에서 직접 바꿀 수 있어요.</small></div></div>
          <div className="preview-panel"><PetArtwork traits={traits} size={190} /><span><strong>이 모습으로<br />집에 놀러 와요</strong><small>사진의 대표 털색을 참고했어요</small></span></div>
          {analysisNotice && <p className="input-help" role="status">{analysisNotice}</p>}
          <label>강아지 이름 <small>선택 · {petNameLength(name)}/4</small><input value={name} onChange={(e) => setName(limitPetName(e.target.value))} placeholder="예: 보리" aria-describedby="pet-name-help" /><span className="input-help" id="pet-name-help">네 글자까지 입력할 수 있어요.</span></label>
          <EarShapePicker traits={traits} value={traits.earShape} onChange={(earShape) => update('earShape', earShape)} />
          <FaceMarkingPicker traits={traits} onChange={(markingPattern) => update('markingPattern', markingPattern)} />
          <CoatColorPickers
            traits={traits}
            onBaseColorChange={(baseColor) => update('baseColor', baseColor)}
            onPointColorChange={(secondaryColor) => update('secondaryColor', secondaryColor)}
          />
          <div className="upload-step-heading upload-submit-heading"><span aria-hidden="true">3</span><div><strong>소개를 마무리해요</strong><small>승인 전에는 다른 사람에게 실제 사진이 보이지 않아요.</small></div></div>
          <label className="consent"><input type="checkbox" checked={consented} onChange={(e) => setConsented(e.target.checked)} /><span>이 사진을 올릴 권리가 있으며, 승인 후 공개와 찰딱 로고가 포함된 사진 저장에 동의해요.</span></label>
          <Button className="upload-cta" display="full" size="large" onClick={submit} disabled={!consented || busy} loading={busy}>이 모습으로 소개하기</Button>
        </div>}
        {error && <p className="error-message" role="alert">{error}</p>}
      </section>
    </main>
  );
}
