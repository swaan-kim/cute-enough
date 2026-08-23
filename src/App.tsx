import { lazy, Suspense, useEffect, useMemo, useRef, useState } from 'react';
import { Asset, Button, ConfirmDialog, Result, Toast, Top } from '@toss/tds-mobile';
import { House } from './components/House';
import { PlayScene } from './components/PlayScene';
import { RevealCard } from './components/RevealCard';
import { SoundToggle } from './components/SoundToggle';
import { fetchHouse, fetchMyPets, fetchSharedPet, reportPet, revealPet } from './lib/api';
import { grantUploadCredit, hasUploadBonus, nextUnlockMethod, readAllowance, regularRemainingCount, saveAllowance } from './lib/allowance';
import { createInitialRouteStack, getCurrentRoute, homeRouteStack, popRoute, pushRoute } from './lib/appRoutes';
import { getSharedPetId } from './lib/deepLink';
import { closeMiniApp, getInitialSharedPetId, subscribeNativeNavigation } from './lib/nativeNavigation';
import { getRewardedAdStatus, preloadRewardedAd, showRewardedAd, subscribeRewardedAdStatus, type RewardedAdStatus } from './lib/rewardedAd';
import { rewardedAdsEnabled } from './lib/runtime';
import { subscribeSafeArea } from './lib/safeArea';
import { getPetSoundVariant, playSoundEffect, readSoundEnabled, resumeSound, saveSoundEnabled, suspendSound, type SoundEffect } from './lib/sound';
import { sharePet } from './lib/toss';
import type { AppRoute, DailyAllowance, OwnedPetSummary, PetSummary, UnlockMethod } from './types';

const MyPetsScreen = lazy(() => import('./components/MyPetsScreen').then((module) => ({ default: module.MyPetsScreen })));
const SharedPetLanding = lazy(() => import('./components/SharedPetLanding').then((module) => ({ default: module.SharedPetLanding })));
const UploadFlow = lazy(() => import('./components/UploadFlow').then((module) => ({ default: module.UploadFlow })));

type PreparedVisit = {
  petId: string;
  method?: UnlockMethod;
  adSessionId?: string;
  characterOnly?: boolean;
};

const screenFallback = <main className="screen-loading" aria-live="polite">화면을 준비하고 있어요…</main>;

export default function App() {
  const initialSharedPetId = useMemo(() => getInitialSharedPetId(), []);
  const [routeStack, setRouteStackState] = useState<AppRoute[]>(() => createInitialRouteStack(initialSharedPetId));
  const routeStackRef = useRef(routeStack);
  const route = getCurrentRoute(routeStack);
  const screen = route.screen;
  const [pets, setPets] = useState<PetSummary[]>([]);
  const [selected, setSelected] = useState<PetSummary>();
  const [allowance, setAllowance] = useState<DailyAllowance>(() => readAllowance());
  const [photoUrl, setPhotoUrl] = useState<string>();
  const photoUrlRef = useRef(photoUrl);
  const [preparedVisit, setPreparedVisit] = useState<PreparedVisit>();
  const [adPromptPet, setAdPromptPet] = useState<PetSummary>();
  const adPromptPetRef = useRef<PetSummary>();
  const adCreditsRef = useRef(new Map<string, string>());
  const adAbortRef = useRef<AbortController>();
  const [adStatus, setAdStatus] = useState<RewardedAdStatus>(getRewardedAdStatus);
  const [status, setStatus] = useState('강아지들이 놀러 오는 중…');
  const [toast, setToast] = useState('');
  const [busy, setBusy] = useState(false);
  const [houseError, setHouseError] = useState(false);
  const [soundEnabled, setSoundEnabled] = useState(readSoundEnabled);
  const [sharedError, setSharedError] = useState('');
  const [uploadRewardGranted, setUploadRewardGranted] = useState(false);
  const [myPets, setMyPets] = useState<OwnedPetSummary[]>([]);
  const [myPetsLoading, setMyPetsLoading] = useState(false);
  const [myPetsError, setMyPetsError] = useState('');
  const houseLoadedRef = useRef(false);

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
      setPets(value.pets);
      if (value.allowance) {
        setAllowance(value.allowance);
        saveAllowance(value.allowance);
      }
      houseLoadedRef.current = true;
      setStatus('강아지를 끌어 옮기거나, 톡 눌러 만나보세요');
    } catch {
      setHouseError(true);
      setStatus('친구들을 불러오지 못했어요.');
    }
  }

  useEffect(() => {
    if (!initialSharedPetId) void loadHouse();
  }, [initialSharedPetId]);
  useEffect(() => { photoUrlRef.current = photoUrl; }, [photoUrl]);
  useEffect(() => { adPromptPetRef.current = adPromptPet; }, [adPromptPet]);
  useEffect(() => {
    if (!initialSharedPetId) return;
    void fetchSharedPet(initialSharedPetId)
      .then((result) => {
        setSelected(result.pet);
        if (result.allowance) {
          setAllowance(result.allowance);
          saveAllowance(result.allowance);
        }
        setSharedError('');
      })
      .catch(() => setSharedError('이 친구는 지금 만날 수 없어요.'));
  }, [initialSharedPetId]);
  useEffect(() => subscribeNativeNavigation({ onBack: navigateBack, onHome: goHome }), []);
  useEffect(() => subscribeSafeArea(), []);
  useEffect(() => {
    const unsubscribe = subscribeRewardedAdStatus(setAdStatus);
    if (rewardedAdsEnabled) void preloadRewardedAd().catch(() => undefined);
    return () => {
      unsubscribe();
      adAbortRef.current?.abort();
    };
  }, []);
  useEffect(() => {
    const handleVisibility = () => {
      if (document.hidden) void suspendSound();
      else void resumeSound(soundEnabled);
    };
    document.addEventListener('visibilitychange', handleVisibility);
    return () => document.removeEventListener('visibilitychange', handleVisibility);
  }, [soundEnabled]);

  const remaining = useMemo(
    () => regularRemainingCount(allowance, rewardedAdsEnabled),
    [allowance],
  );
  const uploadBonusAvailable = useMemo(() => hasUploadBonus(allowance), [allowance]);
  const dailyStatus = !allowance.freeUsed
    ? '첫 만남은 무료예요'
    : rewardedAdsEnabled && remaining > 0
      ? '다음 친구는 광고 후 만나요'
      : uploadBonusAvailable
        ? '내 강아지는 무료로 만날 수 있어요'
        : '오늘의 귀여움은 여기까지예요';

  function enterPlay(pet: PetSummary, visit: PreparedVisit, playGreeting = true) {
    if (playGreeting) playSound('bark', getPetSoundVariant(pet.id));
    setSelected(pet);
    setPreparedVisit(visit);
    navigateTo({ screen: 'play', petId: pet.id });
    photoUrlRef.current = undefined;
    setPhotoUrl(undefined);
  }

  function choosePet(pet: PetSummary) {
    if (pet.approvalStatus === 'pending' && !pet.ownerPinned) {
      enterPlay(pet, { petId: pet.id, characterOnly: true });
      return;
    }

    const method = nextUnlockMethod(allowance, pet.id, rewardedAdsEnabled);
    if (!method) {
      setToast('오늘의 귀여움은 여기까지예요\n내일 다시 만나요');
      return;
    }
    if (method === 'REWARDED') {
      const existingCredit = adCreditsRef.current.get(pet.id);
      if (existingCredit) {
        enterPlay(pet, { petId: pet.id, method, adSessionId: existingCredit });
        return;
      }
      playSound('bark', getPetSoundVariant(pet.id));
      setSelected(pet);
      adPromptPetRef.current = pet;
      setAdPromptPet(pet);
      if (adStatus === 'idle' || adStatus === 'error') void preloadRewardedAd().catch(() => undefined);
      return;
    }
    enterPlay(pet, { petId: pet.id, method });
  }

  function updateRouteStack(next: AppRoute[]) {
    routeStackRef.current = next;
    setRouteStackState(next);
  }

  function navigateTo(next: AppRoute) {
    updateRouteStack(pushRoute(routeStackRef.current, next));
  }

  function navigateBack() {
    if (adPromptPetRef.current) {
      adAbortRef.current?.abort();
      adPromptPetRef.current = undefined;
      setAdPromptPet(undefined);
      return;
    }
    if (photoUrlRef.current) {
      photoUrlRef.current = undefined;
      setPhotoUrl(undefined);
      return;
    }
    const current = routeStackRef.current;
    if (current.length <= 1) {
      void closeMiniApp().catch(() => undefined);
      return;
    }
    const next = popRoute(current);
    updateRouteStack(next);
    setPhotoUrl(undefined);
    setToast('');
    if (getCurrentRoute(next).screen === 'home') {
      setSelected(undefined);
      setPreparedVisit(undefined);
    }
  }

  function goHome() {
    adAbortRef.current?.abort();
    adPromptPetRef.current = undefined;
    setAdPromptPet(undefined);
    updateRouteStack(homeRouteStack());
    setSelected(undefined);
    setPreparedVisit(undefined);
    photoUrlRef.current = undefined;
    setPhotoUrl(undefined);
    setToast('');
    if (getSharedPetId()) window.history.replaceState({}, '', '/');
    if (!houseLoadedRef.current) void loadHouse();
  }

  function closeAdPrompt() {
    adAbortRef.current?.abort();
    adPromptPetRef.current = undefined;
    setAdPromptPet(undefined);
    setSelected(undefined);
  }

  async function confirmRewardedVisit() {
    const pet = adPromptPetRef.current;
    if (!pet || busy) return;
    if (adStatus !== 'loaded') {
      void preloadRewardedAd().catch(() => undefined);
      return;
    }

    setBusy(true);
    setToast('');
    const abort = new AbortController();
    adAbortRef.current = abort;
    await suspendSound();
    try {
      await showRewardedAd(abort.signal);
      const adSessionId = crypto.randomUUID();
      adCreditsRef.current.set(pet.id, adSessionId);
      adPromptPetRef.current = undefined;
      setAdPromptPet(undefined);
      enterPlay(pet, { petId: pet.id, method: 'REWARDED', adSessionId }, false);
    } catch (error) {
      if (!(error instanceof DOMException && error.name === 'AbortError')) {
        setToast(error instanceof Error ? error.message : '광고를 완료하지 못했어요.');
      }
    } finally {
      adAbortRef.current = undefined;
      await resumeSound(soundEnabled);
      setBusy(false);
    }
  }

  async function openMyPets() {
    if (getCurrentRoute(routeStackRef.current).screen !== 'mine') navigateTo({ screen: 'mine' });
    setMyPetsLoading(true);
    setMyPetsError('');
    try { setMyPets(await fetchMyPets()); }
    catch { setMyPetsError('올린 강아지를 불러오지 못했어요.'); }
    finally { setMyPetsLoading(false); }
  }

  async function handleFed() {
    if (!selected || busy) return;
    if (preparedVisit?.characterOnly) {
      setToast('이 친구의 캐릭터는 지금 만날 수 있어요\n실제 사진은 검수 후 공개돼요');
      return;
    }
    if (!preparedVisit?.method || preparedVisit.petId !== selected.id) {
      setToast('오늘의 귀여움은 여기까지예요\n내일 다시 만나요');
      return;
    }
    setBusy(true);
    try {
      const result = await revealPet(selected, preparedVisit.method, preparedVisit.adSessionId);
      setAllowance(result.allowance);
      saveAllowance(result.allowance);
      if (preparedVisit.method === 'UPLOAD') setPets((current) => current.filter((pet) => pet.id !== selected.id));
      if (preparedVisit.method === 'REWARDED') adCreditsRef.current.delete(selected.id);
      photoUrlRef.current = result.photoUrl;
      setPhotoUrl(result.photoUrl); setToast(''); playSound('reveal');
    } catch (error) { setToast(error instanceof Error ? error.message : '사진을 열지 못했어요.'); }
    finally { setBusy(false); }
  }

  const adConfirmLabel = adStatus === 'loaded'
    ? '광고 보고 이 친구 만나기'
    : adStatus === 'error' || adStatus === 'idle'
      ? '광고 다시 준비하기'
      : adStatus === 'unsupported'
        ? '현재 광고를 사용할 수 없어요'
        : '광고 준비 중';
  const adDialog = (
    <ConfirmDialog
      open={Boolean(adPromptPet)}
      title="광고 보고 이 친구 만나기"
      description="광고를 끝까지 보면 간식을 주고 실제 사진을 만날 수 있어요."
      closeOnBackEvent={false}
      onClose={closeAdPrompt}
      cancelButton={<ConfirmDialog.CancelButton onClick={closeAdPrompt}>다른 강아지 고르기</ConfirmDialog.CancelButton>}
      confirmButton={(
        <ConfirmDialog.ConfirmButton
          onClick={() => void confirmRewardedVisit()}
          loading={busy || adStatus === 'loading' || adStatus === 'showing'}
          disabled={adStatus === 'unsupported' || adStatus === 'disabled'}
        >
          {adConfirmLabel}
        </ConfirmDialog.ConfirmButton>
      )}
    />
  );

  if (screen === 'upload') return <Suspense fallback={screenFallback}><UploadFlow onSubmitted={(result) => {
    const current = readAllowance();
    const credited = result.rewardGranted && result.uploadRewardPetId
      ? grantUploadCredit(current, result.uploadRewardPetId)
      : current;
    saveAllowance(credited);
    setAllowance(credited);
    setUploadRewardGranted(result.rewardGranted);
    setPets((existing) => {
      if (!result.rewardGranted) return existing;
      const next = existing.filter((pet) => pet.id !== result.pet.id).slice(0, 4);
      next.splice(2, 0, result.pet);
      return next;
    });
    navigateTo({ screen: 'submitted' });
  }} /></Suspense>;
  if (screen === 'submitted') return (
    <main className="submitted-screen">
      <Result
        figure={<Asset.Image src="https://static.toss.im/2d-emojis/png/4x/u1F48C.png" frameShape={{ width: 96, height: 96 }} alt="마음이 담긴 편지" />}
        title="소중한 사진을 맡겨주셔서 고마워요"
        description={uploadRewardGranted
          ? <>지금 집에서 이 친구에게 간식을 주면<br />광고 없이 실제 모습을 만날 수 있어요.</>
          : <>사진은 안전 검사를 거쳐 승인되면<br />다른 사람의 집에도 놀러 가요.</>}
        button={<Result.Button onClick={goHome}>집으로 돌아가기</Result.Button>}
      />
    </main>
  );
  if (screen === 'mine') return <><Suspense fallback={screenFallback}><MyPetsScreen pets={myPets} loading={myPetsLoading} error={myPetsError} onRetry={() => void openMyPets()} onUpload={() => navigateTo({ screen: 'upload' })} onShare={(pet) => { void sharePet(pet.id, pet.name).catch((error) => setToast(error instanceof Error ? error.message : '공유하지 못했어요.')); }} /></Suspense><Toast className="app-toast" position="bottom" open={Boolean(toast)} text={toast} /></>;
  if (screen === 'shared') {
    if (sharedError) return <main className="shared-screen shared-unavailable"><Result title={sharedError} description="공개가 끝났거나 잠시 쉬고 있는 친구일 수 있어요." button={<Result.Button onClick={goHome}>다른 친구 만나기</Result.Button>} /></main>;
    if (!selected) return <main className="shared-screen shared-loading"><p>친구를 만나러 가는 중…</p></main>;
    return <><Suspense fallback={screenFallback}><SharedPetLanding pet={selected} onHome={goHome} onMeet={() => choosePet(selected)} /></Suspense>{adDialog}<Toast className="app-toast" position="bottom" open={Boolean(toast)} text={toast} /></>;
  }
  if (screen === 'play' && selected) return <><PlayScene pet={selected} onFed={handleFed} onSound={playSound} /><Toast className="app-toast" position="bottom" open={Boolean(toast)} text={toast} aria-live={busy ? 'assertive' : 'polite'} />{photoUrl && <RevealCard pet={selected} photoUrl={photoUrl} onClose={goHome} onUpload={() => { photoUrlRef.current = undefined; setPhotoUrl(undefined); navigateTo({ screen: 'upload' }); }} onShare={async () => { try { await sharePet(selected.id, selected.name); setToast('공유할 곳을 골라주세요.'); } catch (error) { setToast(error instanceof Error ? error.message : '공유하지 못했어요.'); } }} onReport={async () => { await reportPet(selected.id).catch(() => undefined); setToast('신고가 접수됐어요. 확인 후 처리할게요.'); goHome(); }} />}</>;

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
      <section className="daily-card" aria-label={`오늘 일반 친구 ${remaining}마리를 더 만날 수 있어요${uploadBonusAvailable ? ', 내 강아지 무료 1회가 있어요' : ''}`}>
        <div className="daily-card-label">
          <Asset.Icon name="heart-line" color="#ff506f" backgroundColor="#fff0f3" frameShape={Asset.frameShape.CircleLarge} aria-hidden="true" />
          <div className="daily-card-copy">
            <span><small>오늘 만날 수 있는 친구</small><strong>{dailyStatus}</strong></span>
            {uploadBonusAvailable && <span className="upload-bonus-badge">내 강아지 무료 1회</span>}
          </div>
        </div>
        <b>{remaining}<small>마리</small></b>
      </section>
      <button className="my-pets-link" type="button" onClick={() => void openMyPets()}>내가 올린 강아지</button>
      {houseError ? (
        <section className="house-error">
          <Asset.Image src="https://static.toss.im/2d-emojis/png/4x/u1F415.png" frameShape={{ width: 76, height: 76 }} alt="강아지" />
          <strong>잠시 뒤 다시 불러와 주세요</strong>
          <Button size="medium" color="dark" variant="weak" onClick={loadHouse}>다시 불러오기</Button>
        </section>
      ) : <House pets={pets} onSelect={choosePet} onSound={playSound} />}
      <p className="home-hint" aria-live="polite">{status}</p>
      {adDialog}
      <Toast className="app-toast" position="bottom" open={Boolean(toast)} text={toast} />
    </main>
  );
}
