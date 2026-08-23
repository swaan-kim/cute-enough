import { useEffect, useMemo, useState } from 'react';
import { Asset, Button, Result, Toast, Top } from '@toss/tds-mobile';
import { House } from './components/House';
import { PlayScene } from './components/PlayScene';
import { RevealCard } from './components/RevealCard';
import { SoundToggle } from './components/SoundToggle';
import { UploadFlow } from './components/UploadFlow';
import { fetchHouse, reportPet, revealPet } from './lib/api';
import { grantUploadCredit, nextUnlockMethod, readAllowance, remainingCount, saveAllowance } from './lib/allowance';
import { preloadRewardedAd, showRewardedAd } from './lib/toss';
import { playSoundEffect, readSoundEnabled, saveSoundEnabled, type SoundEffect } from './lib/sound';
import type { AppScreen, DailyAllowance, PetSummary } from './types';

export default function App() {
  const [screen, setScreen] = useState<AppScreen>('home');
  const [pets, setPets] = useState<PetSummary[]>([]);
  const [selected, setSelected] = useState<PetSummary>();
  const [allowance, setAllowance] = useState<DailyAllowance>(() => readAllowance());
  const [photoUrl, setPhotoUrl] = useState<string>();
  const [status, setStatus] = useState('강아지들이 놀러 오는 중…');
  const [toast, setToast] = useState('');
  const [busy, setBusy] = useState(false);
  const [houseError, setHouseError] = useState(false);
  const [soundEnabled, setSoundEnabled] = useState(readSoundEnabled);

  function playSound(effect: SoundEffect, variant = 0) {
    playSoundEffect(effect, soundEnabled, variant);
  }

  function toggleSound() {
    setSoundEnabled((enabled) => {
      const next = !enabled;
      saveSoundEnabled(next);
      if (next) playSoundEffect('toggle', true);
      return next;
    });
  }

  async function loadHouse() {
    setHouseError(false);
    setStatus('강아지들이 놀러 오는 중…');
    try {
      const value = await fetchHouse();
      setPets(value);
      setStatus('강아지를 끌어 옮기거나, 톡 눌러 만나보세요');
    } catch {
      setHouseError(true);
      setStatus('친구들을 불러오지 못했어요.');
    }
  }

  useEffect(() => { void loadHouse(); }, []);
  const remaining = useMemo(() => remainingCount(allowance), [allowance]);
  const dailyStatus = !allowance.freeUsed
    ? '첫 만남은 무료예요'
    : remaining > 0
      ? '다음 친구는 광고 후 만나요'
      : '오늘의 만남을 모두 봤어요';

  function choosePet(pet: PetSummary) {
    playSound('bark');
    setSelected(pet);
    setScreen('play');
    setPhotoUrl(undefined);
    void preloadRewardedAd().catch(() => undefined);
  }

  async function handleFed() {
    if (!selected || busy) return;
    const method = nextUnlockMethod(allowance);
    if (!method) { setToast('오늘은 네 친구를 모두 만났어요. 내일 다시 만나요!'); return; }
    setBusy(true);
    try {
      let sessionId: string | undefined;
      if (method === 'REWARDED') { setToast('사진을 만나려면 짧은 광고를 봐주세요'); await showRewardedAd(); sessionId = crypto.randomUUID(); }
      const result = await revealPet(selected, method, sessionId);
      setAllowance(result.allowance); setPhotoUrl(result.photoUrl); setToast(''); playSound('reveal');
    } catch (error) { setToast(error instanceof Error ? error.message : '사진을 열지 못했어요.'); }
    finally { setBusy(false); }
  }

  if (screen === 'upload') return <UploadFlow onBack={() => setScreen('home')} onSubmitted={() => {
    const credited = grantUploadCredit(readAllowance());
    saveAllowance(credited);
    setAllowance(credited);
    setScreen('submitted');
  }} />;
  if (screen === 'submitted') return (
    <main className="submitted-screen">
      <Result
        figure={<Asset.Image src="https://static.toss.im/2d-emojis/png/4x/u1F48C.png" frameShape={{ width: 96, height: 96 }} alt="마음이 담긴 편지" />}
        title="소중한 사진을 맡겨주셔서 고마워요"
        description={<>오늘 한 친구를 광고 없이 더 만날 수 있어요.<br />사진은 안전 검사를 거쳐 승인되면 집에 등장해요.</>}
        button={<Result.Button onClick={() => setScreen('home')}>집으로 돌아가기</Result.Button>}
      />
    </main>
  );
  if (screen === 'play' && selected) return <><PlayScene pet={selected} onFed={handleFed} onBack={() => setScreen('home')} onSound={playSound} /><Toast position="bottom" open={Boolean(toast)} text={toast} aria-live={busy ? 'assertive' : 'polite'} />{photoUrl && <RevealCard pet={selected} photoUrl={photoUrl} onClose={() => { setPhotoUrl(undefined); setScreen('home'); }} onUpload={() => { setPhotoUrl(undefined); setScreen('upload'); }} onReport={async () => { await reportPet(selected.id).catch(() => undefined); setToast('신고가 접수됐어요. 확인 후 처리할게요.'); setPhotoUrl(undefined); setScreen('home'); }} />}</>;

  return (
    <main className="home-screen">
      <section className="home-heading">
        <Top
          className="home-top"
          upperGap={16}
          lowerGap={10}
          title={<Top.TitleParagraph size={28}>귀엽기만 해도<br />되나요?</Top.TitleParagraph>}
          subtitleBottom={<Top.SubtitleParagraph>오늘의 조그만 행복을 만나보세요</Top.SubtitleParagraph>}
        />
        <div className="home-sound-control"><SoundToggle enabled={soundEnabled} onToggle={toggleSound} /></div>
      </section>
      <section className="daily-card" aria-label={`오늘 ${remaining}마리 더 만날 수 있어요`}>
        <div className="daily-card-label">
          <Asset.Icon name="heart-line" color="#ff506f" backgroundColor="#fff0f3" frameShape={Asset.frameShape.CircleLarge} aria-hidden="true" />
          <span><small>오늘 만날 수 있는 친구</small><strong>{dailyStatus}</strong></span>
        </div>
        <b>{remaining}<small>마리</small></b>
      </section>
      <p className="home-hint" aria-live="polite">{status}</p>
      {houseError ? (
        <section className="house-error">
          <Asset.Image src="https://static.toss.im/2d-emojis/png/4x/u1F415.png" frameShape={{ width: 76, height: 76 }} alt="강아지" />
          <strong>잠시 뒤 다시 불러와 주세요</strong>
          <Button size="medium" color="dark" variant="weak" onClick={loadHouse}>다시 불러오기</Button>
        </section>
      ) : <House pets={pets} onSelect={choosePet} onSound={playSound} />}
      <Toast position="bottom" open={Boolean(toast)} text={toast} />
    </main>
  );
}
