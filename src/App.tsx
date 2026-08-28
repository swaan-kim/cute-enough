import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Asset, Button, ConfirmDialog, Result, Top } from '@toss/tds-mobile';
import { AppToast, DAILY_LIMIT_TOAST } from './components/AppToast';
import { House } from './components/House';
import { PetArtwork } from './components/PetArtwork';
import { PlayScene } from './components/PlayScene';
import { RevealCard } from './components/RevealCard';
import { SoundToggle } from './components/SoundToggle';
import { fetchHouse, fetchMyPets, fetchSharedPet, reopenPet, reportPet, revealPet } from './lib/api';
import { getKstDate, grantUploadCredit, hasUploadBonus, isAllowanceForToday, MAX_REWARDED_PER_DAY, millisecondsUntilNextFreeRecharge, millisecondsUntilNextKstDay, readAllowance, refreshAllowance, regularRemainingCount, resetStoredAllowance, saveAllowance } from './lib/allowance';
import { createInitialRouteStack, getCurrentRoute, homeRouteStack, popRoute, pushRoute } from './lib/appRoutes';
import { getSharedPetId } from './lib/deepLink';
import { HOUSE_PET_LIMIT, prioritizeRevealedPets } from './lib/housePets';
import { closeMiniApp, getInitialSharedPetId, subscribeNativeNavigation } from './lib/nativeNavigation';
import { isPetRevisitActive, resolvePetAccess, type PetAccessDecision } from './lib/petAccess';
import { saveBrandedPetPhoto } from './lib/photoSave';
import { getRewardedAdStatus, preloadRewardedAd, showRewardedAd, subscribeRewardedAdStatus, type RewardedAdStatus } from './lib/rewardedAd';
import { isPreviewRuntime, rewardedAdsEnabled } from './lib/runtime';
import { subscribeSafeArea } from './lib/safeArea';
import { getPetSoundVariant, playSoundEffect, readSoundEnabled, resumeSound, saveSoundEnabled, suspendSound, type SoundEffect } from './lib/sound';
import { sharePet } from './lib/toss';
import { resetPreviewReveals } from './lib/previewPetStore';
import type { AppRoute, DailyAllowance, OwnedPetSummary, PetSummary, UnlockMethod } from './types';

const MyPetsScreen = lazy(() => import('./components/MyPetsScreen').then((module) => ({ default: module.MyPetsScreen })));
const SharedPetLanding = lazy(() => import('./components/SharedPetLanding').then((module) => ({ default: module.SharedPetLanding })));
const UploadFlow = lazy(() => import('./components/UploadFlow').then((module) => ({ default: module.UploadFlow })));

type PreparedVisit = {
  petId: string;
  method?: UnlockMethod;
  adSessionId?: string;
  revisit?: boolean;
  characterOnlyReason?: Extract<PetAccessDecision, { kind: 'characterOnly' }>['reason'];
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
  const allowanceRef = useRef(allowance);
  const [photoUrl, setPhotoUrl] = useState<string>();
  const photoUrlRef = useRef(photoUrl);
  const [preparedVisit, setPreparedVisit] = useState<PreparedVisit>();
  const [adPromptPet, setAdPromptPet] = useState<PetSummary>();
  const adPromptPetRef = useRef<PetSummary>();
  const adCreditsRef = useRef(new Map<string, string>());
  const adAbortRef = useRef<AbortController>();
  const [adStatus, setAdStatus] = useState<RewardedAdStatus>(getRewardedAdStatus);
  const [status, setStatus] = useState('강아지들이 놀러 오는 중…');
  const [toast, setToastText] = useState('');
  const [toastEventId, setToastEventId] = useState(0);
  const [busy, setBusy] = useState(false);
  const [houseError, setHouseError] = useState(false);
  const [soundEnabled, setSoundEnabled] = useState(readSoundEnabled);
  const [sharedError, setSharedError] = useState('');
  const [uploadRewardGranted, setUploadRewardGranted] = useState(false);
  const [submittedPet, setSubmittedPet] = useState<PetSummary>();
  const [myPets, setMyPets] = useState<OwnedPetSummary[]>([]);
  const [myPetsLoading, setMyPetsLoading] = useState(false);
  const [myPetsError, setMyPetsError] = useState('');
  const houseLoadedDateRef = useRef<string>();
  const houseLoadingRef = useRef(false);
  const houseReloadQueuedRef = useRef(false);
  const houseNeedsRefreshRef = useRef(false);
  const houseGenerationRef = useRef(0);
  const lastHouseLoadedAtRef = useRef(0);

  const dismissDailyLimitToast = useCallback(() => {
    setToastText('');
  }, []);

  const setToast = useCallback((text: string) => {
    setToastText(text);
    setToastEventId((current) => current + 1);
  }, []);

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => {
      window.scrollTo({ top: 0, left: 0, behavior: 'auto' });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [screen, route.screen === 'shared' || route.screen === 'play' ? route.petId : '']);

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

  async function loadHouse(queueIfBusy = false) {
    if (houseLoadingRef.current) {
      if (queueIfBusy) houseReloadQueuedRef.current = true;
      return;
    }
    const requestGeneration = houseGenerationRef.current;
    houseLoadingRef.current = true;
    setHouseError(false);
    setStatus('강아지들이 놀러 오는 중…');
    try {
      const value = await fetchHouse();
      if (requestGeneration !== houseGenerationRef.current) return;
      setPets(value.pets);
      if (value.allowance) {
        allowanceRef.current = value.allowance;
        setAllowance(value.allowance);
        saveAllowance(value.allowance);
        houseLoadedDateRef.current = value.allowance.date;
      } else {
        houseLoadedDateRef.current = getKstDate();
      }
      houseNeedsRefreshRef.current = false;
      lastHouseLoadedAtRef.current = Date.now();
      setStatus('강아지를 끌어 옮기거나, 톡 눌러 만나보세요');
    } catch {
      if (requestGeneration !== houseGenerationRef.current) return;
      setHouseError(true);
      setStatus('친구들을 불러오지 못했어요.');
    } finally {
      houseLoadingRef.current = false;
      if (houseReloadQueuedRef.current) {
        houseReloadQueuedRef.current = false;
        void loadHouse();
      }
    }
  }

  useEffect(() => {
    if (!initialSharedPetId) void loadHouse();
  }, [initialSharedPetId]);
  useEffect(() => {
    const refreshVisibleHome = () => {
      if (document.hidden || screen !== 'home' || Date.now() - lastHouseLoadedAtRef.current < 60_000) return;
      void loadHouse(true);
    };
    window.addEventListener('focus', refreshVisibleHome);
    window.addEventListener('pageshow', refreshVisibleHome);
    document.addEventListener('visibilitychange', refreshVisibleHome);
    return () => {
      window.removeEventListener('focus', refreshVisibleHome);
      window.removeEventListener('pageshow', refreshVisibleHome);
      document.removeEventListener('visibilitychange', refreshVisibleHome);
    };
  }, [screen]);
  useEffect(() => { photoUrlRef.current = photoUrl; }, [photoUrl]);
  useEffect(() => { allowanceRef.current = allowance; }, [allowance]);
  useEffect(() => { adPromptPetRef.current = adPromptPet; }, [adPromptPet]);
  useEffect(() => {
    if (!initialSharedPetId) return;
    void fetchSharedPet(initialSharedPetId)
      .then((result) => {
        setSelected(result.pet);
        if (result.allowance) {
          allowanceRef.current = result.allowance;
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
    let rechargeTimer: number | undefined;
    const refreshFreeAllowance = async () => {
      if (document.hidden || !isAllowanceForToday(allowanceRef.current)) return;
      const current = allowanceRef.current;
      const refreshed = refreshAllowance(current);
      const changed = refreshed.remaining !== current.remaining
        || refreshed.nextChargeAt !== current.nextChargeAt;
      if (!changed) return;
      await loadHouse(true);
    };
    const delay = millisecondsUntilNextFreeRecharge(allowance);
    if (delay !== null) {
      rechargeTimer = window.setTimeout(() => void refreshFreeAllowance(), delay + 500);
    }
    const onVisible = () => { if (!document.hidden) void refreshFreeAllowance(); };
    window.addEventListener('focus', onVisible);
    window.addEventListener('pageshow', onVisible);
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      if (rechargeTimer !== undefined) window.clearTimeout(rechargeTimer);
      window.removeEventListener('focus', onVisible);
      window.removeEventListener('pageshow', onVisible);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [allowance.remaining, allowance.nextChargeAt]);
  useEffect(() => {
    const handleVisibility = () => {
      if (document.hidden) void suspendSound();
      else void resumeSound(soundEnabled);
    };
    document.addEventListener('visibilitychange', handleVisibility);
    return () => document.removeEventListener('visibilitychange', handleVisibility);
  }, [soundEnabled]);
  useEffect(() => {
    let midnightTimer: number | undefined;
    const refreshForNewDay = async () => {
      if (document.hidden || isAllowanceForToday(allowanceRef.current)) return;
      adAbortRef.current?.abort();
      adPromptPetRef.current = undefined;
      adCreditsRef.current.clear();
      setPreparedVisit(undefined);
      setAdPromptPet(undefined);
      await loadHouse(true);
    };
    const scheduleMidnightRefresh = () => {
      if (midnightTimer !== undefined) window.clearTimeout(midnightTimer);
      midnightTimer = window.setTimeout(async () => {
        await refreshForNewDay();
        scheduleMidnightRefresh();
      }, millisecondsUntilNextKstDay() + 1_000);
    };
    const onVisible = () => { if (!document.hidden) void refreshForNewDay(); };
    window.addEventListener('focus', onVisible);
    window.addEventListener('pageshow', onVisible);
    document.addEventListener('visibilitychange', onVisible);
    scheduleMidnightRefresh();
    return () => {
      if (midnightTimer !== undefined) window.clearTimeout(midnightTimer);
      window.removeEventListener('focus', onVisible);
      window.removeEventListener('pageshow', onVisible);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, []);
  useEffect(() => {
    const expiryTimes = [...pets, ...(selected ? [selected] : [])]
      .map((pet) => pet.revisitUntil ? new Date(pet.revisitUntil).getTime() : Number.NaN)
      .filter((expiresAt) => Number.isFinite(expiresAt) && expiresAt > Date.now());
    if (!expiryTimes.length) return undefined;
    const nextExpiry = Math.min(...expiryTimes);
    const timer = window.setTimeout(() => {
      const now = new Date();
      setPets((current) => current.map((pet) => (
        pet.revisitUntil && !isPetRevisitActive(pet, now)
          ? { ...pet, revisitUntil: undefined, revealedToday: false }
          : pet
      )));
      setSelected((current) => current?.revisitUntil && !isPetRevisitActive(current, now)
        ? { ...current, revisitUntil: undefined, revealedToday: false }
        : current);
      void loadHouse(true);
    }, Math.min(nextExpiry - Date.now() + 250, 2_147_000_000));
    return () => window.clearTimeout(timer);
  }, [pets, selected]);

  const remaining = useMemo(
    () => regularRemainingCount(allowance),
    [allowance],
  );
  const uploadBonusAvailable = useMemo(() => hasUploadBonus(allowance), [allowance]);
  const dailyExhausted = remaining === 0
    && (!rewardedAdsEnabled || allowance.rewardedUsed >= MAX_REWARDED_PER_DAY)
    && !uploadBonusAvailable;
  const dailyStatus = remaining > 0
    ? `${remaining}마리를 바로 만날 수 있어요`
    : rewardedAdsEnabled && allowance.rewardedUsed < MAX_REWARDED_PER_DAY
      ? '광고를 보면 한 친구 더 만나요'
      : uploadBonusAvailable
        ? '내 강아지는 무료로 만날 수 있어요'
        : '이용권이 다시 차고 있어요';

  function enterPlay(pet: PetSummary, visit: PreparedVisit, playGreeting = true) {
    if (playGreeting) playSound('bark', getPetSoundVariant(pet.id));
    setSelected(pet);
    setPreparedVisit(visit);
    navigateTo({ screen: 'play', petId: pet.id });
    photoUrlRef.current = undefined;
    setPhotoUrl(undefined);
  }

  async function openRevealedPet(pet: PetSummary) {
    if (busy) return;
    setBusy(true);
    setToast('방금 만난 사진을 다시 꺼내는 중…');
    try {
      const result = await reopenPet(pet);
      allowanceRef.current = result.allowance;
      setAllowance(result.allowance);
      saveAllowance(result.allowance);
      const revisitedPet = {
        ...pet,
        revisitUntil: result.revisitUntil ?? pet.revisitUntil,
        revealedToday: true,
      };
      setSelected(revisitedPet);
      setPets((current) => current.map((item) => item.id === pet.id ? revisitedPet : item));
      setPreparedVisit({ petId: pet.id, revisit: true });
      navigateTo({ screen: 'play', petId: pet.id });
      photoUrlRef.current = result.photoUrl;
      setPhotoUrl(result.photoUrl);
      setToast('');
      playSound('reveal');
    } catch (error) {
      setToast(error instanceof Error ? error.message : '사진을 다시 열지 못했어요.');
    } finally {
      setBusy(false);
    }
  }

  function choosePet(pet: PetSummary) {
    const access = resolvePetAccess(pet, allowance, rewardedAdsEnabled);
    if (access.kind === 'revisit') {
      void openRevealedPet(pet);
      return;
    }
    if (access.kind === 'characterOnly') {
      enterPlay(pet, { petId: pet.id, characterOnlyReason: access.reason });
      return;
    }
    if (access.kind === 'unavailable') {
      setToast('이 친구는 지금 잠시 쉬고 있어요.');
      return;
    }
    if (access.kind === 'exhausted') {
      setToast(DAILY_LIMIT_TOAST);
      return;
    }
    const method = access.method;
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
      if (houseNeedsRefreshRef.current || houseLoadedDateRef.current !== getKstDate()) void loadHouse(true);
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
    if (houseNeedsRefreshRef.current || houseLoadedDateRef.current !== getKstDate()) void loadHouse(true);
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
    if (preparedVisit?.characterOnlyReason) {
      setToast('이 친구의 캐릭터는 지금 만날 수 있어요\n실제 사진은 검수 후 공개돼요');
      return;
    }
    if (!preparedVisit?.method || preparedVisit.petId !== selected.id) {
      setToast(DAILY_LIMIT_TOAST);
      return;
    }
    setBusy(true);
    try {
      const result = await revealPet(selected, preparedVisit.method, preparedVisit.adSessionId);
      setAllowance(result.allowance);
      allowanceRef.current = result.allowance;
      saveAllowance(result.allowance);
      const revisitUntil = result.revisitUntil;
      setSelected((current) => current ? { ...current, revisitUntil, revealedToday: true } : current);
      setPets((current) => current.map((pet) => pet.id === selected.id
        ? { ...pet, revisitUntil, revealedToday: true }
        : pet));
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
    houseGenerationRef.current += 1;
    houseNeedsRefreshRef.current = true;
    const current = readAllowance();
    const credited = result.rewardGranted && result.uploadRewardPetId
      ? grantUploadCredit(current, result.uploadRewardPetId)
      : current;
    saveAllowance(credited);
    setAllowance(credited);
    allowanceRef.current = credited;
    setUploadRewardGranted(result.rewardGranted);
    setSubmittedPet(result.pet);
    setPets((existing) => {
      const uploaded = { ...result.pet, isMine: true, ownerPinned: true };
      const publicPets = prioritizeRevealedPets(
        existing.filter((pet) => !pet.isMine && pet.id !== uploaded.id),
      );
      return [uploaded, ...publicPets].slice(0, HOUSE_PET_LIMIT);
    });
    void loadHouse(true);
    navigateTo({ screen: 'submitted' });
  }} /></Suspense>;
  if (screen === 'submitted') return (
    <main className="submitted-screen">
      <Result
        figure={submittedPet
          ? <div className="submitted-pet"><span>검수 중</span><PetArtwork pet={submittedPet} size={176} happy panting /></div>
          : <Asset.Image src="https://static.toss.im/2d-emojis/png/4x/u1F48C.png" frameShape={{ width: 96, height: 96 }} alt="마음이 담긴 편지" />}
        title={submittedPet ? `${submittedPet.name ?? '새 친구'}가 집에 놀러 왔어요` : '소중한 사진을 맡겨주셔서 고마워요'}
        description={uploadRewardGranted
          ? <>지금 집에서 이 친구에게 간식을 주면<br />광고 없이 실제 모습을 만날 수 있어요.</>
          : <>사진은 안전 검사를 거쳐 승인되면<br />다른 사람의 집에도 놀러 가요.</>}
        button={<Result.Button onClick={() => {
          goHome();
          if (submittedPet) choosePet(submittedPet);
        }}>{submittedPet ? '지금 만나보기' : '집으로 돌아가기'}</Result.Button>}
      />
    </main>
  );
  if (screen === 'mine') return <><Suspense fallback={screenFallback}><MyPetsScreen pets={myPets} loading={myPetsLoading} error={myPetsError} onRetry={() => void openMyPets()} onUpload={() => navigateTo({ screen: 'upload' })} onMeet={choosePet} onShare={(pet) => { void sharePet(pet.id, pet.name).catch((error) => setToast(error instanceof Error ? error.message : '공유하지 못했어요.')); }} /></Suspense><AppToast text={toast} eventId={toastEventId} onDismissDailyLimit={dismissDailyLimitToast} /></>;
  if (screen === 'shared') {
    if (sharedError) return <main className="shared-screen shared-unavailable"><Result title={sharedError} description="공개가 끝났거나 잠시 쉬고 있는 친구일 수 있어요." button={<Result.Button onClick={goHome}>다른 친구 만나기</Result.Button>} /></main>;
    if (!selected) return <main className="shared-screen shared-loading"><p>친구를 만나러 가는 중…</p></main>;
    return <><Suspense fallback={screenFallback}><SharedPetLanding pet={selected} onHome={goHome} onMeet={() => choosePet(selected)} /></Suspense>{adDialog}<AppToast text={toast} eventId={toastEventId} onDismissDailyLimit={dismissDailyLimitToast} /></>;
  }
  if (screen === 'play' && selected) return <>
    {preparedVisit?.revisit
      ? <main className="revisit-screen" aria-hidden="true" />
      : <PlayScene pet={selected} onFed={handleFed} onSound={playSound} />}
    <AppToast text={toast} eventId={toastEventId} onDismissDailyLimit={dismissDailyLimitToast} ariaLive={busy ? 'assertive' : 'polite'} />
    {photoUrl && <RevealCard
      pet={selected}
      photoUrl={photoUrl}
      onClose={goHome}
      onUpload={() => {
        photoUrlRef.current = undefined;
        setPhotoUrl(undefined);
        navigateTo({ screen: 'upload' });
      }}
      onSave={async () => {
        try {
          const destination = await saveBrandedPetPhoto(photoUrl, selected.name);
          setToast(destination === 'device'
            ? `${selected.name || '강아지'} 이름표와 함께 기기에 저장했어요.`
            : `${selected.name || '강아지'} 이름표가 담긴 사진을 저장했어요.`);
        } catch (error) {
          setToast(error instanceof Error ? error.message : '사진을 저장하지 못했어요.');
        }
      }}
      onShare={async () => {
        try {
          await sharePet(selected.id, selected.name);
          setToast('공유할 곳을 골라주세요.');
        } catch (error) {
          setToast(error instanceof Error ? error.message : '공유하지 못했어요.');
        }
      }}
      onReport={async () => {
        await reportPet(selected.id).catch(() => undefined);
        setToast('신고가 접수됐어요. 확인 후 처리할게요.');
        goHome();
      }}
    />}
  </>;

  return (
    <main className="home-screen">
      <section className="home-heading">
        <Top
          className="home-top"
          upperGap={16}
          lowerGap={10}
          title={<Top.TitleParagraph size={28}><span className="home-title">귀엽기만 해도 되나요?</span></Top.TitleParagraph>}
          subtitleBottom={<Top.SubtitleParagraph>오늘의 조그만 행복을 만나보세요</Top.SubtitleParagraph>}
        />
        <div className="home-sound-control"><SoundToggle enabled={soundEnabled} onToggle={toggleSound} /></div>
      </section>
      <section
        className={`daily-card${dailyExhausted ? ' is-exhausted' : ''}`}
        aria-label={dailyExhausted
          ? '이용권은 3시간마다 한 마리씩, 최대 두 마리까지 충전돼요.'
          : `지금 광고 없이 친구 ${remaining}마리를 더 만날 수 있어요${uploadBonusAvailable ? ', 내 강아지 무료 1회가 있어요' : ''}`}
      >
        <div className="daily-card-label">
          <Asset.Icon name="heart-line" color="#ff506f" backgroundColor="#fff0f3" frameShape={Asset.frameShape.CircleLarge} aria-hidden="true" />
          <div className="daily-card-copy">
            {dailyExhausted
              ? <span><strong>{dailyStatus}</strong><small>3시간마다 한 마리씩 충전돼요</small></span>
              : <span><small>광고 없이 만날 수 있는 친구</small><strong>{dailyStatus}</strong></span>}
            {uploadBonusAvailable && <span className="upload-bonus-badge">내 강아지 무료 1회</span>}
          </div>
        </div>
        {isPreviewRuntime && remaining === 0 ? (
          <button className="preview-daily-reset" type="button" onClick={() => {
            resetStoredAllowance();
            resetPreviewReveals();
            const fresh = readAllowance();
            allowanceRef.current = fresh;
            setAllowance(fresh);
            houseLoadedDateRef.current = undefined;
            void loadHouse(true).then(() => setToast('테스트 횟수를 다시 채웠어요.'));
          }}>테스트 다시 시작</button>
        ) : dailyExhausted ? null : <b>{remaining}<small>마리</small></b>}
      </section>
      <button className="my-pets-link" type="button" onClick={() => void openMyPets()}>내가 올린 강아지</button>
      {houseError && pets.length === 0 ? (
        <section className="house-error">
          <Asset.Image src="https://static.toss.im/2d-emojis/png/4x/u1F415.png" frameShape={{ width: 76, height: 76 }} alt="강아지" />
          <strong>잠시 뒤 다시 불러와 주세요</strong>
          <Button size="medium" color="dark" variant="weak" onClick={() => void loadHouse(true)}>다시 불러오기</Button>
        </section>
      ) : <House pets={pets} onSelect={choosePet} onSound={playSound} />}
      {!toast && houseError && pets.length > 0 ? (
        <button
          className="home-hint home-hint--retry"
          type="button"
          aria-live="polite"
          onClick={() => void loadHouse(true)}
        >
          새 친구를 불러오지 못했어요 · 다시 눌러보기
        </button>
      ) : !toast && !houseError ? <p className="home-hint" aria-live="polite">{status}</p> : null}
      {adDialog}
      <AppToast text={toast} eventId={toastEventId} onDismissDailyLimit={dismissDailyLimitToast} />
    </main>
  );
}
