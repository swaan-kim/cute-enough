import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Asset, Button, ConfirmDialog, Result, Top } from '@toss/tds-mobile';
import { AppToast, DAILY_COMPLETE_TOAST, DAILY_LIMIT_TOAST } from './components/AppToast';
import type { PetInteractionMethod } from './components/PlayScene';
import { albumPhotoMetadata, fetchAlbum, openAlbumPhoto, preparePetPhoto, setPetFavorite } from './lib/api';
import { createPhotoPreparation, type PhotoPreparation } from './lib/photoPreparation';
import type { AlbumPetSummary, AlbumResult } from './types';
import { House } from './components/House';
import { getPreviewScenario, getScenarioStorage } from './data/previewScenarios';
import { PetArtwork } from './components/PetArtwork';
import { cancelAdReward, closeShareReward, completeAdReward, fetchHouse, fetchMyPets, fetchRechargeNotificationSettings, fetchRewardStatus, fetchSharedPet, openOwnerPhoto, rebindAdReward, recordShareReward, reopenPet, reportPet, revealPet, setRechargeNotificationSettings, startAdReward, startShareReward, type RechargeNotificationSettings } from './lib/api';
import { bonusRemainingCount, getKstDate, grantUploadCredit, hasUploadBonus, isAllowanceForToday, MAX_REWARDED_PER_DAY, millisecondsUntilNextFreeRecharge, millisecondsUntilNextKstDay, readAllowance, refreshAllowance, regularRemainingCount, resetStoredAllowance, saveAllowance } from './lib/allowance';
import { trackProductEvent } from './lib/analytics';
import { createInitialRouteStack, getCurrentRoute, homeRouteStack, popRoute, pushRoute } from './lib/appRoutes';
import { getSharedPetId } from './lib/deepLink';
import { HOUSE_PET_LIMIT, normalizeDailyProgress } from './lib/housePets';
import { playHaptic } from './lib/haptics';
import { closeMiniApp, getInitialSharedPetId, subscribeNativeNavigation } from './lib/nativeNavigation';
import { isPetRevisitActive, resolvePetEncounter, type PetAccessDecision } from './lib/petAccess';
import { createPetPublicationCache } from './lib/petPublicationCache';
import { saveBrandedPetPhoto } from './lib/photoSave';
import { formatRechargeCountdown, FREE_ALLOWANCE_DISPLAY_CAPACITY, RECHARGE_COPY_REFRESH_MS } from './lib/rechargeCopy';
import { confirmRewardedAdReturn, getRewardedAdStatus, preloadRewardedAd, showRewardedAd, subscribeRewardedAdStatus, type RewardedAdStatus } from './lib/rewardedAd';
import { isPreviewRuntime, rewardedAdsEnabled } from './lib/runtime';
import { subscribeSafeArea } from './lib/safeArea';
import { getPetSoundVariant, playSoundEffect, readSoundEnabled, resumeSound, suspendSound, type SoundEffect } from './lib/sound';
import { sharePet } from './lib/toss';
import { resetPreviewReveals } from './lib/previewPetStore';
import { openShareReward, supportsShareReward } from './lib/shareReward';
import { requestRechargeNotificationAgreement } from './lib/rechargeNotification';
import { acknowledgeRewardRecovery, acknowledgeRewardStart, assertRewardStorage, canReplayRewardJob, enqueueRewardRecovery, forgetActiveRewardSession, forgetPendingAdStart, getRewardStartRequest, markPendingAdStartNative, readActiveRewardSessions, readPendingAdStarts, readRewardRecovery, rememberActiveRewardSession, rememberPendingAdStart, type RewardRecoveryJob } from './lib/rewardRecovery';
import type { AdRewardCredit, AppRoute, DailyAllowance, DailyProgress, HouseResult, OwnedPetSummary, PetSummary, RewardCapabilities, RewardStatus, UnlockMethod } from './types';

const MyPetsScreen = lazy(() => import('./components/MyPetsScreen').then((module) => ({ default: module.MyPetsScreen })));
const AlbumScreen = lazy(() => import('./components/AlbumScreen').then((module) => ({ default: module.AlbumScreen })));
const PlayScene = lazy(() => import('./components/PlayScene').then((module) => ({ default: module.PlayScene })));
let ReadyRevealCard: typeof import('./components/RevealCard').RevealCard | undefined;
const loadRevealCard = () => import('./components/RevealCard').then((module) => {
  ReadyRevealCard = module.RevealCard;
  return { default: module.RevealCard };
});
const RevealCard = lazy(loadRevealCard);
const SharedPetLanding = lazy(() => import('./components/SharedPetLanding').then((module) => ({ default: module.SharedPetLanding })));
const UploadFlow = lazy(() => import('./components/UploadFlow').then((module) => ({ default: module.UploadFlow })));
const PetPhotoAdditionFlow = lazy(() => import('./components/PetPhotoAdditionFlow').then((module) => ({ default: module.PetPhotoAdditionFlow })));

type PreparedVisit = {
  petId: string;
  photoIntent?: 'collect' | 'replay';
  ownerPhoto?: boolean;
  method?: UnlockMethod;
  adSessionId?: string;
  requestId?: string;
  characterOnlyReason?: Extract<PetAccessDecision, { kind: 'characterOnly' }>['reason'];
};

type PhotoAccessKind = 'ownerPhoto' | 'revisit' | 'album' | 'initial';
type PhotoReturnMode = 'overlay' | 'home';

const HOUSE_SWR_MS = 5 * 60_000;
const HOME_HINT_STORAGE_KEY = 'cute-enough:home-hint-seen:v2';
const COMPLETION_TOAST_STORAGE_PREFIX = 'cute-enough:completion-toast:';

const screenFallback = <main className="screen-loading" aria-live="polite">화면을 준비하고 있어요…</main>;

function PhotoCardFallback({ onClose }: { onClose: () => void }) {
  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true" aria-label="강아지 실사 사진">
      <article className="photo-card">
        <header className="photo-card-header photo-card-header--close-only">
          <button type="button" onClick={onClose} aria-label="사진 닫기">×</button>
        </header>
        <div className="photo-card-content"><div className="photo-media">
          <div className="photo-frame photo-skeleton" role="status" aria-live="polite">
            <span className="photo-skeleton-heart" aria-hidden="true">♡</span>
            <strong>사진 화면을 준비하고 있어요</strong>
          </div>
        </div></div>
      </article>
    </div>
  );
}

export default function App() {
  const initialSharedPetId = useMemo(() => getInitialSharedPetId(), []);
  const [routeStack, setRouteStackState] = useState<AppRoute[]>(() => createInitialRouteStack(initialSharedPetId));
  const routeStackRef = useRef(routeStack);
  const uploadDiscardDestinationRef = useRef<'back' | 'home'>('back');
  const route = getCurrentRoute(routeStack);
  const screen = route.screen;
  const sharedPetId = route.screen === 'shared' ? route.petId : undefined;
  const [pets, setPets] = useState<PetSummary[]>([]);
  const [ownerBonusPet, setOwnerBonusPet] = useState<PetSummary>();
  const [dailyProgress, setDailyProgress] = useState<HouseResult['dailyProgress']>();
  const [selected, setSelected] = useState<PetSummary>();
  const publicationCache = useRef(createPetPublicationCache()).current;
  const [allowance, setAllowance] = useState<DailyAllowance>(() => readAllowance());
  const allowanceRef = useRef(allowance);
  const confirmedAllowanceRef = useRef<DailyAllowance>();
  const allowanceRevisionRef = useRef(0);
  const rewardSnapshotAtRef = useRef(0);
  const [rechargeClock, setRechargeClock] = useState(() => new Date());
  const serverOffsetRef = useRef(0);
  const [photoUrl, setPhotoUrl] = useState<string>();
  const photoUrlRef = useRef(photoUrl);
  const photoExpiresAtRef = useRef<string>();
  const [photoOpen, setPhotoOpen] = useState(false);
  const photoOpenRef = useRef(false);
  const [photoLoading, setPhotoLoading] = useState(false);
  const [photoLoadError, setPhotoLoadError] = useState('');
  const [photoAccessExpired, setPhotoAccessExpired] = useState(false);
  const [photoCaption, setPhotoCaption] = useState<string>();
  const [photoAccessKind, setPhotoAccessKind] = useState<PhotoAccessKind>();
  const [photoReturnMode, setPhotoReturnMode] = useState<PhotoReturnMode>('overlay');
  const photoReturnModeRef = useRef<PhotoReturnMode>('overlay');
  const [preparedVisit, setPreparedVisit] = useState<PreparedVisit>();
  const [adPromptPet, setAdPromptPet] = useState<PetSummary>();
  const [adPickerOpen, setAdPickerOpen] = useState(false);
  const adPickerOpenRef = useRef(false);
  const [adError, setAdError] = useState('');
  const adPromptPetRef = useRef<PetSummary>();
  const adCreditsRef = useRef(new Map<string, string>());
  const earnedAdCompletionsRef = useRef(new Map<string, Extract<RewardRecoveryJob, { kind: 'adComplete' }>>());
  const adAbortRef = useRef<AbortController>();
  const shareAbortRef = useRef<AbortController>();
  const [shareBusy, setShareBusy] = useState(false);
  const shareBusyRef = useRef(false);
  const [rewardCapabilities, setRewardCapabilities] = useState<RewardCapabilities>({ ads: false, share: false });
  const rewardCapabilitiesRef = useRef<RewardCapabilities>({ ads: false, share: false });
  const [rewardCredits, setRewardCredits] = useState<AdRewardCredit[]>([]);
  const [rebindSessionId, setRebindSessionId] = useState<string>();
  const [notificationSettings, setNotificationSettings] = useState<RechargeNotificationSettings>({ enabled: false, available: false });
  const [notificationBusy, setNotificationBusy] = useState(false);
  const notificationBusyRef = useRef(false);
  const notificationAbortRef = useRef<AbortController>();
  const recoveryRef = useRef<Promise<void>>();
  const [ticketPromptPet, setTicketPromptPet] = useState<PetSummary>();
  const ticketPromptPetRef = useRef<PetSummary>();
  const rewardPromptSourceRef = useRef<'house' | 'shared' | 'mine'>('house');
  const [adStatus, setAdStatus] = useState<RewardedAdStatus>(getRewardedAdStatus);
  const [toast, setToastText] = useState('');
  const [toastEventId, setToastEventId] = useState(0);
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const [houseLoading, setHouseLoading] = useState(!initialSharedPetId);
  const [houseError, setHouseError] = useState(false);
  const [houseRestartRequired, setHouseRestartRequired] = useState(false);
  const [soundEnabled] = useState(readSoundEnabled);
  const [sharedError, setSharedError] = useState('');
  const [submittedPet, setSubmittedPet] = useState<PetSummary>();
  const [myPets, setMyPets] = useState<OwnedPetSummary[]>([]);
  const [myPetsLoading, setMyPetsLoading] = useState(false);
  const [myPetsError, setMyPetsError] = useState('');
  const [albumFilter, setAlbumFilter] = useState<'all' | 'favorites'>('all');
  const albumFilterRef = useRef<'all' | 'favorites'>('all');
  const [album, setAlbum] = useState<AlbumResult>({ pets: [], legacyGiftCount: 0 });
  const [albumLoading, setAlbumLoading] = useState(false);
  const [albumLoadingMore, setAlbumLoadingMore] = useState(false);
  const [albumError, setAlbumError] = useState('');
  const albumCacheRef = useRef(new Map<string, { result: AlbumResult; loadedAt: number }>());
  const albumGenerationRef = useRef(0);
  const albumAbortRef = useRef<AbortController>();
  const [gallery, setGallery] = useState<AlbumPetSummary['unlockedPhotos']>([]);
  const [photoId, setPhotoId] = useState<string>();
  const photoIdRef = useRef<string>();
  const photoGenerationRef = useRef(0);
  const photoPreparationRef = useRef<PhotoPreparation>();
  const playCompletionRef = useRef<{ requestId: string; petId: string; generation: number }>();
  const photoFeedbackGenerationRef = useRef(-1);
  const [favoritePending, setFavoritePending] = useState(false);
  const favoritePendingRef = useRef(false);
  const housePositionsRef = useRef<Record<string, Record<string, { x: number; y: number }>>>({});
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

  async function loadHouse(replaceInFlight = false) {
    if (houseLoadingRef.current && !houseAbortRef.current?.signal.aborted) {
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
      if (requestController.signal.aborted || requestGeneration !== houseGenerationRef.current) return;
      setHouseRestartRequired(false);
      synchronizePetPublications([...(value.dailyPets ?? value.pets), ...(value.ownerBonusPet ? [value.ownerBonusPet] : [])]);
      setPets((value.dailyPets ?? value.pets).map(publicationCache.apply));
      setOwnerBonusPet(value.ownerBonusPet ? publicationCache.apply(value.ownerBonusPet) : undefined);
      setDailyProgress(value.dailyProgress);
      synchronizeServerClock(value.serverNow);
      if (value.rewardStatus) applyRewardStatus(value.rewardStatus);
      if (value.allowance) {
        if (!value.rewardStatus) applyServerAllowance(value.allowance);
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
      if (requestController.signal.aborted || requestGeneration !== houseGenerationRef.current) return;
      if (error instanceof Error && 'code' in error && error.code === 'REQUEST_CANCELLED') return;
      setHouseError(true);
      setHouseRestartRequired(error instanceof Error && 'code' in error
        && ['CLIENT_RESTART_REQUIRED', 'CLIENT_UPDATE_REQUIRED'].includes(String(error.code)));
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
    allowanceRevisionRef.current += 1;
    confirmedAllowanceRef.current = next;
    allowanceRef.current = next;
    setAllowance(next);
    saveAllowance(next);
  }

  function applyRewardStatus(status: RewardStatus) {
    const timestamp = Date.parse(status.serverNow ?? '');
    if (Number.isFinite(timestamp)) {
      if (timestamp < rewardSnapshotAtRef.current) return;
      rewardSnapshotAtRef.current = timestamp;
    }
    synchronizeServerClock(status.serverNow);
    applyServerAllowance(status.allowance);
    rewardCapabilitiesRef.current = status.capabilities;
    setRewardCapabilities(status.capabilities);
    setRewardCredits(status.adCredits);
    adCreditsRef.current = new Map(status.adCredits.filter((credit) => !credit.canRebind).map((credit) => [credit.petId, credit.sessionId]));
  }

  function synchronizeServerClock(serverNow?: string) {
    const timestamp = Date.parse(serverNow ?? '');
    if (!Number.isFinite(timestamp)) return;
    serverOffsetRef.current = timestamp - Date.now();
    setRechargeClock(new Date(timestamp));
  }

  function serverDate() { return new Date(Date.now() + serverOffsetRef.current); }

  function applyErrorAllowance(error: unknown) {
    if (error && typeof error === 'object' && 'serverNow' in error && typeof error.serverNow === 'string') {
      synchronizeServerClock(error.serverNow);
    }
    if (error && typeof error === 'object' && 'allowance' in error && error.allowance) {
      applyServerAllowance(error.allowance as DailyAllowance);
    }
  }

  function isExpiredPhotoError(error: unknown): boolean {
    return Boolean(error && typeof error === 'object' && 'code' in error
      && ['PET_REVISIT_EXPIRED', 'REVEAL_REQUEST_EXPIRED', 'ALBUM_PET_NOT_TODAY', 'PET_NOT_ASSIGNED_TODAY'].includes(String(error.code)));
  }

  function recoverRewards(): Promise<void> {
    if (recoveryRef.current) return recoveryRef.current;
    const run = async () => {
      // Native completion is remembered before any storage write. Even when
      // persistence fails, preserve the earned session and attempt server recovery.
      for (const completion of earnedAdCompletionsRef.current.values()) {
        if (readRewardRecovery().some((job) => job.kind === 'adComplete' && job.sessionId === completion.sessionId)) continue;
        try { enqueueRewardRecovery(completion); }
        catch {
          try { applyRewardStatus(await completeAdReward(completion.sessionId)); }
          catch (error) { applyErrorAllowance(error); }
          // Keep the in-memory guard until durable marker cleanup succeeds.
        }
      }
      // Resolve an unknown start with the SAME request ID, never by launching
      // another native ad. Persist a terminal recovery job before forgetting it.
      if (!adAbortRef.current) for (const pending of readPendingAdStarts()) {
        const jobs = readRewardRecovery();
        const knownSessionId = pending.phase === 'native' ? pending.sessionId : pending.requestId;
        if (earnedAdCompletionsRef.current.has(knownSessionId)) continue;
        if (jobs.some((job) => job.sessionId === knownSessionId && job.kind === 'adComplete')
          || [...adCreditsRef.current.values()].includes(knownSessionId)) {
          forgetPendingAdStart(pending.petId, pending.requestId);
          continue;
        }
        try {
          const status = pending.phase === 'starting' ? await startAdReward(pending.petId, pending.requestId) : undefined;
          if (status) applyRewardStatus(status);
          const sessionId = status?.sessionId ?? knownSessionId;
          if (earnedAdCompletionsRef.current.has(sessionId)) continue;
          if (!status?.adCredits.some((credit) => credit.sessionId === sessionId)
            && !readRewardRecovery().some((job) => job.sessionId === sessionId && job.kind === 'adComplete')) {
            enqueueRewardRecovery({ kind: 'adCancel', sessionId, requestId: crypto.randomUUID() });
          }
          forgetPendingAdStart(pending.petId, pending.requestId);
        } catch (error) {
          applyErrorAllowance(error);
          // Transport/server failures remain pending. A definitive rejection
          // must not prevent all future starts forever.
          const code = error && typeof error === 'object' && 'code' in error ? String(error.code) : '';
          if (['REWARDED_LIMIT_REACHED', 'PET_NOT_AVAILABLE', 'PHOTO_NOT_REVEALABLE', 'OWNER_PHOTO_FREE', 'ALBUM_ALL_PHOTOS_UNLOCKED', 'ALBUM_PET_NOT_TODAY',
            'DAILY_PHOTO_ALREADY_COLLECTED', 'FREE_ALLOWANCE_AVAILABLE', 'BONUS_ALLOWANCE_AVAILABLE', 'BONUS_TICKETS_AVAILABLE',
            'PET_REVISIT_ACTIVE', 'AD_REWARD_AVAILABLE'].includes(code)) {
            forgetPendingAdStart(pending.petId, pending.requestId);
          } else if (code === 'ADS_DISABLED' || code === 'REWARDED_ADS_DISABLED') {
            // A flag may reject replay before the server looks up an already
            // committed start. Its session ID is the original start request ID.
            if (earnedAdCompletionsRef.current.has(knownSessionId)) continue;
            if (readRewardRecovery().some((job) => job.sessionId === knownSessionId && job.kind === 'adComplete')
              || [...adCreditsRef.current.values()].includes(knownSessionId)) {
              forgetPendingAdStart(pending.petId, pending.requestId);
              continue;
            }
            try {
              const status = await cancelAdReward(pending.requestId);
              applyRewardStatus(status);
              forgetPendingAdStart(pending.petId, pending.requestId);
            } catch (cancelError) {
              applyErrorAllowance(cancelError);
              if (cancelError && typeof cancelError === 'object' && 'code' in cancelError && cancelError.code === 'AD_SESSION_NOT_FOUND') {
                forgetPendingAdStart(pending.petId, pending.requestId);
              }
              // An uncertain cancellation keeps the same ID for the next retry.
            }
          }
        }
      }
      for (const session of readActiveRewardSessions()) {
        if (session.kind === 'ad' && earnedAdCompletionsRef.current.has(session.sessionId)) continue;
        if ((session.kind === 'ad' && adAbortRef.current) || (session.kind === 'share' && shareAbortRef.current)) continue;
        const jobs = readRewardRecovery();
        const terminal = jobs.some((job) => job.sessionId === session.sessionId && job.kind !== 'shareReward');
        if (!terminal) {
          enqueueRewardRecovery(session.kind === 'ad'
            ? { kind: 'adCancel', sessionId: session.sessionId, requestId: crypto.randomUUID() }
            : { kind: 'shareClose', sessionId: session.sessionId, requestId: crypto.randomUUID(), summary: null });
        }
        forgetActiveRewardSession(session.sessionId);
      }
      for (const job of readRewardRecovery()) {
        if (job.kind === 'adCancel' && earnedAdCompletionsRef.current.has(job.sessionId)) continue;
        if (!canReplayRewardJob(job, readRewardRecovery())) continue;
        try {
          const status = job.kind === 'adComplete' ? await completeAdReward(job.sessionId)
            : job.kind === 'adCancel' ? await cancelAdReward(job.sessionId)
              : job.kind === 'shareReward' ? await recordShareReward(job.sessionId, job.requestId, job.rewardAmount, job.eventSequence)
                : await closeShareReward(job.sessionId, job.requestId, job.summary);
          applyRewardStatus(status);
          if (job.kind === 'adComplete') {
            for (const pending of readPendingAdStarts()) {
              if ((pending.phase === 'native' ? pending.sessionId : pending.requestId) === job.sessionId) {
                forgetPendingAdStart(pending.petId, pending.requestId);
              }
            }
            forgetActiveRewardSession(job.sessionId);
          }
          acknowledgeRewardRecovery(job.requestId);
          if (job.kind === 'adComplete') earnedAdCompletionsRef.current.delete(job.sessionId);
          if ('reconciliationRequired' in status && status.reconciliationRequired) {
            setToast('공유 결과를 확인하고 있어요. 확인된 티켓은 그대로 보관돼요.');
          }
        } catch (error) { applyErrorAllowance(error); }
      }
      const revision = allowanceRevisionRef.current;
      try {
        const status = await fetchRewardStatus();
        if (revision === allowanceRevisionRef.current) applyRewardStatus(status);
      } catch { /* Keep confirmed balances during temporary outages. */ }
    };
    recoveryRef.current = run().catch((error) => {
      setToast(error instanceof Error ? error.message : '보상 기록을 다시 확인하지 못했어요. 앱을 다시 열어 주세요.');
    }).finally(() => { recoveryRef.current = undefined; });
    return recoveryRef.current;
  }

  /** 공개/재열람 결과가 어느 화면에서 시작됐든 모든 로컬 강아지 캐시를 같이 갱신한다. */
  function synchronizePetPublications(incoming: PetSummary[]) {
    incoming.forEach(publicationCache.ingest);
    const apply = publicationCache.apply;
    const refreshPrompt = (current?: PetSummary) => current
      ? apply({ ...current, ...incoming.find((pet) => pet.id === current.id) }) : undefined;
    adPromptPetRef.current = refreshPrompt(adPromptPetRef.current);
    ticketPromptPetRef.current = refreshPrompt(ticketPromptPetRef.current);
    setAdPromptPet(adPromptPetRef.current);
    setTicketPromptPet(ticketPromptPetRef.current);
    setSelected((current) => current ? apply(current) : current);
    setPets((current) => current.map(apply));
    setOwnerBonusPet((current) => current ? apply(current) : current);
    // Keep the full upload history; house/album responses never replace this list.
    setMyPets((current) => current.map(apply));
    setSubmittedPet((current) => current ? apply(current) : current);
    setAlbum((current) => ({ ...current, pets: current.pets.map(apply) }));
    for (const [key, cached] of albumCacheRef.current) {
      albumCacheRef.current.set(key, { ...cached, result: { ...cached.result, pets: cached.result.pets.map(apply) } });
    }
  }

  function patchPetCaches(petId: string, patch: Partial<PetSummary>) {
    const merge = <T extends PetSummary>(pet: T): T => (
      pet.id === petId ? { ...pet, ...patch } : pet
    );
    if (adPromptPetRef.current) { adPromptPetRef.current = merge(adPromptPetRef.current); setAdPromptPet(adPromptPetRef.current); }
    if (ticketPromptPetRef.current) { ticketPromptPetRef.current = merge(ticketPromptPetRef.current); setTicketPromptPet(ticketPromptPetRef.current); }
    setSelected((current) => current ? merge(current) : current);
    setPets((current) => current.map(merge));
    setOwnerBonusPet((current) => current ? merge(current) : current);
    setMyPets((current) => current.map((pet) => merge(pet)));
    setAlbum((current) => ({ ...current, pets: current.pets.map(merge) }));
    for (const [key, cached] of albumCacheRef.current) {
      albumCacheRef.current.set(key, { ...cached, result: { ...cached.result, pets: cached.result.pets.map(merge) } });
    }
  }

  function invalidateAlbum() {
    albumGenerationRef.current += 1;
    albumAbortRef.current?.abort();
    albumCacheRef.current.clear();
  }

  async function loadAlbum(filter: 'all' | 'favorites' = albumFilterRef.current, more = false, force = false) {
    albumFilterRef.current = filter;
    setAlbumFilter(filter);
    // Even a cache hit replaces the previous filter's in-flight request.
    albumAbortRef.current?.abort();
    const generation = ++albumGenerationRef.current;
    const cached = albumCacheRef.current.get(filter);
    if (!more && !force && cached && Date.now() - cached.loadedAt < HOUSE_SWR_MS) {
      setAlbum({ ...cached.result, pets: cached.result.pets.map(publicationCache.apply) }); setAlbumError('');
      setAlbumLoading(false); setAlbumLoadingMore(false);
      return;
    }
    const controller = new AbortController();
    albumAbortRef.current = controller;
    const previous = more ? album : cached?.result;
    if (!more) setAlbum(previous ?? { pets: [], legacyGiftCount: 0 });
    setAlbumLoading(!more && !previous?.pets.length);
    setAlbumLoadingMore(more);
    setAlbumError('');
    try {
      const result = await fetchAlbum(filter === 'favorites', more ? previous?.nextCursor : undefined, controller.signal);
      if (generation !== albumGenerationRef.current) return;
      synchronizePetPublications(result.pets);
      result.pets = result.pets.map(publicationCache.apply);
      const combined = more ? { ...result, pets: [...(previous?.pets ?? []), ...result.pets].filter((pet, index, all) => all.findIndex((other) => other.id === pet.id) === index) } : result;
      setAlbum(combined);
      albumCacheRef.current.set(filter, { result: combined, loadedAt: Date.now() });
      if (result.legacyGiftCount > 0) {
        try {
          const key = 'cute-enough:album-gift-notice:v1';
          if (!localStorage.getItem(key)) { localStorage.setItem(key, '1'); setToast('전에 만난 친구들의 대표 사진을 선물로 담았어요'); }
        } catch { /* Notice is optional; album rights live on the server. */ }
      }
    } catch (error) {
      if (generation !== albumGenerationRef.current) return;
      setAlbumError(error instanceof Error ? error.message : '앨범을 불러오지 못했어요.');
    } finally {
      if (generation === albumGenerationRef.current) { setAlbumLoading(false); setAlbumLoadingMore(false); }
    }
  }

  function openAlbum() {
    navigateTo({ screen: 'album' });
    void loadAlbum();
  }

  async function changeFavorite(isFavorite: boolean) {
    if (!selected || favoritePendingRef.current) return;
    const pet = selected;
    favoritePendingRef.current = true; setFavoritePending(true);
    // Do not let a previously started list response undo this local change.
    invalidateHouseSnapshot(); invalidateAlbum();
    sharedGenerationRef.current += 1;
    sharedAbortRef.current?.abort();
    patchPetCaches(pet.id, { isFavorite });
    try {
      const result = await setPetFavorite(pet, isFavorite);
      patchPetCaches(pet.id, { isFavorite: result.isFavorite });
      setToast(result.isFavorite ? '마음에 담았어요' : '마음에 담은 친구에서 해제했어요');
    } catch (error) {
      patchPetCaches(pet.id, { isFavorite: Boolean(pet.isFavorite) });
      setToast(error instanceof Error ? error.message : '마음에 담기를 다시 시도해 주세요.');
    } finally {
      favoritePendingRef.current = false; setFavoritePending(false);
      if (getCurrentRoute(routeStackRef.current).screen === 'album') void loadAlbum(albumFilter, false, true);
    }
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
      synchronizePetPublications(next);
      setMyPets(next.map(publicationCache.apply));
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
      synchronizePetPublications([result.pet]);
      setSelected(publicationCache.apply(result.pet));
      if (result.allowance && !result.rewardStatus) applyServerAllowance(result.allowance);
      synchronizeServerClock(result.serverNow);
      if (result.rewardStatus) applyRewardStatus(result.rewardStatus);
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
    if (screen !== 'album') return;
    const refresh = () => { if (!document.hidden && !favoritePendingRef.current) void loadAlbum(albumFilter, false, true); };
    const expiry = window.setTimeout(() => { if (!document.hidden) void loadAlbum(albumFilter); }, HOUSE_SWR_MS);
    window.addEventListener('focus', refresh);
    document.addEventListener('visibilitychange', refresh);
    return () => { window.clearTimeout(expiry); window.removeEventListener('focus', refresh); document.removeEventListener('visibilitychange', refresh); };
  }, [screen, albumFilter]);
  useEffect(() => {
    const onVisible = () => { if (!document.hidden) void recoverRewards(); };
    onVisible();
    void fetchRechargeNotificationSettings().then(setNotificationSettings).catch(() => undefined);
    window.addEventListener('focus', onVisible);
    window.addEventListener('pageshow', onVisible);
    window.addEventListener('online', onVisible);
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      shareAbortRef.current?.abort();
      notificationAbortRef.current?.abort();
      window.removeEventListener('focus', onVisible);
      window.removeEventListener('pageshow', onVisible);
      window.removeEventListener('online', onVisible);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, []);
  useEffect(() => {
    const pending = screen === 'shared' ? selected?.approvalStatus === 'pending'
      : screen === 'mine' ? myPets.some((pet) => pet.approvalStatus === 'pending')
        : screen === 'home' && ownerBonusPet?.approvalStatus === 'pending';
    if (!pending) return;
    const timer = window.setInterval(() => {
      if (document.hidden || busyRef.current) return;
      if (screen === 'shared' && sharedPetId) void loadSharedPet(sharedPetId);
      else if (screen === 'mine') void refreshMyPets();
      else void loadHouse();
    }, 30_000);
    return () => window.clearInterval(timer);
  }, [screen, sharedPetId, selected?.approvalStatus, myPets, ownerBonusPet?.approvalStatus]);
  useEffect(() => {
    if (screen !== 'play' || selected?.approvalStatus !== 'pending') return;
    const petId = selected.id;
    let active = true;
    let request: AbortController | undefined;
    const refresh = async () => {
      if (!active || document.hidden || busyRef.current || request) return;
      const controller = new AbortController(); request = controller;
      try {
        const result = await fetchSharedPet(petId, controller.signal);
        if (active && !controller.signal.aborted) synchronizePetPublications([result.pet]);
      } catch { /* Keep playing the existing draft; retry on the next visible check. */ }
      finally { if (request === controller) request = undefined; }
    };
    const timer = window.setInterval(() => void refresh(), 30_000);
    const onVisible = () => { if (!document.hidden) void refresh(); };
    window.addEventListener('focus', onVisible);
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      active = false; request?.abort(); window.clearInterval(timer);
      window.removeEventListener('focus', onVisible);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [screen, selected?.id, selected?.approvalStatus]);
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
    // A remounted effect (including development StrictMode) must be able to load
    // again; late responses from the cancelled lifetime cannot replace it.
    houseGenerationRef.current += 1;
    mineGenerationRef.current += 1;
    sharedGenerationRef.current += 1;
    houseLoadingRef.current = false;
    photoGenerationRef.current += 1;
    photoPreparationRef.current?.dispose();
  }, []);
  useEffect(() => {
    const suspendSpeculation = () => {
      if (!document.hidden || playCompletionRef.current) return;
      photoPreparationRef.current?.dispose();
      photoPreparationRef.current = undefined;
    };
    document.addEventListener('visibilitychange', suspendSpeculation);
    return () => document.removeEventListener('visibilitychange', suspendSpeculation);
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
  useEffect(() => { ticketPromptPetRef.current = ticketPromptPet; }, [ticketPromptPet]);
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
    setRechargeClock(serverDate());
    if (!allowance.nextChargeAt) return undefined;
    const timer = window.setInterval(() => setRechargeClock(serverDate()), RECHARGE_COPY_REFRESH_MS);
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
  useEffect(() => subscribeNativeNavigation({ onBack: navigateBack, onHome: navigateHome }), []);
  useEffect(() => subscribeSafeArea(), []);
  useEffect(() => {
    const unsubscribe = subscribeRewardedAdStatus(setAdStatus);
    const prepare = () => {
      if (!document.hidden && rewardedAdsEnabled && !adAbortRef.current) void preloadRewardedAd().catch(() => undefined);
    };
    prepare();
    window.addEventListener('focus', prepare);
    document.addEventListener('visibilitychange', prepare);
    return () => {
      window.removeEventListener('focus', prepare);
      document.removeEventListener('visibilitychange', prepare);
      unsubscribe();
      adAbortRef.current?.abort();
    };
  }, []);
  useEffect(() => {
    let rechargeTimer: number | undefined;
    const refreshFreeAllowance = async () => {
      if (document.hidden || !isAllowanceForToday(allowanceRef.current)) return;
      const current = allowanceRef.current;
      const refreshed = refreshAllowance(current, serverDate());
      const changed = refreshed.remaining !== current.remaining
        || refreshed.nextChargeAt !== current.nextChargeAt;
      if (!changed) return;
      await loadHouse(true);
    };
    const delay = millisecondsUntilNextFreeRecharge(allowance, serverDate());
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
    () => regularRemainingCount(allowance, rechargeClock),
    [allowance, rechargeClock],
  );
  const bonusTickets = bonusRemainingCount(allowance);
  const adsAvailable = rewardedAdsEnabled && rewardCapabilities.ads;
  const shareAvailable = rewardCapabilities.share && supportsShareReward();
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
    const source = serverProgress ?? previous;
    const sourceMetPetIds = source.metPetIds.includes(pet.id)
      ? source.metPetIds
      : [...source.metPetIds, pet.id];
    const next = normalizeDailyProgress(
      { ...source, metPetIds: sourceMetPetIds },
      pets,
      source.date || allowance.date,
    );
    setDailyProgress(next);
    if (!previous.completed && next.completed) {
      completionPendingDateRef.current = next.date;
    }
    return next;
  }

  function enterPlay(pet: PetSummary, visit: PreparedVisit, playGreeting = true) {
    clearPhotoPreparation();
    if (playGreeting) playSound('bark', getPetSoundVariant(pet.id));
    setSelected(pet);
    const prepared = { photoIntent: 'collect' as const, ...visit, requestId: visit.requestId ?? crypto.randomUUID() };
    setPreparedVisit(prepared);
    navigateTo({ screen: 'play', petId: pet.id });
    photoUrlRef.current = undefined;
    setPhotoUrl(undefined);
    photoOpenRef.current = false;
    setPhotoOpen(false);
    setPhotoLoadError('');
  }

  function clearPhotoPreparation() {
    photoPreparationRef.current?.dispose();
    photoPreparationRef.current = undefined;
    playCompletionRef.current = undefined;
  }

  function startPlayPhotoPreparation() {
    if (!selected || !preparedVisit || preparedVisit.characterOnlyReason || !preparedVisit.requestId) return;
    void loadRevealCard().catch(() => undefined);
    if (!preparedVisit.ownerPhoto && preparedVisit.photoIntent !== 'replay') return;
    const pet = selected;
    const visit = preparedVisit;
    if (!photoPreparationRef.current || photoPreparationRef.current.requestId !== visit.requestId) {
      photoPreparationRef.current?.dispose();
      photoPreparationRef.current = createPhotoPreparation(pet.id, visit.requestId!);
    }
    photoPreparationRef.current.prefetch((signal) => preparePetPhoto(pet, visit.requestId!, visit.ownerPhoto ? 'owner' : 'replay', signal));
  }

  function beginPlayCompletion(method: PetInteractionMethod) {
    if (!selected || !preparedVisit?.requestId || preparedVisit.characterOnlyReason || busyRef.current || playCompletionRef.current) return;
    // The third accepted gesture commits once, while its last reaction is still playing.
    playCompletionRef.current = { requestId: preparedVisit.requestId, petId: selected.id, generation: photoGenerationRef.current + 1 };
    void handleFed(undefined, undefined, true, method, true);
  }

  function finishPlayReaction(method: PetInteractionMethod) {
    const completion = playCompletionRef.current;
    if (!completion) { void handleFed(undefined, undefined, true, method); return; }
    const activeRoute = getCurrentRoute(routeStackRef.current);
    if (completion.generation !== photoGenerationRef.current || activeRoute.screen !== 'play' || activeRoute.petId !== completion.petId) return;
    photoOpenRef.current = true;
    setPhotoOpen(true);
    notifyPlayPhotoReady(preparedVisit?.method);
  }

  function notifyPlayPhotoReady(method?: UnlockMethod) {
    if (!photoOpenRef.current || !photoUrlRef.current || photoFeedbackGenerationRef.current === photoGenerationRef.current) return;
    photoFeedbackGenerationRef.current = photoGenerationRef.current;
    playSound('reveal');
    trackProductEvent('photo_reveal', { access_method: method });
  }

  async function openDirectPhoto(pet: PetSummary, kind: Exclude<PhotoAccessKind, 'initial'>, retry = false, requestedPhotoId?: string): Promise<boolean> {
    if (busyRef.current) return false;
    clearPhotoPreparation();
    busyRef.current = true;
    const generation = ++photoGenerationRef.current;
    setBusy(true);
    setSelected(pet);
    setPhotoAccessKind(kind);
    setPhotoOpen(true);
    photoOpenRef.current = true;
    setPhotoLoading(true);
    setPhotoCaption(undefined);
    setPhotoLoadError('');
    setPhotoAccessExpired(false);
    if (!retry) {
      setGallery('unlockedPhotos' in pet ? (pet as AlbumPetSummary).unlockedPhotos : []);
      setPhotoReturnMode('overlay');
      photoReturnModeRef.current = 'overlay';
      photoUrlRef.current = undefined;
      setPhotoUrl(undefined);
    }
    try {
      let nextPhotoUrl: string;
      let patch: Partial<PetSummary>;
      let nextProgress: DailyProgress | undefined;
      let nextPhotoId: string | undefined;
      if (kind === 'ownerPhoto') {
        const result = await openOwnerPhoto(pet);
        if (generation !== photoGenerationRef.current) return false;
        nextPhotoId = result.photoId;
        setPhotoCaption(result.photoCaption);
        photoExpiresAtRef.current = result.signedUrlExpiresAt;
        nextPhotoUrl = result.photoUrl;
        patch = { ownerPhotoAvailable: result.ownerPhotoAvailable };
      } else {
        const targetPhotoId = requestedPhotoId ?? (retry ? photoIdRef.current : undefined) ?? pet.albumPhotoId;
        if (targetPhotoId) { photoIdRef.current = targetPhotoId; setPhotoId(targetPhotoId); }
        const result = kind === 'album' && targetPhotoId ? await openAlbumPhoto(targetPhotoId, pet) : await reopenPet(pet);
        if (generation !== photoGenerationRef.current) return false;
        nextPhotoId = result.photoId;
        setPhotoCaption(result.photoCaption);
        photoExpiresAtRef.current = result.signedUrlExpiresAt;
        if (result.rewardStatus) applyRewardStatus(result.rewardStatus);
        else applyServerAllowance(result.allowance);
        nextPhotoUrl = result.photoUrl;
        nextProgress = result.dailyProgress;
        patch = {
          ...(result.photoId ? albumPhotoMetadata(result) : {}),
          revisitUntil: result.revisitUntil ?? pet.revisitUntil,
          revealedToday: true,
        };
      }
      photoIdRef.current = nextPhotoId; setPhotoId(nextPhotoId);
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
      if (generation !== photoGenerationRef.current) return false;
      applyErrorAllowance(error);
      const message = error instanceof Error ? error.message : '사진을 다시 열지 못했어요.';
      setPhotoAccessExpired(isExpiredPhotoError(error));
      setPhotoLoadError(message);
      setToast(message);
      return false;
    } finally {
      if (generation === photoGenerationRef.current) {
        setPhotoLoading(false); busyRef.current = false; setBusy(false);
      }
    }
  }

  function closeAdPicker() {
    adPickerOpenRef.current = false;
    setAdPickerOpen(false);
  }

  function openAdPicker() {
    if (busyRef.current || shareBusyRef.current) return;
    adPickerOpenRef.current = true;
    setAdPickerOpen(true);
    trackProductEvent('rewarded_ad_entry', { source: 'home' });
    void recoverRewards();
  }

  function choosePet(pet: PetSummary, source: 'house' | 'shared' | 'mine' = 'house', confirmedAccess?: PetAccessDecision) {
    pet = publicationCache.apply(pet);
    dismissHomeHint();
    if (busyRef.current || shareBusyRef.current) return;
    if (rebindSessionId) {
      if (pet.isMine || pet.approvalStatus !== 'approved' || (pet.collection ? !pet.collection.canCollectToday : isPetRevisitActive(pet, serverDate()))) {
        setToast('사진을 새로 만날 공개 친구를 골라 주세요.');
        return;
      }
      busyRef.current = true;
      setBusy(true);
      const sessionId = rebindSessionId;
      void rebindAdReward(sessionId, pet.id).then((status) => {
        applyRewardStatus(status);
        setRebindSessionId(undefined);
        enterPlay(pet, { petId: pet.id, method: 'REWARDED', adSessionId: sessionId });
      }).catch((error) => {
        applyErrorAllowance(error);
        setToast(error instanceof Error ? error.message : '보상을 옮기지 못했어요. 다시 선택해 주세요.');
      }).finally(() => { busyRef.current = false; setBusy(false); });
      return;
    }
    const access = confirmedAccess ?? resolvePetEncounter(pet, allowanceRef.current, {
      source: source === 'shared' ? 'shared' : 'house', adsEnabled: adsAvailable,
      hasAdCredit: adCreditsRef.current.has(pet.id), now: serverDate(),
    });
    trackProductEvent('pet_select', { access_kind: access.kind });
    if (access.kind === 'ownerPhoto') {
      if (source === 'mine') void openDirectPhoto(pet, 'ownerPhoto');
      else enterPlay(pet, { petId: pet.id, ownerPhoto: true, photoIntent: 'replay' });
      return;
    }
    if (access.kind === 'revisit') {
      if (source !== 'house') void openDirectPhoto(pet, pet.albumPhotoId ? 'album' : 'revisit');
      else enterPlay(pet, { petId: pet.id, photoIntent: 'replay' });
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
    const existingCredit = adCreditsRef.current.get(pet.id);
    if (existingCredit) {
      enterPlay(pet, { petId: pet.id, method: 'REWARDED', adSessionId: existingCredit });
      return;
    }
    if (access.kind === 'exhausted') {
      rewardPromptSourceRef.current = source;
      ticketPromptPetRef.current = pet;
      setTicketPromptPet(pet);
      return;
    }
    const method = access.method;
    if (method === 'REWARDED') {
      setAdError('');
      playSound('bark', getPetSoundVariant(pet.id));
      setSelected(pet);
      rewardPromptSourceRef.current = source;
      adPromptPetRef.current = pet;
      setAdPromptPet(pet);
      if (['idle', 'error', 'unsupported'].includes(adStatus)) void preloadRewardedAd().catch((error) => setAdError(error instanceof Error ? error.message : '광고를 준비하지 못했어요. 다시 시도해 주세요.'));
      return;
    }
    enterPlay(pet, { petId: pet.id, method });
  }

  function confirmedPromptAccess(pet: PetSummary): PetAccessDecision {
    const confirmed = confirmedAllowanceRef.current;
    // Countdown projections are useful on home, but a prompt must not announce
    // a grant until the server has returned a spendable balance or photo right.
    const balance = confirmed ?? { ...allowanceRef.current, remaining: 0, freeUsed: 2, bonusTickets: 0, uploadCredit: false };
    return resolvePetEncounter(publicationCache.apply(pet), { ...balance, nextChargeAt: undefined }, {
      source: rewardPromptSourceRef.current === 'shared' ? 'shared' : 'house',
      adsEnabled: false, hasAdCredit: adCreditsRef.current.has(pet.id), now: serverDate(),
    });
  }

  function continueRewardPrompt(): boolean {
    if (busyRef.current || shareBusyRef.current || adAbortRef.current) return false;
    const pet = adPromptPetRef.current ?? ticketPromptPetRef.current;
    if (!pet) return false;
    const access = confirmedPromptAccess(pet);
    if (access.kind === 'exhausted') return false;
    adPromptPetRef.current = undefined;
    ticketPromptPetRef.current = undefined;
    setAdPromptPet(undefined);
    setTicketPromptPet(undefined);
    choosePet(pet, rewardPromptSourceRef.current, access);
    return true;
  }

  function closeTicketPrompt() {
    ticketPromptPetRef.current = undefined;
    setTicketPromptPet(undefined);
  }

  function updateRouteStack(next: AppRoute[]) {
    const previousRoute = getCurrentRoute(routeStackRef.current);
    const nextRoute = getCurrentRoute(next);
    if (previousRoute.screen === 'play' && (nextRoute.screen !== 'play' || nextRoute.petId !== previousRoute.petId)) {
      photoGenerationRef.current += 1;
      clearPhotoPreparation();
      busyRef.current = false; setBusy(false);
    }
    routeStackRef.current = next;
    setRouteStackState(next);
  }

  function navigateTo(next: AppRoute) {
    updateRouteStack(pushRoute(routeStackRef.current, next));
  }

  function navigateBack() {
    if (adPickerOpenRef.current) { closeAdPicker(); return; }
    if (ticketPromptPetRef.current) { ticketPromptPetRef.current = undefined; setTicketPromptPet(undefined); return; }
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
    const editingPhotos = ['upload', 'add-photos'].includes(getCurrentRoute(routeStackRef.current).screen);
    if (editingPhotos && uploadSubmissionBusyRef.current) {
      setToast('사진 등록 결과를 확인하고 있어요. 잠시만 기다려 주세요.');
      return;
    }
    if (editingPhotos && uploadDraftDirtyRef.current) {
      uploadDiscardDestinationRef.current = 'back';
      uploadDiscardOpenRef.current = true;
      setUploadDiscardOpen(true);
      return;
    }
    popCurrentRoute();
  }

  function navigateHome() {
    // Do not abandon an additional-photo request whose server outcome is unknown.
    if (getCurrentRoute(routeStackRef.current).screen === 'add-photos') {
      if (uploadSubmissionBusyRef.current) {
        setToast('사진 등록 결과를 확인하고 있어요. 잠시만 기다려 주세요.');
        return;
      }
      if (uploadDraftDirtyRef.current) {
        uploadDiscardDestinationRef.current = 'home';
        uploadDiscardOpenRef.current = true;
        setUploadDiscardOpen(true);
        return;
      }
    }
    goHome();
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
    if (nextScreen === 'mine' && (mineNeedsRefreshRef.current || Date.now() - lastMineLoadedAtRef.current >= 60_000)) void refreshMyPets();
    if (nextScreen === 'home') {
      setSelected(undefined);
      setPreparedVisit(undefined);
      if (houseNeedsRefreshRef.current || houseLoadedDateRef.current !== getKstDate()
        || Date.now() - lastHouseLoadedAtRef.current >= HOUSE_SWR_MS) void loadHouse(true);
    }
  }

  function goHome() {
    clearPhotoPreparation();
    closeAdPicker();
    photoGenerationRef.current += 1;
    photoIdRef.current = undefined; setPhotoId(undefined);
    busyRef.current = false; setBusy(false);
    adAbortRef.current?.abort();
    adPromptPetRef.current = undefined;
    setAdPromptPet(undefined);
    closeTicketPrompt();
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
    setAdError('');
  }

  async function confirmRewardedVisit() {
    const pet = adPromptPetRef.current;
    if (!pet || busyRef.current || shareBusyRef.current || adAbortRef.current) return;
    if (continueRewardPrompt()) return;
    if (adStatus !== 'loaded') {
      setAdError('');
      void preloadRewardedAd().catch((error) => setAdError(error instanceof Error ? error.message : '광고를 준비하지 못했어요. 다시 시도해 주세요.'));
      return;
    }

    busyRef.current = true;
    setBusy(true);
    setToast('');
    setAdError('');
    const abort = new AbortController();
    let sessionId: string | undefined;
    let startRequestId: string | undefined;
    let earned = false;
    let continueWithConfirmedAccess = false;
    try {
      await recoverRewards();
      if (readPendingAdStarts().length > 0) throw new Error('이전 광고 요청을 확인하고 있어요. 연결을 확인한 뒤 다시 눌러 주세요.');
      if (abort.signal.aborted || adPromptPetRef.current?.id !== pet.id) return;
      if (confirmedPromptAccess(adPromptPetRef.current).kind !== 'exhausted') {
        continueWithConfirmedAccess = true;
        return;
      }
      if (!rewardedAdsEnabled || !rewardCapabilitiesRef.current.ads) {
        setToast('광고 만남은 잠시 준비 중이에요.');
        return;
      }
      assertRewardStorage();
      const pending = rememberPendingAdStart(pet.id);
      startRequestId = pending.requestId;
      // Mark active before the request, so focus recovery cannot cancel this
      // same request while native UI is about to open.
      adAbortRef.current = abort;
      await suspendSound();
      const session = await startAdReward(pet.id, pending.requestId);
      sessionId = session.sessionId;
      markPendingAdStartNative(pet.id, pending.requestId, session.sessionId);
      rememberActiveRewardSession({ kind: 'ad', sessionId: session.sessionId });
      applyRewardStatus(session);
      if (abort.signal.aborted || adPromptPetRef.current?.id !== pet.id) throw new DOMException('광고 요청이 취소됐어요.', 'AbortError');
      await showRewardedAd(abort.signal, () => {
        earned = true;
        const completion = { kind: 'adComplete' as const, requestId: `ad-complete:${session.sessionId}`, sessionId: session.sessionId, petId: pet.id };
        earnedAdCompletionsRef.current.set(session.sessionId, completion);
        enqueueRewardRecovery(completion);
        forgetPendingAdStart(pet.id, pending.requestId);
        forgetActiveRewardSession(session.sessionId);
        void recoverRewards();
      });
      if (!earned) throw new Error('광고 완료 결과를 확인하지 못했어요.');
      await recoverRewards();
      if (readRewardRecovery().some((job) => job.kind === 'adComplete' && job.sessionId === session.sessionId)) await recoverRewards();
      // A confirmed reward survives cancellation, but a closed prompt must not
      // reopen play when the native dismissal/recovery arrives late.
      if (abort.signal.aborted || adPromptPetRef.current?.id !== pet.id) return;
      adPromptPetRef.current = undefined;
      setAdPromptPet(undefined);
      if (!adCreditsRef.current.has(pet.id)) {
        setToast('광고 보상을 저장하고 있어요. 연결되면 이 친구를 바로 만날 수 있어요.');
        return;
      }
      enterPlay(pet, { petId: pet.id, method: 'REWARDED', adSessionId: session.sessionId }, false);
      trackProductEvent('rewarded_ad_result', { result: 'rewarded' });
    } catch (error) {
      applyErrorAllowance(error);
      if (sessionId && !earned) {
        enqueueRewardRecovery({ kind: 'adCancel', sessionId, requestId: crypto.randomUUID() });
        if (startRequestId) forgetPendingAdStart(pet.id, startRequestId);
        forgetActiveRewardSession(sessionId);
        void recoverRewards();
      }
      trackProductEvent('rewarded_ad_result', {
        result: error instanceof DOMException && error.name === 'AbortError' ? 'cancelled' : 'failed',
      });
      if (!(error instanceof DOMException && error.name === 'AbortError')) {
        const message = error instanceof Error ? error.message : '광고를 완료하지 못했어요.';
        setAdError(message);
        setToast(message);
      }
    } finally {
      adAbortRef.current = undefined;
      await resumeSound(soundEnabled);
      busyRef.current = false;
      setBusy(false);
      if (readPendingAdStarts().length > 0 || earnedAdCompletionsRef.current.size > 0) void recoverRewards();
      if (continueWithConfirmedAccess && !abort.signal.aborted && adPromptPetRef.current?.id === pet.id) continueRewardPrompt();
    }
  }

  async function inviteFriends() {
    if (shareBusyRef.current || busyRef.current || !shareAvailable) return;
    shareBusyRef.current = true;
    setShareBusy(true);
    setToast('');
    const abort = new AbortController();
    shareAbortRef.current = abort;
    const initialBonus = bonusRemainingCount(allowanceRef.current);
    try {
      await recoverRewards();
      assertRewardStorage();
      const session = await startShareReward(getRewardStartRequest('share'));
      rememberActiveRewardSession({ kind: 'share', sessionId: session.sessionId });
      acknowledgeRewardStart('share');
      applyRewardStatus(session);
      await openShareReward({
        onReward(rewardAmount, eventSequence) {
          enqueueRewardRecovery({ kind: 'shareReward', sessionId: session.sessionId, requestId: crypto.randomUUID(), rewardAmount, eventSequence });
          void recoverRewards();
        },
        onClose(summary) {
          enqueueRewardRecovery({ kind: 'shareClose', sessionId: session.sessionId, requestId: crypto.randomUUID(), summary });
          forgetActiveRewardSession(session.sessionId);
          void recoverRewards();
        },
      }, undefined, abort.signal);
      await recoverRewards();
      if (readRewardRecovery().some((job) => job.sessionId === session.sessionId)) await recoverRewards();
      const granted = bonusRemainingCount(allowanceRef.current) - initialBonus;
      if (granted > 0) {
        setToast(`보너스 티켓 ${granted}장을 받았어요.`);
      } else if (readRewardRecovery().some((job) => job.sessionId === session.sessionId)) {
        setToast('공유 결과를 저장하고 있어요. 연결되면 티켓을 확인할 수 있어요.');
      }
    } catch (error) {
      applyErrorAllowance(error);
      if (!(error instanceof DOMException && error.name === 'AbortError')) {
        setToast(error instanceof Error ? error.message : '친구 초대를 열지 못했어요.');
      }
    } finally {
      shareAbortRef.current = undefined;
      shareBusyRef.current = false;
      setShareBusy(false);
      void recoverRewards();
    }
  }

  async function openMyPets() {
    if (getCurrentRoute(routeStackRef.current).screen !== 'mine') navigateTo({ screen: 'mine' });
    await refreshMyPets();
  }

  async function toggleRechargeNotification() {
    if (notificationBusyRef.current || busyRef.current || shareBusyRef.current) return;
    notificationBusyRef.current = true;
    setNotificationBusy(true);
    const abort = new AbortController();
    notificationAbortRef.current = abort;
    try {
      if (notificationSettings.enabled) {
        setNotificationSettings(await setRechargeNotificationSettings(false));
        setToast('충전 알림을 껐어요.');
        return;
      }
      if (!notificationSettings.templateCode) return;
      const agreement = await requestRechargeNotificationAgreement(notificationSettings.templateCode, abort.signal);
      if (agreement !== 'granted') {
        if (agreement === 'unsupported') setToast('토스 앱을 업데이트한 뒤 충전 알림을 신청해 주세요.');
        return;
      }
      setNotificationSettings(await setRechargeNotificationSettings(true, true));
      setToast('티켓이 충전되면 하루 한 번 알려드릴게요.');
    } catch (error) {
      setToast(error instanceof Error ? error.message : '알림 설정을 저장하지 못했어요.');
    } finally { notificationAbortRef.current = undefined; notificationBusyRef.current = false; setNotificationBusy(false); }
  }

  async function handleFed(overridePet?: PetSummary, overrideVisit?: PreparedVisit, returnHome = true, interactionMethod?: PetInteractionMethod, waitForReaction = false) {
    const activePet = overridePet ?? selected;
    const activeVisit = overrideVisit ?? preparedVisit;
    if (!activePet || busyRef.current) return;
    if (activeVisit?.characterOnlyReason) {
      setToast('이 친구의 캐릭터는 지금 만날 수 있어요\n실제 사진은 검수 후 공개돼요');
      return;
    }
    if (!activeVisit || (!activeVisit.method && !activeVisit.ownerPhoto && activeVisit.photoIntent !== 'replay') || activeVisit.petId !== activePet.id) {
      setToast(DAILY_LIMIT_TOAST);
      return;
    }
    busyRef.current = true;
    const generation = ++photoGenerationRef.current;
    setBusy(true);
    setSelected(activePet);
    setGallery([]);
    setPhotoAccessKind('initial');
    setPhotoReturnMode(returnHome ? 'home' : 'overlay');
    photoReturnModeRef.current = returnHome ? 'home' : 'overlay';
    setPhotoCaption(undefined);
    setPhotoLoadError('');
    setPhotoLoading(true);
    setPhotoAccessExpired(false);
    photoUrlRef.current = undefined;
    setPhotoUrl(undefined);
    if (!waitForReaction) {
      photoOpenRef.current = true;
      setPhotoOpen(true);
    }
    try {
      const result = activeVisit.ownerPhoto
        ? await openOwnerPhoto(activePet)
        : await revealPet(activePet, activeVisit.method ?? 'FREE', activeVisit.adSessionId, activeVisit.requestId, activeVisit.photoIntent);
      if (generation !== photoGenerationRef.current) {
        invalidateHouseSnapshot(); invalidateAlbum();
        mineNeedsRefreshRef.current = true;
        if (getCurrentRoute(routeStackRef.current).screen === 'home') void loadHouse(true);
        return;
      }
      if ('allowance' in result) {
        if (result.rewardStatus) applyRewardStatus(result.rewardStatus);
        else applyServerAllowance(result.allowance);
      }
      const revisitUntil = 'revisitUntil' in result ? result.revisitUntil : undefined;
      patchPetCaches(activePet.id, {
        ...('allowance' in result && result.photoId && !activePet.isMine ? albumPhotoMetadata(result) : {}),
        revisitUntil,
        revealedToday: true,
        ...(activePet.isMine ? { ownerPhotoAvailable: true } : {}),
      });
      photoIdRef.current = result.photoId; setPhotoId(result.photoId);
      setPhotoCaption(result.photoCaption);
      invalidateAlbum();
      updateDailyProgressAfterPhoto(activePet, 'dailyProgress' in result ? result.dailyProgress : undefined);
      mineGenerationRef.current += 1;
      mineNeedsRefreshRef.current = true;
      invalidateHouseSnapshot();
      if (activeVisit.method === 'REWARDED' && activeVisit.photoIntent !== 'replay'
        && !('rewardStatus' in result && result.rewardStatus)
        && !('alreadyRevealed' in result && result.alreadyRevealed)) {
        adCreditsRef.current.delete(activePet.id);
        setRewardCredits((credits) => credits.filter((credit) => credit.sessionId !== activeVisit.adSessionId));
      }
      photoExpiresAtRef.current = result.signedUrlExpiresAt;
      setPhotoAccessKind(activePet.isMine ? 'ownerPhoto' : result.photoId ? 'album' : 'revisit');
      let buffer = photoPreparationRef.current;
      if (!buffer || buffer.petId !== activePet.id || buffer.requestId !== activeVisit.requestId) {
        buffer?.dispose();
        buffer = createPhotoPreparation(activePet.id, activeVisit.requestId ?? crypto.randomUUID());
        photoPreparationRef.current = buffer;
      }
      const displayUrl = await buffer.resolve(result);
      if (generation !== photoGenerationRef.current) return;
      photoUrlRef.current = displayUrl;
      setPhotoUrl(displayUrl); setToast('');
      trackProductEvent('play_complete', { access_method: activeVisit.method, interaction_method: interactionMethod });
      notifyPlayPhotoReady(activeVisit.method);
    } catch (error) {
      if (generation !== photoGenerationRef.current) return;
      photoPreparationRef.current?.dispose();
      photoPreparationRef.current = undefined;
      applyErrorAllowance(error);
      const message = error instanceof Error ? error.message : '사진을 열지 못했어요.';
      setPhotoAccessExpired(isExpiredPhotoError(error));
      setPhotoLoadError(message);
      setToast(message);
    }
    finally { if (generation === photoGenerationRef.current) { setPhotoLoading(false); busyRef.current = false; setBusy(false); } }
  }

  function promptContinuationCopy(access: PetAccessDecision | undefined) {
    if (!access || access.kind === 'exhausted') return undefined;
    if (access.kind === 'unavailable') return { title: '이 친구는 잠시 쉬고 있어요', description: '지금은 만날 수 없어요. 다른 친구를 골라 주세요.', label: '확인' };
    if (access.kind === 'characterOnly') return { title: '캐릭터를 먼저 만나요', description: '실제 사진은 검수 후 공개돼요. 캐릭터에게 먼저 간식을 줄 수 있어요.', label: '캐릭터 만나기' };
    if (access.kind === 'ownerPhoto') return { title: '우리 강아지를 만나요', description: '내 강아지는 티켓 없이 만날 수 있어요.', label: '우리 강아지 만나기' };
    if (access.kind === 'revisit') return { title: '이 친구를 다시 만나요', description: '모아 둔 사진은 티켓 없이 다시 볼 수 있어요.', label: '이 친구 다시 만나기' };
    if (access.method === 'REWARDED') return { title: '이 친구를 만날 준비가 됐어요', description: '받아 둔 광고 보상으로 만날 수 있어요. 간식을 주고 사진을 만나세요.', label: '받은 보상으로 이 친구 만나기' };
    return { title: '이 친구를 만날 준비가 됐어요', description: '티켓이 준비됐어요. 이 친구에게 간식을 주면 새 사진을 만나요.', label: '티켓으로 이 친구 만나기' };
  }

  const adContinuation = promptContinuationCopy(adPromptPet ? confirmedPromptAccess(adPromptPet) : undefined);
  const ticketContinuation = promptContinuationCopy(ticketPromptPet ? confirmedPromptAccess(ticketPromptPet) : undefined);
  const adManualReturn = adStatus === 'awaiting-confirmation' || adStatus === 'reward-earned';
  const adPickerPets = pets.filter((pet) => {
    const access = resolvePetEncounter(publicationCache.apply(pet), {
      ...allowance, remaining: 0, freeUsed: 2, bonusTickets: 0, nextChargeAt: undefined,
    }, { source: 'house', adsEnabled: adsAvailable, hasAdCredit: adCreditsRef.current.has(pet.id), now: serverDate() });
    return access.kind === 'reveal' && access.method === 'REWARDED' && !adCreditsRef.current.has(pet.id);
  });
  const adPicker = <ConfirmDialog
    open={adPickerOpen}
    title="어떤 친구를 만나볼까요?"
    description={<span className="ad-pet-picker">
      <span>{adPickerPets.length ? '친구를 고른 뒤 광고를 보고 만나요.' : '모아 둔 사진은 무료로 다시 볼 수 있어요.'}</span>
      <span className="ad-pet-options">{adPickerPets.map((pet) => <button type="button" key={pet.id}
        disabled={busy || shareBusy} onClick={() => { closeAdPicker(); choosePet(pet, 'house'); }}>
        <span aria-hidden="true">🐶</span> {pet.name}
      </button>)}</span>
    </span>}
    closeOnBackEvent={false}
    onClose={closeAdPicker}
    cancelButton={<ConfirmDialog.CancelButton onClick={closeAdPicker}>닫기</ConfirmDialog.CancelButton>}
    confirmButton={!adPickerPets.length ? <ConfirmDialog.ConfirmButton onClick={() => { closeAdPicker(); openAlbum(); }}>강아지 앨범 보기</ConfirmDialog.ConfirmButton> : undefined}
  />;
  const adConfirmLabel = adStatus === 'loaded'
    ? '광고 보고 이 친구 만나기'
    : adStatus === 'error' || adStatus === 'idle'
      ? '광고 다시 준비하기'
      : adStatus === 'unsupported'
        ? '광고 지원 다시 확인'
        : '광고 준비 중';
  const adDialog = (
    <ConfirmDialog
      open={Boolean(adPromptPet)}
      title={adStatus === 'reward-earned' ? '광고 보상을 받았어요' : adStatus === 'awaiting-confirmation' ? '광고 화면이 열리지 않았나요?' : adContinuation?.title ?? '광고를 보고 지금 이 친구 만나기'}
      description={<>{adManualReturn ? <span>{adStatus === 'reward-earned' ? '광고를 닫고 돌아왔다면 받은 보상으로 계속 만나요.' : '광고가 보이지 않는다면 아래 버튼으로 다시 확인해 주세요. 티켓은 차감되지 않아요.'}</span> : adContinuation?.description ?? <><span>{`광고를 끝까지 보면 바로 만날 수 있어요.\n오늘 ${allowance.rewardedUsed}/${rewardedLimit}번 사용${rechargeCopy ? ` · 또는 ${rechargeCopy}` : ''}`}</span>{shareAvailable && <button type="button" className="reward-alternative" disabled={shareBusy || busy} onClick={() => void inviteFriends()}>공유하고 티켓 받기</button>}</>}{adError && <span className="ad-inline-error" role="status">{adError}</span>}</>}
      closeOnBackEvent={false}
      onClose={closeAdPrompt}
      cancelButton={<ConfirmDialog.CancelButton onClick={closeAdPrompt}>{adContinuation ? '나중에 만나기' : '충전 기다리기'}</ConfirmDialog.CancelButton>}
      confirmButton={(
        <ConfirmDialog.ConfirmButton
          onClick={() => { if (adManualReturn) confirmRewardedAdReturn(); else if (adContinuation) continueRewardPrompt(); else void confirmRewardedVisit(); }}
          loading={!adManualReturn && (busy || shareBusy || (!adContinuation && (adStatus === 'loading' || adStatus === 'showing')))}
          disabled={shareBusy || (!adManualReturn && (busy || (!adContinuation && adStatus === 'disabled')))}
        >
          {adStatus === 'reward-earned' ? '받은 보상으로 계속하기' : adStatus === 'awaiting-confirmation' ? '광고 없이 돌아왔어요 · 다시 확인' : adContinuation?.label ?? adConfirmLabel}
        </ConfirmDialog.ConfirmButton>
      )}
    />
  );
  const ticketDialog = <ConfirmDialog
    open={Boolean(ticketPromptPet)}
    title={ticketContinuation?.title ?? '다음 친구도 만나볼까요?'}
    description={ticketContinuation?.description ?? (shareAvailable ? `친구에게 초대하면 보너스 티켓을 받아요.${rechargeCopy ? `\n또는 ${rechargeCopy}` : ''}` : rechargeCopy ?? '티켓은 3시간마다 한 장씩 충전돼요.')}
    closeOnBackEvent={false}
    onClose={closeTicketPrompt}
    cancelButton={<ConfirmDialog.CancelButton onClick={closeTicketPrompt}>{ticketContinuation ? '나중에 만나기' : '충전 기다리기'}</ConfirmDialog.CancelButton>}
    confirmButton={ticketContinuation
      ? <ConfirmDialog.ConfirmButton loading={shareBusy || busy} disabled={shareBusy || busy} onClick={() => continueRewardPrompt()}>{ticketContinuation.label}</ConfirmDialog.ConfirmButton>
      : shareAvailable ? <ConfirmDialog.ConfirmButton loading={shareBusy || busy} disabled={shareBusy || busy} onClick={() => void inviteFriends()}>공유하고 티켓 받기</ConfirmDialog.ConfirmButton> : undefined}
  />;
  const uploadDiscardDialog = (
    <ConfirmDialog
      open={uploadDiscardOpen}
      title="작성 중인 내용을 나갈까요?"
      description={screen === 'add-photos' ? '새로 고른 사진은 보내지 않아요. 기존 사진은 그대로 유지돼요.' : '고른 사진과 꾸민 모습은 저장되지 않아요.'}
      closeOnBackEvent={false}
      onClose={() => {
        uploadDiscardOpenRef.current = false;
        setUploadDiscardOpen(false);
      }}
      cancelButton={<ConfirmDialog.CancelButton onClick={() => {
        uploadDiscardOpenRef.current = false;
        setUploadDiscardOpen(false);
      }}>{screen === 'add-photos' ? '계속 고르기' : '계속 꾸미기'}</ConfirmDialog.CancelButton>}
      confirmButton={<ConfirmDialog.ConfirmButton onClick={() => {
        uploadDiscardOpenRef.current = false;
        uploadDraftDirtyRef.current = false;
        setUploadDiscardOpen(false);
        setUploadDraftDirty(false);
        if (uploadDiscardDestinationRef.current === 'home') goHome();
        else popCurrentRoute();
        uploadDiscardDestinationRef.current = 'back';
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
    clearPhotoPreparation();
    const returnHome = photoReturnModeRef.current === 'home';
    photoGenerationRef.current += 1;
    busyRef.current = false; setBusy(false);
    photoIdRef.current = undefined; setPhotoId(undefined);
    photoOpenRef.current = false;
    setPhotoOpen(false);
    photoUrlRef.current = undefined;
    setPhotoUrl(undefined);
    setPhotoLoading(false);
    setPhotoLoadError('');
    setPhotoCaption(undefined);
    setPhotoAccessKind(undefined);
    if (returnHome) goHome();
    else if (getCurrentRoute(routeStackRef.current).screen === 'album') void loadAlbum();
    showPendingCompletionToast();
  }

  const galleryIndex = gallery.findIndex((photo) => photo.photoId === photoId);

  const PhotoCard = ReadyRevealCard ?? RevealCard;
  const photoCard = photoOpen && selected ? <Suspense fallback={<PhotoCardFallback onClose={closePhotoCard} />}><PhotoCard
    pet={selected}
    photoUrl={photoUrl}
    loading={photoLoading}
    loadError={photoLoadError}
    photoCaption={photoCaption}
    isFavorite={selected.isFavorite}
    favoritePending={favoritePending}
    onFavoriteChange={!selected.isMine && selected.approvalStatus === 'approved' && photoId && !photoLoading && !photoLoadError ? (value) => void changeFavorite(value) : undefined}
    photoPosition={gallery.length > 1 && galleryIndex >= 0 ? { index: galleryIndex, total: gallery.length } : undefined}
    onPreviousPhoto={galleryIndex > 0 && !photoLoading ? () => void openDirectPhoto(selected, 'album', true, gallery[galleryIndex - 1].photoId) : undefined}
    onNextPhoto={galleryIndex >= 0 && galleryIndex < gallery.length - 1 && !photoLoading ? () => void openDirectPhoto(selected, 'album', true, gallery[galleryIndex + 1].photoId) : undefined}
    retryPhotoLabel={photoAccessExpired ? '집에서 다시 만나기' : undefined}
    onClose={closePhotoCard}
    onRetryPhoto={async () => {
      if (photoAccessExpired) { closePhotoCard(); goHome(); return; }
      if (photoAccessKind === 'initial') {
        await handleFed(undefined, undefined, photoReturnModeRef.current === 'home');
        if (!photoUrlRef.current) throw new Error('사진을 다시 열지 못했어요.');
        return;
      }
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
        const expiresAt = Date.parse(photoExpiresAtRef.current ?? '');
        if (Number.isFinite(expiresAt) && expiresAt <= Date.now() + 5_000) {
          if (!photoAccessKind || photoAccessKind === 'initial' || !(await openDirectPhoto(selected, photoAccessKind, true))) return;
        }
        const destination = await saveBrandedPetPhoto(photoUrlRef.current ?? photoUrl, selected.name);
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
      {adPicker}
      {adDialog}
      {ticketDialog}
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

  if (route.screen === 'add-photos') {
    const pet = myPets.find((candidate) => candidate.id === route.petId);
    return renderWithAppShell(pet ? <Suspense fallback={screenFallback}><PetPhotoAdditionFlow
      key={pet.id}
      pet={pet}
      onCancel={navigateBack}
      onSubmitted={() => {
        // Additional photos are pending: no new dog, public photo, ticket or bonus.
        mineNeedsRefreshRef.current = true;
        popCurrentRoute();
        setToast('새로운 귀여움을 검수하러 갔어요. 기존 사진은 그대로 볼 수 있어요 🐾');
      }}
    /></Suspense> : <main className="my-pets-screen"><Result title="강아지 정보를 다시 확인해 주세요" button={<Result.Button onClick={navigateBack}>돌아가기</Result.Button>} /></main>);
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
  if (screen === 'album') return renderWithAppShell(<Suspense fallback={screenFallback}><AlbumScreen pets={album.pets} loading={albumLoading} loadingMore={albumLoadingMore} error={albumError} filter={albumFilter} onFilterChange={(filter) => void loadAlbum(filter)} onOpen={(pet) => void openDirectPhoto(pet, 'album')} onMeet={goHome} onRetry={() => void loadAlbum(albumFilter, false, true)} onLoadMore={() => void loadAlbum(albumFilter, true)} hasMore={Boolean(album.nextCursor)} /></Suspense>);

  if (screen === 'mine') return renderWithAppShell(<Suspense fallback={screenFallback}><MyPetsScreen pets={myPets} loading={myPetsLoading} error={myPetsError} uploadRewardPetId={uploadBonusAvailable ? allowance.uploadRewardPetId : undefined} onRetry={() => void openMyPets()} onUpload={() => navigateTo({ screen: 'upload' })} onAddPhotos={(pet) => navigateTo({ screen: 'add-photos', petId: pet.id })} onMeet={(pet) => choosePet(pet, 'mine')} onShare={(pet) => {
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
      accessDecision={resolvePetEncounter(selected, allowance, { source: 'shared', adsEnabled: adsAvailable, now: rechargeClock })}
      onHome={goHome}
      onMeet={() => choosePet(selected, 'shared')}
    /></Suspense>);
  }
  if (screen === 'play' && selected) return renderWithAppShell(
    <Suspense fallback={screenFallback}><PlayScene pet={selected} photoHint={preparedVisit?.photoIntent === 'collect' && !preparedVisit.ownerPhoto && !preparedVisit.characterOnlyReason
      ? preparedVisit.method === 'REWARDED' ? '받은 광고 보상으로 만나요. 티켓은 쓰지 않아요.'
        : preparedVisit.method === 'FREE' || preparedVisit.method === 'SHARE' ? '새 사진을 만나면 티켓 1장을 써요' : undefined
      : undefined} onPettingStart={startPlayPhotoPreparation} onInteractionComplete={beginPlayCompletion} onFed={finishPlayReaction} onSound={playSound} /></Suspense>,
  );

  return renderWithAppShell(
    <main className="home-screen">
      <section className="home-heading">
        <Top
          className="home-top"
          upperGap={16}
          lowerGap={10}
          title={<Top.TitleParagraph size={28}><span className="home-title">잠깐, 강아지 보고 갈래요?</span></Top.TitleParagraph>}
          subtitleBottom={<Top.SubtitleParagraph>오늘의 조그만 행복을 만나보세요</Top.SubtitleParagraph>}
        />
      </section>
      <section
        className="daily-card ticket-card"
        aria-label={`강아지 티켓 ${remaining + bonusTickets}장${bonusTickets ? `, 무료 티켓 ${remaining}장, 보너스 티켓 ${bonusTickets}장` : ''}, ${rechargeCopy ?? '무료 티켓은 최대 2장까지 모여요'}`}
      >
        <div className="ticket-card-main">
          <span className="ticket-card-icon" aria-hidden="true"><img src="/ui/dog-ticket-pass-v1.png" alt="" /></span>
          <div className="ticket-card-copy">
            <strong>강아지 티켓 <em>{remaining + bonusTickets}장</em></strong>
            {bonusTickets > 0 && <small>무료 티켓 {remaining}장 · 보너스 티켓 {bonusTickets}장</small>}
            <small>{remaining < FREE_ALLOWANCE_DISPLAY_CAPACITY
              ? rechargeCopy ?? '곧 1장 충전'
              : '무료 티켓은 최대 2장까지 모여요'}</small>
          </div>
        </div>
          {remaining === 0 && bonusTickets === 0 && adsAvailable && rewardedRemaining > 0 && (
            <button type="button" className="daily-ad-skip" disabled={busy || shareBusy} onClick={openAdPicker}>
              <strong>광고 보고 한 마리 더 만나기</strong><span>오늘 {rewardedRemaining}번 남음</span>
            </button>
          )}
        {isPreviewRuntime && remaining === 0 && (
          <button className="preview-daily-reset" type="button" onClick={() => {
            const previewStorage = getScenarioStorage(getPreviewScenario());
            resetStoredAllowance(previewStorage);
            resetPreviewReveals(previewStorage);
            const fresh = readAllowance(previewStorage);
            allowanceRef.current = fresh;
            setAllowance(fresh);
            houseLoadedDateRef.current = undefined;
            void loadHouse(true).then(() => setToast('테스트 횟수를 다시 채웠어요.'));
          }}>테스트 다시 시작</button>
        )}
      </section>
      {(notificationSettings.enabled || (notificationSettings.available && remaining === 0)) && <div className="home-recharge-notification">
        <button type="button" disabled={notificationBusy || busy || shareBusy} onClick={() => void toggleRechargeNotification()}>{notificationBusy ? '알림 설정 중…' : notificationSettings.enabled ? '충전 알림 끄기' : '충전되면 알려주세요'}</button>
        {!notificationSettings.enabled && <small>하루 최대 1회, 밤 9시부터 오전 8시까지는 보내지 않아요.</small>}
      </div>}
      {rebindSessionId ? <div className="home-reward-rebind" role="status">
        <span>남겨둔 광고 보상으로 만날 공개 친구를 골라 주세요.</span>
        <button type="button" onClick={() => setRebindSessionId(undefined)}>취소</button>
      </div> : rewardCredits.find((credit) => credit.canRebind) && <button type="button" className="reward-alternative" onClick={() => setRebindSessionId(rewardCredits.find((credit) => credit.canRebind)?.sessionId)}>남겨둔 광고 보상으로 다른 친구 고르기</button>}
      {shareAvailable && remaining === 0 && bonusTickets === 0 && <div className="home-share-reward">
        <button type="button" onClick={() => void inviteFriends()} disabled={shareBusy || busy}>{shareBusy ? '공유 결과 확인 중…' : '친구에게 공유하고 티켓 받기'}</button>
        <small>친구 1명에게 초대하면 보너스 티켓 1장을 받아요.</small>
      </div>}
      <div className="home-collection-links">
        <button className="my-pets-link" type="button" onClick={() => void openMyPets()}>내가 소개한 강아지</button>
        <button className="home-album-button" type="button" aria-label="강아지 앨범" title="강아지 앨범" onClick={openAlbum}>
          <img src="/ui/dog-encyclopedia-book-v1.png" alt="" />
        </button>
      </div>
      {houseRestartRequired || (houseError && pets.length === 0 && !ownerBonusPet) ? (
        <section className="house-error">
          <Asset.Image src="https://static.toss.im/2d-emojis/png/4x/u1F415.png" frameShape={{ width: 76, height: 76 }} alt="강아지" />
          <strong>{houseRestartRequired ? '새 강아지 디자인을 보려면 앱을 다시 열어 주세요' : '잠시 뒤 다시 불러와 주세요'}</strong>
          <Button size="medium" color="dark" variant="weak" onClick={() => {
            if (houseRestartRequired) void closeMiniApp().catch(() => setToast('앱을 닫았다가 다시 열어 주세요.'));
            else void loadHouse(true);
          }}>{houseRestartRequired ? '앱 닫기' : '다시 불러오기'}</Button>
        </section>
      ) : <House
        dateKey={allowance.date}
        positions={housePositionsRef.current[allowance.date]}
        onPositionsChange={(positions) => { housePositionsRef.current = { [allowance.date]: positions }; }}
        dailyPets={pets}
        ownerBonusPet={ownerBonusPet}
        metPetIds={visibleProgress.metPetIds}
        onSelect={(pet) => choosePet(pet, 'house')}
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
      {!toast && houseError && !houseRestartRequired && (pets.length > 0 || Boolean(ownerBonusPet)) ? (
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
