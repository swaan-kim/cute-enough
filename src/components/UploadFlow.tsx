import { useState } from 'react';
import { Asset, Button, Top, TopNavigation, TopNavigationBackButton } from '@toss/tds-mobile';
import type { CoatColor, EarShape, MarkingPattern, PetTraitsV1 } from '../types';
import { analyzePet, submitPet } from '../lib/api';
import { pickOnePhoto } from '../lib/toss';
import { PetArtwork } from './PetArtwork';

export function UploadFlow({ onBack, onSubmitted }: { onBack: () => void; onSubmitted: () => void }) {
  const [dataUri, setDataUri] = useState<string>();
  const [traits, setTraits] = useState<PetTraitsV1>();
  const [analysisToken, setAnalysisToken] = useState('');
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [consented, setConsented] = useState(false);
  const [error, setError] = useState('');

  async function choose() {
    setError('');
    const selected = await pickOnePhoto();
    if (!selected) return;
    setDataUri(selected.startsWith('data:') ? selected : `data:image/jpeg;base64,${selected}`);
    setTraits(undefined); setAnalysisToken('');
  }

  async function analyze() {
    if (!dataUri) return;
    setBusy(true); setError('');
    try { const result = await analyzePet(dataUri); setTraits(result.traits); setAnalysisToken(result.analysisToken); } catch (e) { setError(e instanceof Error ? e.message : '사진을 분석하지 못했어요.'); }
    finally { setBusy(false); }
  }

  async function submit() {
    if (!dataUri || !traits || !consented) return;
    setBusy(true); setError('');
    try { await submitPet({ dataUri, name: name.trim() || undefined, traits, analysisToken }); onSubmitted(); }
    catch (e) { setError(e instanceof Error ? e.message : '등록하지 못했어요.'); }
    finally { setBusy(false); }
  }

  const update = <K extends keyof PetTraitsV1>(key: K, value: PetTraitsV1[K]) => setTraits((current) => current ? { ...current, [key]: value } : current);

  return (
    <main className="upload-screen">
      <TopNavigation leading={<TopNavigationBackButton onClick={onBack} aria-label="돌아가기" />} content="사진 올리기" withSafeAreaTop={false} />
      <Top
        className="upload-top"
        upperGap={16}
        lowerGap={10}
        title={<Top.TitleParagraph size={28}>우리 집 강아지의<br />귀여움을 나눠주세요</Top.TitleParagraph>}
        subtitleBottom={<Top.SubtitleParagraph>사진은 승인된 뒤에만 다른 사람에게 보여요.</Top.SubtitleParagraph>}
      />
      <section className="upload-card">
        <button className={`photo-picker ${dataUri ? 'has-photo' : ''}`} onClick={choose}>
          {dataUri ? <img src={dataUri} alt="선택한 강아지" /> : <><Asset.Image src="https://static.toss.im/2d-emojis/png/4x/u1F4F7.png" frameShape={{ width: 72, height: 72 }} alt="카메라" /><strong>사진 한 장 선택하기</strong><small>JPG, PNG, WEBP</small></>}
        </button>
        {dataUri && !traits && <Button className="upload-cta" display="full" size="large" onClick={analyze} disabled={busy} loading={busy}>이 사진으로 캐릭터 만들기</Button>}
        {traits && <div className="trait-editor">
          <div className="preview-panel"><PetArtwork traits={traits} size={190} /><span><strong>이런 모습으로<br />집에 놀러 와요</strong><small>특징이 다르면 아래에서 바꿔주세요</small></span></div>
          <label>강아지 이름 <small>선택</small><input value={name} maxLength={12} onChange={(e) => setName(e.target.value)} placeholder="예: 보리" /></label>
          <div className="select-grid">
            <label>귀 모양<select value={traits.earShape} onChange={(e) => update('earShape', e.target.value as EarShape)}><option value="floppy">접힌 귀</option><option value="upright">쫑긋 귀</option><option value="semi">반쯤 쫑긋</option></select></label>
            <label>주 털색<select value={traits.baseColor} onChange={(e) => update('baseColor', e.target.value as CoatColor)}><option value="cream">크림</option><option value="caramel">갈색</option><option value="chocolate">초콜릿</option><option value="black">검정</option><option value="gray">회색</option><option value="white">흰색</option></select></label>
            <label>얼굴 무늬<select value={traits.markingPattern} onChange={(e) => update('markingPattern', e.target.value as MarkingPattern)}><option value="none">없음</option><option value="brow">눈썹</option><option value="mask">마스크</option><option value="blaze">이마 선</option><option value="spots">점박이</option></select></label>
          </div>
          <label className="consent"><input type="checkbox" checked={consented} onChange={(e) => setConsented(e.target.checked)} /><span>사진을 올릴 권리가 있으며, 공개 노출과 특징 기반 일러스트 생성을 동의해요.</span></label>
          <Button className="upload-cta" display="full" size="large" onClick={submit} disabled={!consented || busy} loading={busy}>검수 요청하기</Button>
        </div>}
        {error && <p className="error-message" role="alert">{error}</p>}
      </section>
    </main>
  );
}
