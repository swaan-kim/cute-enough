import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Asset, Button, ConfirmDialog, Result, Top } from '@toss/tds-mobile';
import { AppToast, DAILY_COMPLETE_TOAST, DAILY_LIMIT_TOAST } from './components/AppToast';
import { House } from './components/House';
import { PetArtwork } from './components/PetArtwork';
import { SoundToggle } from './components/SoundToggle';
import { fetchHouse, fetchMyPets, fetchSharedPet, openOwnerPhoto, reopenPet, reportPet, revealPet } from './lib/api';
import { getKstDate, grantUploadCredit, hasUploadBonus, isAllowanceForToday, MAX_REWARDED_PER_DAY, millisecondsUntilNextFreeRecharge, millisecondsUntilNextKstDay, readAllowance, refreshAllowance, regularRemainingCount, resetStoredAllowance, saveAllowance } from './lib/allowance';
import { trackProductEvent } from './lib/analytics';
import { createInitialRouteStack, getCurrentRoute, homeRouteStack, popRoute, pushRoute } from './lib/appRoutes';
import { getSharedPetId } from './lib/deepLink';
import { HOUSE_PET_LIMIT } from './lib/housePets';
import { playHaptic } from './lib/haptics';
import { closeMiniApp, getInitialSharedPetId, subscribeNativeNavigation } from './lib/nativeNavigation';
import { isPetRevisitActive, resolvePetAccess, type PetAccessDecision } from './lib/petAccess';
import { saveBrandedPetPhoto } from './lib/photoSave';
import { formatRechargeCountdown, FREE_ALLOWANCE_DISPLAY_CAPACITY, RECHARGE_COPY_REFRESH_MS } from './lib/rechargeCopy';
import { getRewardedAdStatus, preloadRewardedAd, showRewardedAd, subscribeRewardedAdStatus, type RewardedAdStatus } from './lib/rewardedAd';
import { isPreviewRuntime, rewardedAdsEnabled } from './lib/runtime';
import { subscribeSafeArea } from './lib/safeArea';
import { getPetSoundVariant, playSoundEffect, readSoundEnabled, resumeSound, saveSoundEnabled, suspendSound, type SoundEffect } from './lib/sound';
import { sharePet } from './lib/toss';
import { resetPreviewReveals } from './lib/previewPetStore';
import type { AppRoute, DailyAllowance, DailyProgress, HouseResult, OwnedPetSummary, PetSummary, UnlockMethod } from './types';

const MyPetsScreen = lazy(() => import('./components/MyPetsScreen').then((module) => ({ default: module.MyPetsScreen })));
const PlayScene = lazy(() => import('./components/PlayScene').then((module) => ({ default: module.PlayScene })));
const RevealCard = lazy(() => import('./components/RevealCard').then((module) => ({ default: module.RevealCard })));
const SharedPetLanding = lazy(() => import('./components/SharedPetLanding').then((module) => ({ default: module.SharedPetLanding })));
const UploadFlow = lazy(() => import('./components/UploadFlow').then((module) => ({ default: module.UploadFlow })));

type PreparedVisit = {
  petId: string;
  method?: UnlockMethod;
  adSessionId?: string;
  characterOnlyReason?: Extract<PetAccessDecision, { kind: 'characterOnly' }>['reason'];
};

type PhotoAccessKind = 'ownerPhoto' | 'revisit';
type PhotoReturnMode = 'overlay' | 'home';

const HOUSE_SWR_MS = 5 * 60_000;
const HOME_HINT_STORAGE_KEY = 'cute-enough:home-hint-seen:v2';
const COMPLETION_TOAST_STORAGE_PREFIX = 'cute-enough:completion-toast:';

const screenFallback = <main className="screen-loading" aria-live="polite">화면을 준비하고 있어요…</main>;

function PhotoCardFallback({ petName, onClose }: { petName?: string; onClose: () => void }) {
  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true" aria-label="강아지 실사 사진">
      <article className="photo-card">
        <header className="photo-card-header">
          <span>{petName ? `${petName}의 사진` : '강아지의 사진'}</span>
          <button type="button" onClick={onClose} aria-label="사진 닫기">×</button>
        </header>
        <div className="photo-media">
          <div className="photo-frame photo-skeleton" role="status" aria-live="polite">
            <span className="photo-skeleton-heart" aria-hidden="true">♡</span>
            <strong>사진 화면을 준비하고 있어요</strong>
          </div>
        </div>
      </article>
    </div>
  );
}

export default function App() {
  const initialSharedPetId = useMemo(() => getInitialSharedPetId(), []);
  const [routeStack, setRouteStackState] = useState<AppRoute[]>(() => createInitialRouteStack(initialSharedPetId));
  const routeStackRef = useRef(routeStack);
  const route = getCurrentRoute(routeStack);
  const screen = route.screen;
  const sharedPetId = route.screen === 'shared' ? route.petId : undefined;
  const [pets, setPets] = useState<PetSummary[]>([]);
  const [ownerBonusPet, setOwnerBonusPet] = useState<PetSummary>();
  const [dailyProgress, setDailyProgress] = useState<HouseResult['dailyProgress']>();
  const [selected, setSelected] = useState<PetSummary>();
  const [allowance, setAllowance] = useState<DailyAllowance>(() => readAllowance());
  const allowanceRef = useRef(allowance);
  const [rechargeClock, setRechargeClock] = useState(() => new Date());
  const [photoUrl, setPhotoUrl] = useState<string>();
  const photoUrlRef = useRef(photoUrl);
  const [photoOpen, setPhotoOpen] = useState(false);
  const photoOpenRef = useRef(false);
  const [photoLoading, setPhotoLoading] = useState(false);
  const [photoLoadError, setPhotoLoadError] = useState('');
  const [photoMilestone, setPhotoMilestone] = useState<string>();
  const [photoAccessKind, setPhotoAccessKind] = useState<PhotoAccessKind>();
  const [photoReturnMode, setPhotoReturnMode] = useState<PhotoReturnMode>('overlay');
  const photoReturnModeRef = useRef<PhotoReturnMode>('overlay');
  const [preparedVisit, setPreparedVisit] = useState<PreparedVisit>();
  const [adPromptPet, setAdPromptPet] = useState<PetSummary>();
  const adPromptPetRef = useRef<PetSummary>();
  const adCreditsRef = useRef(new Map<string, string>());
  const adAbortRef = useRef<AbortController>();
  const [adStatus, setAdStatus] = useState<RewardedAdStatus>(getRewardedAdStatus);
  const [toast, setToastText] = useState('');
  const [toastEventId, setToastEventId] = useState(0);
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const [houseLoading, setHouseLoading] = useState(!initialSharedPetId);
  const [houseError, setHouseError] = useState(false);
  const [soundEnabled, setSoundEnabled] = useState(readSoundEnabled);
  const [sharedError, setSharedError] = useState('');
  const [submittedPet, setSubmittedPet] = useState<PetSummary>();
  const [myPets, setMyPets] = useState<OwnedPetSummary[]>([]);
  const [myPetsLoading, setMyPetsLoading] = useState(false);
  const [myPetsError, setMyPetsError] = useState('');
  const houseLoadedDateRef = useRef<string>();
  const houseLoadingRef = useRef(false);
  const houseAbortRef = useRef<AbortController>();
  const houseNeedsRefreshRef = useRef(false);
  const houseGenerationRef = useRef(0);
  const lastHouseLoadedAtRef = useRef(0);
  const mineNeedsRefreshRef = useRef(false);
  const mineGenerationRef = useRef(0);
  const mineAbortRef = useRef<AbortController>();
  const lastMineLoadedAtRef = useRef(0);
  const sharedGenerationRef = useRef(0);
  const sharedAbortRef = useRef<AbortController>();
  const lastUploadHapticPetIdRef = useRef<string>();
  const houseLoadingVisibleRef = useRef(false);
  const completionPendingDateRef = useRef<string>();
  const [showHomeHint, setShowHomeHint] = useState(() => {
    try { return localStorage.getItem(HOME_HINT_STORAGE_KEY) !== '1'; } catch { return true; }
  });
  const [hasDraggedHomePet, setHasDraggedHomePet] = useState(false);
  const [uploadDraftDirty, setUploadDraftDirty] = useState(false);
  const [uploadDiscardOpen, setUploadDiscardOpen] = useState(false);
  const uploadDraftDirtyRef = useRef(false);
  const uploadSubmissionBusyRef = useRef(false);
  const uploadDiscardOpenRef = useRef(false);

  const dismissDailyLimitToast = useCallback(() => {
    setToastText('');
  }, []);

  const setToast = useCallback((text: string) => {
    setToastText(text);
    setToastEventId((current) => current + 1);
  }, []);

  const dismissHomeHint = useCallback(() => {
    setShowHomeHint(false);
    try { localStorage.setItem(HOME_HINT_STORAGE_KEY, '1'); } catch { /* isolated preview storage can be unavailable */ }
  }, []);

  const markHouseLoadingVisible = useCallback(() => {
    houseLoadingVisibleRef.current = true;
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

  async function loadHouse(replaceInFlight = false) {
    if (houseLoadingRef.current) {
      if (!replaceInFlight) return;
      houseAbortRef.current?.abort();
    }
    const requestGeneration = houseGenerationRef.current + 1;
    houseGenerationRef.current = requestGeneration;
    const requestController = new AbortController();
    houseAbortRef.current = requestController;
    houseLoadingRef.current = true;
    setHouseLoading(true);
    setHouseError(false);
    try {
      const value = await fetchHouse(requestController.signal);
      if (requestGeneration !== houseGenerationRef.current) return;
      setPets(value.dailyPets ?? value.pets);
      setOwnerBonusPet(value.ownerBonusPet);
      setDailyProgress(value.dailyProgress);
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
      trackProductEvent('house_load', {
        result: 'success',
        public_count: (value.dailyPets ?? value.pets).length,
        owner_bonus: Boolean(value.ownerBonusPet),
      });
      if (houseLoadingVisibleRef.current) void playHaptic('friendsArrived');
      houseLoadingVisibleRef.current = false;
    } catch (error) {
      if (requestGeneration !== houseGenerationRef.current) return;
      if (error instanceof Error && 'code' in error && error.code === 'REQUEST_CANCELLED') return;
      setHouseError(true);
      trackProductEvent('house_load', { result: 'failure' });
      houseLoadingVisibleRef.current = false;
    } finally {
      if (requestGeneration === houseGenerationRef.current) {
        houseLoadingRef.current = false;
        houseAbortRef.current = undefined;
        setHouseLoading(false);
      }
    }
  }

  function applyServerAllowance(next: DailyAllowance) {
    allowanceRef.current = next;
    setAllowance(next);
    saveAllowance(next);
  }

  /** 공개/재열람 결과가 어느 화면에서 시작됐든 모든 로컬 강아지 캐시를 같이 갱신한다. */
  function patchPetCaches(petId: string, patch: Partial<PetSummary>) {
    const merge = <T extends PetSummary>(pet: T): T => (
      pet.id === petId ? { ...pet, ...patch } : pet
    );
    setSelected((current) => current ? merge(current) : current);
    setPets((current) => current.map(merge));
    setOwnerBonusPet((current) => current ? merge(current) : current);
    setMyPets((current) => current.map((pet) => merge(pet)));
  }

  function invalidateHouseSnapshot() {
    houseNeedsRefreshRef.current = true;
    if (houseLoadingRef.current) {
      houseAbortRef.current?.abort();
      houseGenerationRef.current += 1;
      houseLoadingRef.current = false;
      houseAbortRef.current = undefined;
      setHouseLoading(false);
    }

    // Shared-link entry has no house snapshot yet, so it still needs one load
    // before returning home. Normal home reveals already carry authoritative
    // allowance/progress data and can reuse the patched snapshot until SWR.
    if (!houseLoadedDateRef.current) void loadHouse(true);
  }

  async function refreshMyPets() {
    mineAbortRef.current?.abort();
    const generation = mineGenerationRef.current + 1;
    mineGenerationRef.current = generation;
    const controller = new AbortController();
    mineAbortRef.current = controller;
    setMyPetsLoading(true);
    setMyPetsError('');
    try {
      const next = await fetchMyPets(controller.signal);
      if (generation !== mineGenerationRef.current) return;
      setMyPets(next);
      mineNeedsRefreshRef.current = false;
      lastMineLoadedAtRef.current = Date.now();
    } catch (error) {
      if (generation !== mineGenerationRef.current) return;
      if (error instanceof Error && 'code' in error && error.code === 'REQUEST_CANCELLED') return;
      setMyPetsError('올린 강아지를 불러오지 못했어요.');
    } finally {
      if (generation === mineGenerationRef.current) {
        mineAbortRef.current = undefined;
        setMyPetsLoading(false);
      }
    }
  }

  async function loadSharedPet(petId: string) {
    sharedAbortRef.current?.abort();
    const generation = sharedGenerationRef.current + 1;
    sharedGenerationRef.current = generation;
    const controller = new AbortController();
    sharedAbortRef.current = controller;
    try {
      const result = await fetchSharedPet(petId, controller.signal);
      if (generation !== sharedGenerationRef.current) return;
      setSelected(result.pet);
      if (result.allowance) applyServerAllowance(result.allowance);
      setSharedError('');
    } catch (error) {
      if (generation !== sharedGenerationRef.current) return;
      if (error instanceof Error && 'code' in error && error.code === 'REQUEST_CANCELLED') return;
      setSharedError('이 친구는 지금 만날 수 없어요.');
    } finally {
      if (generation === sharedGenerationRef.current) sharedAbortRef.current = undefined;
    }
  }

  useEffect(() => {
    if (!initialSharedPetId) void loadHouse();
  }, [initialSharedPetId]);
  useEffect(() => {
    const refreshVisibleHome = () => {
      if (document.hidden || screen !== 'home' || Date.now() - lastHouseLoadedAtRef.current < HOUSE_SWR_MS) return;
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
  useEffect(() => {
    const refreshVisibleMine = () => {
      if (document.hidden || screen !== 'mine' || Date.now() - lastMineLoadedAtRef.current < 60_000) return;
      void refreshMyPets();
    };
    window.addEventListener('focus', refreshVisibleMine);
    window.addEventListener('pageshow', refreshVisibleMine);
    document.addEventListener('visibilitychange', refreshVisibleMine);
    return () => {
      window.removeEventListener('focus', refreshVisibleMine);
      window.removeEventListener('pageshow', refreshVisibleMine);
      document.removeEventListener('visibilitychange', refreshVisibleMine);
    };
  }, [screen]);
  useEffect(() => { photoUrlRef.current = photoUrl; }, [photoUrl]);
  useEffect(() => { photoOpenRef.current = photoOpen; }, [photoOpen]);
  useEffect(() => { photoReturnModeRef.current = photoReturnMode; }, [photoReturnMode]);
  useEffect(() => () => {
    houseAbortRef.current?.abort();
    mineAbortRef.current?.abort();
    sharedAbortRef.current?.abort();
  }, []);
  useEffect(() => {
    if (!showHomeHint) return undefined;
    const timer = window.setTimeout(() => {
      setShowHomeHint(false);
      try { localStorage.setItem(HOME_HINT_STORAGE_KEY, '1'); } catch { /* isolated preview storage can be unavailable */ }
    }, 3_000);
    return () => window.clearTimeout(timer);
  }, [showHomeHint]);
  useEffect(() => { allowanceRef.current = allowance; }, [allowance]);
  useEffect(() => { adPromptPetRef.current = adPromptPet; }, [adPromptPet]);
  useEffect(() => { uploadDraftDirtyRef.current = uploadDraftDirty; }, [uploadDraftDirty]);
  useEffect(() => { uploadDiscardOpenRef.current = uploadDiscardOpen; }, [uploadDiscardOpen]);
  useEffect(() => {
    const handleUploadDirtyChange = (event: Event) => {
      const detail = (event as CustomEvent<{ dirty?: boolean; busy?: boolean }>).detail;
      const dirty = Boolean(detail?.dirty);
      uploadDraftDirtyRef.current = dirty;
      uploadSubmissionBusyRef.current = Boolean(detail?.busy);
      setUploadDraftDirty(dirty);
    };
    window.addEventListener('cute-enough:upload-dirty-change', handleUploadDirtyChange);
    return () => window.removeEventListener('cute-enough:upload-dirty-change', handleUploadDirtyChange);
  }, []);
  useEffect(() => {
    setRechargeClock(new Date());
    if (!allowance.nextChargeAt) return undefined;
    const timer = window.setInterval(() => setRechargeClock(new Date()), RECHARGE_COPY_REFRESH_MS);
    return () => window.clearInterval(timer);
  }, [allowance.nextChargeAt]);
  useEffect(() => {
    if (!sharedPetId) return undefined;
    void loadSharedPet(sharedPetId);
    const refreshSharedPet = () => {
      if (!document.hidden) void loadSharedPet(sharedPetId);
    };
    window.addEventListener('focus', refreshSharedPet);
    window.addEventListener('pageshow', refreshSharedPet);
    document.addEventListener('visibilitychange', refreshSharedPet);
    return () => {
      sharedAbortRef.current?.abort();
      sharedAbortRef.current = undefined;
      sharedGenerationRef.current += 1;
      window.removeEventListener('focus', refreshSharedPet);
      window.removeEventListener('pageshow', refreshSharedPet);
      document.removeEventListener('visibilitychange', refreshSharedPet);
    };
  }, [sharedPetId]);
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
    const expiryTimes = [...pets, ...(ownerBonusPet ? [ownerBonusPet] : []), ...myPets, ...(selected ? [selected] : [])]
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
      setOwnerBonusPet((current) => current?.revisitUntil && !isPetRevisitActive(current, now)
        ? { ...current, revisitUntil: undefined, revealedToday: false }
        : current);
      setSelected((current) => current?.revisitUntil && !isPetRevisitActive(current, now)
        ? { ...current, revisitUntil: undefined, revealedToday: false }
        : current);
      setMyPets((current) => current.map((pet) => (
        pet.revisitUntil && !isPetRevisitActive(pet, now)
          ? { ...pet, revisitUntil: undefined, revealedToday: false }
          : pet
      )));
      void loadHouse(true);
    }, Math.min(nextExpiry - Date.now() + 250, 2_147_000_000));
    return () => window.clearTimeout(timer);
  }, [pets, ownerBonusPet, myPets, selected]);

  const remaining = useMemo(
    () => regularRemainingCount(allowance),
    [allowance],
  );
  const rechargeCopy = useMemo(
    () => formatRechargeCountdown(allowance.nextChargeAt, rechargeClock),
    [allowance.nextChargeAt, rechargeClock],
  );
  const uploadBonusAvailable = useMemo(() => hasUploadBonus(allowance), [allowance]);
  const rewardedLimit = allowance.rewardedLimit ?? MAX_REWARDED_PER_DAY;
  const rewardedRemaining = allowance.rewardedRemaining
    ?? Math.max(0, rewardedLimit - allowance.rewardedUsed);
  const visibleProgress = dailyProgress ?? {
    date: allowance.date,
    metPetIds: pets.filter((pet) => pet.revealedToday).map((pet) => pet.id),
    metCount: pets.filter((pet) => pet.revealedToday).length,
    totalCount: HOUSE_PET_LIMIT,
    completed: pets.length >= HOUSE_PET_LIMIT && pets.every((pet) => pet.revealedToday),
  };

  function updateDailyProgressAfterPhoto(pet: PetSummary, serverProgress?: DailyProgress): DailyProgress | undefined {
    if (pet.isMine || ownerBonusPet?.id === pet.id) return dailyProgress;
    const previous = dailyProgress ?? visibleProgress;
    const next = serverProgress ?? (() => {
      const metPetIds = previous.metPetIds.includes(pet.id)
        ? previous.metPetIds
        : [...previous.metPetIds, pet.id];
      return {
        date: previous.date || allowance.date,
        metPetIds,
        metCount: Math.min(HOUSE_PET_LIMIT, metPetIds.length),
        totalCount: HOUSE_PET_LIMIT,
        completed: metPetIds.length >= HOUSE_PET_LIMIT,
      };
    })();
    setDailyProgress(next);
    if (!previous.completed && next.completed) {
      setPhotoMilestone(`오늘의 다섯 번째 친구 · ${next.metCount}/${next.totalCount}`);
      completionPendingDateRef.current = next.date;
    }
    return next;
  }

  function enterPlay(pet: PetSummary, visit: PreparedVisit, playGreeting = true) {
    if (playGreeting) playSound('bark', getPetSoundVariant(pet.id));
    setSelected(pet);
    setPreparedVisit(visit);
    navigateTo({ screen: 'play', petId: pet.id });
    photoUrlRef.current = undefined;
    setPhotoUrl(undefined);
    photoOpenRef.current = false;
    setPhotoOpen(false);
    setPhotoLoadError('');
  }

  async function openDirectPhoto(pet: PetSummary, kind: PhotoAccessKind, retry = false): Promise<boolean> {
    if (busyRef.current) return false;
    busyRef.current = true;
    setBusy(true);
    setSelected(pet);
    setPhotoAccessKind(kind);
    setPhotoOpen(true);
    setPhotoLoading(true);
    setPhotoLoadError('');
    if (!retry) {
      setPhotoReturnMode('overlay');
      photoReturnModeRef.current = 'overlay';
      setPhotoMilestone(undefined);
      photoUrlRef.current = undefined;
      setPhotoUrl(undefined);
    }
    try {
      let nextPhotoUrl: string;
      let patch: Partial<PetSummary>;
      let nextProgress: DailyProgress | undefined;
      if (kind === 'ownerPhoto') {
        const result = await openOwnerPhoto(pet);
        nextPhotoUrl = result.photoUrl;
        patch = { ownerPhotoAvailable: result.ownerPhotoAvailable };
      } else {
        const result = await reopenPet(pet);
        applyServerAllowance(result.allowance);
        nextPhotoUrl = result.photoUrl;
        nextProgress = result.dailyProgress;
        patch = {
          revisitUntil: result.revisitUntil ?? pet.revisitUntil,
          revealedToday: true,
        };
      }
      const openedPet = {
        ...pet,
        ...patch,
      };
      setSelected(openedPet);
      patchPetCaches(pet.id, patch);
      updateDailyProgressAfterPhoto(openedPet, nextProgress);
      photoUrlRef.current = nextPhotoUrl;
      setPhotoUrl(nextPhotoUrl);
      setPhotoLoadError('');
      setToast('');
      playSound('reveal');
      trackProductEvent('photo_reveal', { access_method: kind });
      return true;
    } catch (error) {
      const message = error instanceof Error ? error.message : '사진을 다시 열지 못했어요.';
      setPhotoLoadError(message);
      setToast(message);
      return false;
    } finally {
      setPhotoLoading(false);
      busyRef.current = false;
      setBusy(false);
    }
  }

  function choosePet(pet: PetSummary) {
    dismissHomeHint();
    const access = resolvePetAccess(pet, allowance, rewardedAdsEnabled);
    trackProductEvent('pet_select', { access_kind: access.kind });
    if (access.kind === 'ownerPhoto') {
      void openDirectPhoto(pet, 'ownerPhoto');
      return;
    }
    if (access.kind === 'revisit') {
      void openDirectPhoto(pet, 'revisit');
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
    if (uploadDiscardOpenRef.current) {
      uploadDiscardOpenRef.current = false;
      setUploadDiscardOpen(false);
      return;
    }
    if (adPromptPetRef.current) {
      adAbortRef.current?.abort();
      adPromptPetRef.current = undefined;
      setAdPromptPet(undefined);
      return;
    }
    if (photoOpenRef.current) {
      closePhotoCard();
      return;
    }
    if (getCurrentRoute(routeStackRef.current).screen === 'upload' && uploadSubmissionBusyRef.current) {
      setToast('강아지 소개를 마무리하고 있어요. 잠시만 기다려 주세요.');
      return;
    }
    if (getCurrentRoute(routeStackRef.current).screen === 'upload' && uploadDraftDirtyRef.current) {
      uploadDiscardOpenRef.current = true;
      setUploadDiscardOpen(true);
      return;
    }
    popCurrentRoute();
  }

  function popCurrentRoute() {
    const current = routeStackRef.current;
    if (current.length <= 1) {
      void closeMiniApp().catch(() => undefined);
      return;
    }
    const next = popRoute(current);
    updateRouteStack(next);
    setPhotoUrl(undefined);
    setToast('');
    const nextScreen = getCurrentRoute(next).screen;
    if (nextScreen === 'mine' && mineNeedsRefreshRef.current) void refreshMyPets();
    if (nextScreen === 'home') {
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
    photoOpenRef.current = false;
    setPhotoOpen(false);
    setPhotoLoading(false);
    setPhotoLoadError('');
    setPhotoAccessKind(undefined);
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
    if (!pet || busyRef.current) return;
    if (adStatus !== 'loaded') {
      void preloadRewardedAd().catch(() => undefined);
      return;
    }

    busyRef.current = true;
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
      trackProductEvent('rewarded_ad_result', { result: 'rewarded' });
    } catch (error) {
      trackProductEvent('rewarded_ad_result', {
        result: error instanceof DOMException && error.name === 'AbortError' ? 'cancelled' : 'failed',
      });
      if (!(error instanceof DOMException && error.name === 'AbortError')) {
        setToast(error instanceof Error ? error.message : '광고를 완료하지 못했어요.');
      }
    } finally {
      adAbortRef.current = undefined;
      await resumeSound(soundEnabled);
      busyRef.current = false;
      setBusy(false);
    }
  }

  async function openMyPets() {
    if (getCurrentRoute(routeStackRef.current).screen !== 'mine') navigateTo({ screen: 'mine' });
    await refreshMyPets();
  }

  async function handleFed() {
    if (!selected || busyRef.current) return;
    if (preparedVisit?.characterOnlyReason) {
      setToast('이 친구의 캐릭터는 지금 만날 수 있어요\n실제 사진은 검수 후 공개돼요');
      return;
    }
    if (!preparedVisit?.method || preparedVisit.petId !== selected.id) {
      setToast(DAILY_LIMIT_TOAST);
      return;
    }
    busyRef.current = true;
    setBusy(true);
    setPhotoAccessKind(selected.isMine ? 'ownerPhoto' : 'revisit');
    setPhotoReturnMode('home');
    photoReturnModeRef.current = 'home';
    setPhotoMilestone(undefined);
    setPhotoLoadError('');
    setPhotoLoading(true);
    photoUrlRef.current = undefined;
    setPhotoUrl(undefined);
    photoOpenRef.current = true;
    setPhotoOpen(true);
    try {
      const result = await revealPet(selected, preparedVisit.method, preparedVisit.adSessionId);
      applyServerAllowance(result.allowance);
      const revisitUntil = result.revisitUntil;
      patchPetCaches(selected.id, {
        revisitUntil,
        revealedToday: true,
        ...(selected.isMine ? { ownerPhotoAvailable: true } : {}),
      });
      updateDailyProgressAfterPhoto(selected, result.dailyProgress);
      mineGenerationRef.current += 1;
      mineNeedsRefreshRef.current = true;
      invalidateHouseSnapshot();
      if (preparedVisit.method === 'REWARDED') adCreditsRef.current.delete(selected.id);
      photoUrlRef.current = result.photoUrl;
      setPhotoUrl(result.photoUrl); setToast(''); playSound('reveal');
      trackProductEvent('play_complete', { access_method: preparedVisit.method });
      trackProductEvent('photo_reveal', { access_method: preparedVisit.method });
    } catch (error) {
      const message = error instanceof Error ? error.message : '사진을 열지 못했어요.';
      setPhotoLoadError(message);
      setToast(message);
    }
    finally { setPhotoLoading(false); busyRef.current = false; setBusy(false); }
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
      title="광고를 보고 지금 이 친구 만나기"
      description={`광고를 끝까지 보면 바로 만날 수 있어요.\n오늘 ${allowance.rewardedUsed}/${rewardedLimit}번 사용${rechargeCopy ? ` · 또는 ${rechargeCopy}` : ''}`}
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
  const uploadDiscardDialog = (
    <ConfirmDialog
      open={uploadDiscardOpen}
      title="작성 중인 내용을 나갈까요?"
      description="고른 사진과 꾸민 모습은 저장되지 않아요."
      closeOnBackEvent={false}
      onClose={() => {
        uploadDiscardOpenRef.current = false;
        setUploadDiscardOpen(false);
      }}
      cancelButton={<ConfirmDialog.CancelButton onClick={() => {
        uploadDiscardOpenRef.current = false;
        setUploadDiscardOpen(false);
      }}>계속 꾸미기</ConfirmDialog.CancelButton>}
      confirmButton={<ConfirmDialog.ConfirmButton onClick={() => {
        uploadDiscardOpenRef.current = false;
        uploadDraftDirtyRef.current = false;
        setUploadDiscardOpen(false);
        setUploadDraftDirty(false);
        popCurrentRoute();
      }}>나가기</ConfirmDialog.ConfirmButton>}
    />
  );

  function showPendingCompletionToast() {
    const date = completionPendingDateRef.current;
    if (!date) return;
    completionPendingDateRef.current = undefined;
    const storageKey = `${COMPLETION_TOAST_STORAGE_PREFIX}${date}`;
    try {
      if (localStorage.getItem(storageKey) === '1') return;
      localStorage.setItem(storageKey, '1');
    } catch { /* The toast can still be shown once in memory. */ }
    setToast(DAILY_COMPLETE_TOAST);
  }

  function closePhotoCard() {
    const returnHome = photoReturnModeRef.current === 'home';
    photoOpenRef.current = false;
    setPhotoOpen(false);
    photoUrlRef.current = undefined;
    setPhotoUrl(undefined);
    setPhotoLoading(false);
    setPhotoLoadError('');
    setPhotoMilestone(undefined);
    setPhotoAccessKind(undefined);
    if (returnHome) goHome();
    showPendingCompletionToast();
  }

  const photoCard = photoOpen && selected ? <Suspense fallback={<PhotoCardFallback petName={selected.name} onClose={closePhotoCard} />}><RevealCard
    pet={selected}
    photoUrl={photoUrl}
    loading={photoLoading}
    loadError={photoLoadError}
    milestoneText={photoMilestone}
    onClose={closePhotoCard}
    onRetryPhoto={async () => {
      if (!photoAccessKind || !(await openDirectPhoto(selected, photoAccessKind, true))) {
        throw new Error('사진을 다시 열지 못했어요.');
      }
    }}
    onUpload={() => {
      photoOpenRef.current = false;
      setPhotoOpen(false);
      photoUrlRef.current = undefined;
      setPhotoUrl(undefined);
      setPhotoAccessKind(undefined);
      navigateTo({ screen: 'upload' });
    }}
    onSave={photoUrl ? async () => {
      try {
        const destination = await saveBrandedPetPhoto(photoUrl, selected.name);
        setToast(destination === 'device'
          ? `${selected.name || '강아지'} 이름표와 함께 기기에 저장했어요.`
          : `${selected.name || '강아지'} 이름표가 담긴 사진을 저장했어요.`);
      } catch (error) {
        setToast(error instanceof Error ? error.message : '사진을 저장하지 못했어요.');
      }
    } : undefined}
    onShare={async () => {
      try {
        await sharePet(selected.id, selected.name);
        trackProductEvent('share_complete', { entry_point: 'photo' });
        setToast('공유할 곳을 골라주세요.');
      } catch (error) {
        setToast(error instanceof Error ? error.message : '공유하지 못했어요.');
      }
    }}
    onReport={async () => {
      try {
        await reportPet(selected.id);
        goHome();
        setToast('신고가 접수됐어요. 확인 후 처리할게요.');
      } catch (error) {
        setToast(error instanceof Error ? error.message : '신고를 접수하지 못했어요.');
      }
    }}
  /></Suspense> : null;

  function renderWithAppShell(content: ReactNode) {
    return <>
      {content}
      {adDialog}
      {uploadDiscardDialog}
      {photoCard}
      <AppToast
        text={toast}
        eventId={toastEventId}
        onDismissDailyLimit={dismissDailyLimitToast}
        ariaLive={busy ? 'assertive' : 'polite'}
      />
    </>;
  }

  if (screen === 'upload') return renderWithAppShell(<Suspense fallback={screenFallback}><UploadFlow onSubmitted={(result) => {
    trackProductEvent('registration_complete', { reward_granted: result.rewardGranted });
    houseGenerationRef.current += 1;
    houseNeedsRefreshRef.current = true;
    mineGenerationRef.current += 1;
    mineNeedsRefreshRef.current = true;
    const current = readAllowance();
    const credited = result.rewardGranted && result.uploadRewardPetId
      ? grantUploadCredit(current, result.uploadRewardPetId)
      : current;
    saveAllowance(credited);
    setAllowance(credited);
    allowanceRef.current = credited;
    const uploaded: OwnedPetSummary = {
      ...result.pet,
      isMine: true,
      ownerPinned: true,
      approvalStatus: result.pet.approvalStatus ?? 'pending',
    };
    setSubmittedPet(uploaded);
    if (lastUploadHapticPetIdRef.current !== uploaded.id) {
      lastUploadHapticPetIdRef.current = uploaded.id;
      void playHaptic('uploadSuccess');
    }
    setMyPets((existing) => [uploaded, ...existing.filter((pet) => pet.id !== uploaded.id)]);
    setOwnerBonusPet(uploaded);
    void loadHouse(true);
    navigateTo({ screen: 'submitted' });
  }} /></Suspense>);
  if (screen === 'submitted') return renderWithAppShell(
    <main className="submitted-screen">
      <Result
        figure={submittedPet
          ? <div className="submitted-pet"><span>검수 중</span><PetArtwork pet={submittedPet} size={176} happy panting /></div>
          : <Asset.Image src="https://static.toss.im/2d-emojis/png/4x/u1F48C.png" frameShape={{ width: 96, height: 96 }} alt="마음이 담긴 편지" />}
        title={submittedPet ? `${submittedPet.name ?? '새 친구'}가 집에 놀러 왔어요` : '소중한 사진을 맡겨주셔서 고마워요'}
        description={<>집에서 이 친구를 누르면 실제 모습을 바로 볼 수 있어요.<br />승인되면 다른 사람의 집에도 놀러 가요.</>}
        button={<Result.Button onClick={() => {
          goHome();
          if (submittedPet) choosePet(submittedPet);
        }}>{submittedPet ? '지금 만나보기' : '집으로 돌아가기'}</Result.Button>}
      />
    </main>
  );
  if (screen === 'mine') return renderWithAppShell(<Suspense fallback={screenFallback}><MyPetsScreen pets={myPets} loading={myPetsLoading} error={myPetsError} uploadRewardPetId={uploadBonusAvailable ? allowance.uploadRewardPetId : undefined} onRetry={() => void openMyPets()} onUpload={() => navigateTo({ screen: 'upload' })} onMeet={choosePet} onShare={(pet) => {
    void sharePet(pet.id, pet.name)
      .then(() => {
        trackProductEvent('share_complete', { entry_point: 'mine' });
        setToast('공유할 곳을 골라주세요.');
      })
      .catch((error) => setToast(error instanceof Error ? error.message : '공유하지 못했어요.'));
  }} /></Suspense>);
  if (screen === 'shared') {
    if (sharedError) return renderWithAppShell(<main className="shared-screen shared-unavailable"><Result title={sharedError} description="공개가 끝났거나 잠시 연결이 늦어지고 있을 수 있어요." button={<Result.Button onClick={() => sharedPetId && void loadSharedPet(sharedPetId)}>다시 확인하기</Result.Button>} /></main>);
    if (!selected) return renderWithAppShell(<main className="shared-screen shared-loading"><p>친구를 만나러 가는 중…</p></main>);
    return renderWithAppShell(<Suspense fallback={screenFallback}><SharedPetLanding
      pet={selected}
      accessDecision={resolvePetAccess(selected, allowance, rewardedAdsEnabled)}
      onHome={goHome}
      onMeet={() => choosePet(selected)}
    /></Suspense>);
  }
  if (screen === 'play' && selected) return renderWithAppShell(
    <Suspense fallback={screenFallback}><PlayScene pet={selected} onFed={handleFed} onSound={playSound} /></Suspense>,
  );

  return renderWithAppShell(
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
        className="daily-card daily-card--v2"
        aria-label={`오늘 만난 친구 ${visibleProgress.metCount}/${visibleProgress.totalCount}, 무료 이용권 ${remaining}/${FREE_ALLOWANCE_DISPLAY_CAPACITY}${rechargeCopy ? `, ${rechargeCopy}` : ', 최대 2개까지 보관'}${uploadBonusAvailable ? ', 내 강아지 무료 1회' : ''}`}
      >
        <div className="daily-progress-row">
          <Asset.Icon name="heart-line" color="#ff506f" backgroundColor="#fff0f3" frameShape={Asset.frameShape.CircleLarge} aria-hidden="true" />
          <div className="daily-progress-copy">
            <small>오늘의 친구</small>
            <div className="daily-heart-progress" aria-hidden="true">
              {Array.from({ length: HOUSE_PET_LIMIT }, (_, index) => (
                <span className={index < visibleProgress.metCount ? 'is-met' : ''} key={index}>♥</span>
              ))}
            </div>
          </div>
          <strong>{visibleProgress.metCount}<small>/{HOUSE_PET_LIMIT}</small></strong>
        </div>
        <div className="daily-allowance-row">
          <div>
            <strong>이용권 {remaining}개</strong>
            <small>{remaining < FREE_ALLOWANCE_DISPLAY_CAPACITY
              ? rechargeCopy ?? '곧 1개 충전'
              : '최대 2개까지 보관해요'}</small>
          </div>
          {remaining === 0 && rewardedAdsEnabled && rewardedRemaining > 0 && (
            <span className="daily-ad-skip">광고로 기다림 건너뛰기 · 오늘 {rewardedRemaining}번 남음</span>
          )}
          {visibleProgress.completed && <span className="daily-complete-label">내일 새 친구들이 와요</span>}
        </div>
        {isPreviewRuntime && remaining === 0 && (
          <button className="preview-daily-reset" type="button" onClick={() => {
            resetStoredAllowance();
            resetPreviewReveals();
            const fresh = readAllowance();
            allowanceRef.current = fresh;
            setAllowance(fresh);
            houseLoadedDateRef.current = undefined;
            void loadHouse(true).then(() => setToast('테스트 횟수를 다시 채웠어요.'));
          }}>테스트 다시 시작</button>
        )}
      </section>
      <button className="my-pets-link" type="button" onClick={() => void openMyPets()}>내가 소개한 강아지</button>
      {houseError && pets.length === 0 && !ownerBonusPet ? (
        <section className="house-error">
          <Asset.Image src="https://static.toss.im/2d-emojis/png/4x/u1F415.png" frameShape={{ width: 76, height: 76 }} alt="강아지" />
          <strong>잠시 뒤 다시 불러와 주세요</strong>
          <Button size="medium" color="dark" variant="weak" onClick={() => void loadHouse(true)}>다시 불러오기</Button>
        </section>
      ) : <House
        dailyPets={pets}
        ownerBonusPet={ownerBonusPet}
        metPetIds={visibleProgress.metPetIds}
        onSelect={choosePet}
        onSound={playSound}
        loading={houseLoading && pets.length === 0 && !ownerBonusPet}
        onLoadingVisible={markHouseLoadingVisible}
        onRetry={() => void loadHouse(true)}
        showFirstHint={showHomeHint}
        showDragHint={!hasDraggedHomePet}
        onHintDismiss={dismissHomeHint}
        onFirstDrag={() => {
          setHasDraggedHomePet(true);
          trackProductEvent('pet_drag', { first_drag: true });
        }}
      />}
      {!toast && houseError && (pets.length > 0 || Boolean(ownerBonusPet)) ? (
        <button
          className="home-hint home-hint--retry"
          type="button"
          aria-live="polite"
          onClick={() => void loadHouse(true)}
        >
          새 친구를 불러오지 못했어요 · 다시 눌러보기
        </button>
      ) : null}
    </main>
  );
}
