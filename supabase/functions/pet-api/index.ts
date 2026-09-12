import { createClient } from 'npm:@supabase/supabase-js@2.57.4';
import { withReviewedArtwork } from '../_shared/reviewed-artwork.ts';
import { refreshArtwork } from './artwork-api.ts';
import { PET_DESIGN_FORMAT, withPublishedDesign, assertLegacyDesignCompatible } from '../_shared/published-design.ts';
import { refreshDesign } from './design-api.ts';
import { verifyAnonymousKey } from '../_shared/anonymous-key.ts';
import { ApiError } from '../_shared/api-error.ts';
import { corsGuard, json } from '../_shared/cors.ts';
import { orderDailyPets } from '../_shared/daily-pool.ts';
import { decodeDataUri, hashUser, kstDate } from '../_shared/security.ts';
import { readPetApiBody, requireDirectSubmissionDataUri, requirePhotoUploadInput, hasSubmissionPhotoReceipts } from '../_shared/submission-photos.ts';
import { verifyPhotoReceipts } from '../_shared/submission-photo-receipts.ts';
import { registerSubmissionPhotos, registerSubmissionPhotoPaths, uploadSubmissionPhoto, type SubmissionClient } from './submission-api.ts';
import { createPhotoAdditionApi, type PhotoAdditionClient } from './photo-addition-api.ts';
import { rewardAllowance, rewardStatusPayload, rewardRpcRequest, rewardRpcError, type RewardDatabaseState } from '../_shared/reward-api.ts';
import { getRechargeNotificationSettings, setRechargeNotificationSettings, noteRechargeNotificationVisit } from '../_shared/notification-settings.ts';
import { collectKeysetPages } from '../_shared/keyset-pagination.ts';
import { albumRpcError, albumSummaryFields, createAlbumApi } from './album-api.ts';
import { createPhotoPrepareApi, type PhotoPrepareClient } from './photo-prepare-api.ts';
import {
  canOpenOwnerPhoto,
  canRevealStoredPetPhoto,
  isRevisitActive,
  isShareablePetStatus,
  SHARED_CHARACTER_PET_STATUSES,
} from '../_shared/pet-visibility.ts';
import {
  requirePetName,
  requireAccessorySubmission,
  requireAction,
  requireAnonymousKey,
  requirePetTraits,
  requirePetStyle,
  requireUuid,
  rejectCreatorDesignFields,
  type PetApiAction,
} from '../_shared/validation.ts';

const supabase = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  { auth: { persistSession: false } },
);
const albumApi = createAlbumApi(supabase);
const preparePhoto = createPhotoPrepareApi(supabase as unknown as PhotoPrepareClient);
// Keep the narrow upload boundary independent of Supabase's recursive query types.
const submissionClient = supabase as unknown as SubmissionClient;
const photoAdditionApi = createPhotoAdditionApi(supabase as unknown as PhotoAdditionClient, {
  secret: () => Deno.env.get('USER_HASH_SALT') ?? '',
  uploadsEnabled: () => Deno.env.get('AIT_UPLOADS_ENABLED') === 'true',
  decodePhoto: decodeDataUri,
});

const DAILY_FREE_PETS = 2;
const MAX_REWARDED_PER_DAY = 2;
const DAILY_PUBLIC_PET_LIMIT = 4;
// apiVersion 1은 이미 설치된 구버전 앱의 종전 최대 5자리 계약을 유지한다.
const LEGACY_HOUSE_PET_LIMIT = 5;

type FreeAllowance = { remaining: number; nextChargeAt?: string };
type OwnedPetRow = {
  id: string;
  created_at: string;
  name: string | null;
  traits: Record<string, unknown>;
  status: string;
  rejection_reason: string | null;
  published_accessory: Record<string, unknown> | null;
  published_style: Record<string, unknown> | null;
  design_version: number | null;
};
type RevealRow = {
  pet_id: string;
  unlock_method: string;
  reveal_date: string;
  revisit_until: string;
  created_at: string;
};

type HouseSnapshotPet = {
  id: string;
  name?: string | null;
  traits: Record<string, unknown>;
  status: 'pending' | 'approved';
  ownerHash: string;
  publishedAccessory?: Record<string, unknown> | null;
  publishedStyle?: Record<string, unknown> | null;
  designVersion?: number;
};

type DailyHouseSnapshotPet = HouseSnapshotPet & {
  slot: number;
  metAt?: string | null;
  viewedToday?: boolean;
};

type DailyProgress = {
  date: string;
  metPetIds: string[];
  metCount: number;
  totalCount: number;
  completed: boolean;
};

type AtomicRevealResult = {
  revisitUntil: string;
  dailyProgress: DailyProgress;
};

type HouseSnapshotReveal = {
  petId: string;
  unlockMethod: string;
  revealDate: string;
  revisitUntil: string;
  createdAt: string;
};

type HouseSnapshot = {
  date: string;
  freeAllowance: FreeAllowance;
  todayReveals: HouseSnapshotReveal[];
  activeReveals: HouseSnapshotReveal[];
  uploadReward?: { petId: string; usedAt: string | null } | null;
  ownedPets: HouseSnapshotPet[];
  approvedPets: HouseSnapshotPet[];
  sameDayApprovedPets?: HouseSnapshotPet[];
  activePets: HouseSnapshotPet[];
  todayMetPetIds?: string[];
};

type HouseSnapshotV2 = {
  date: string;
  freeAllowance: FreeAllowance;
  todayReveals: HouseSnapshotReveal[];
  activeReveals: HouseSnapshotReveal[];
  uploadReward?: { petId: string; usedAt: string | null } | null;
  dailyPets: DailyHouseSnapshotPet[];
  ownerBonusPet?: (HouseSnapshotPet & { viewedToday?: boolean }) | null;
  dailyProgress: DailyProgress;
};

function activeRevisitMap(rows: RevealRow[], now = Date.now()): Map<string, RevealRow> {
  const active = new Map<string, RevealRow>();
  for (const row of rows) {
    if (!active.has(row.pet_id) && isRevisitActive(row.revisit_until, now)) active.set(row.pet_id, row);
  }
  return active;
}

async function getActiveReveals(ownerHash: string, petId?: string): Promise<RevealRow[]> {
  let query = supabase.from('daily_reveals')
    .select('pet_id,unlock_method,reveal_date,revisit_until,created_at')
    .eq('owner_hash', ownerHash)
    .gt('revisit_until', new Date().toISOString())
    .order('created_at', { ascending: false });
  if (petId) query = query.eq('pet_id', petId);
  const { data, error } = await query;
  if (error) throw error;
  return (data ?? []) as RevealRow[];
}

async function getFreeAllowance(ownerHash: string): Promise<FreeAllowance> {
  const { data, error } = await supabase.rpc('get_pet_free_allowance', {
    p_owner_hash: ownerHash,
  }).single();
  if (error || !data) throw error ?? new Error('FREE_ALLOWANCE_UNAVAILABLE');
  const row = data as { free_remaining: number; next_free_at: string | null };
  return {
    remaining: Math.max(0, Math.min(DAILY_FREE_PETS, Number(row.free_remaining) || 0)),
    nextChargeAt: row.next_free_at ?? undefined,
  };
}

function allowancePayload(
  date: string,
  freeAllowance: FreeAllowance,
  rewardedUsed: number,
  uploadReward?: { pet_id: string; used_at: string | null } | null,
) {
  return {
    date,
    freeUsed: DAILY_FREE_PETS - freeAllowance.remaining,
    remaining: freeAllowance.remaining,
    nextChargeAt: freeAllowance.nextChargeAt,
    rewardedUsed,
    uploadCredit: Boolean(uploadReward),
    uploadUsed: Boolean(uploadReward?.used_at),
    uploadRewardPetId: uploadReward?.pet_id,
  };
}

async function getRewardState(ownerHash: string, albumEnabled = false): Promise<RewardDatabaseState> {
  const { data, error } = await supabase.rpc(albumEnabled ? 'get_pet_album_reward_state' : 'get_pet_reward_state', { p_owner_hash: ownerHash });
  if (error || !data) throw rewardRpcError(error ?? {});
  return data as RewardDatabaseState;
}

function rewardFlags() {
  return {
    ads: Deno.env.get('AIT_REWARDED_ADS_ENABLED') === 'true',
    share: Deno.env.get('AIT_SHARE_REWARDS_ENABLED') === 'true',
  };
}

async function currentRewardStatus(ownerHash: string, albumEnabled = false) {
  const [free, rewards] = await Promise.all([getFreeAllowance(ownerHash), getRewardState(ownerHash, albumEnabled)]);
  return rewardStatusPayload(rewards, allowancePayloadV2(kstDate(), free, rewards.adsCompletedToday), rewardFlags());
}

function allowancePayloadV2(
  date: string,
  freeAllowance: FreeAllowance,
  rewardedUsed: number,
  uploadReward?: { pet_id: string; used_at: string | null } | null,
) {
  return {
    ...allowancePayload(date, freeAllowance, rewardedUsed, uploadReward),
    rewardedLimit: MAX_REWARDED_PER_DAY,
    rewardedRemaining: Math.max(0, MAX_REWARDED_PER_DAY - rewardedUsed),
  };
}

async function markDailyHousePetMet(
  ownerHash: string,
  date: string,
  petId: string,
): Promise<DailyProgress> {
  const { data, error } = await supabase.rpc('mark_daily_house_pet_met', {
    p_owner_hash: ownerHash,
    p_date: date,
    p_pet_id: petId,
  });
  if (error || !data) throw error ?? new Error('DAILY_HOUSE_PROGRESS_UNAVAILABLE');
  return data as DailyProgress;
}

async function selectDailyPhotoPath(petId: string, ownerHash: string, date: string, paths: string[]): Promise<string> {
  if (paths.length === 1) return paths[0];
  const encoded = new TextEncoder().encode(`photo-v1:${petId}:${ownerHash}:${date}`);
  const digest = await crypto.subtle.digest('SHA-256', encoded);
  const index = new DataView(digest).getUint32(0, false) % paths.length;
  return paths[index];
}

async function getExistingPetPhotos(petIds: string[]): Promise<Array<{ pet_id: string; storage_path: string; sort_order: number }>> {
  if (!petIds.length) return [];
  const photos: Array<{ pet_id: string; storage_path: string; sort_order: number }> = [];
  for (let start = 0; start < petIds.length; start += 100) {
    for (let offset = 0; ; offset += 500) {
      const { data, error } = await supabase.rpc('get_existing_pet_photos', {
        p_pet_ids: petIds.slice(start, start + 100),
      }).order('pet_id').order('sort_order').order('storage_path').range(offset, offset + 499);
      if (error) throw error;
      photos.push(...(data ?? []));
      if (!data || data.length < 500) break;
    }
  }
  return photos;
}

async function createPetPhotoSignedResult(
  petId: string,
  ownerHash: string,
  date: string,
  allowPendingOwner: boolean,
  includePhotoId = false,
): Promise<{ photoUrl: string; photoId?: string; photoCaption?: string }> {
  const { data: pet, error: petError } = await supabase.from('pets')
    .select('id,storage_path,status,owner_hash')
    .eq('id', petId)
    .maybeSingle();
  if (petError) throw petError;
  const canReveal = pet && canRevealStoredPetPhoto({
    status: pet.status,
    isOwner: pet.owner_hash === ownerHash,
    allowPendingOwner,
  });
  if (!canReveal) throw new ApiError('PHOTO_NOT_REVEALABLE', 404, '공개할 수 없는 사진이에요.');

  const photos = await getExistingPetPhotos([pet.id]);
  if (!photos?.length) {
    throw new ApiError('PHOTO_NOT_REVEALABLE', 404, '공개할 수 있는 사진이 없어요.');
  }
  const photoPaths = photos.map((photo) => photo.storage_path);
  const selectedPath = await selectDailyPhotoPath(pet.id, ownerHash, date, photoPaths);
  const { data: exactPhoto, error: exactPhotoError } = await supabase.from('pet_photos')
    .select('id,caption').eq('pet_id', pet.id).eq('storage_path', selectedPath).eq('is_active', true).maybeSingle();
  if (exactPhotoError) throw exactPhotoError;
  if (!exactPhoto) throw new ApiError('PHOTO_NOT_REVEALABLE', 404, '공개할 수 있는 사진이 없어요.');
  const { data: signed, error: signError } = await supabase.storage.from('pet-photos').createSignedUrl(selectedPath, 600);
  if (signError) throw signError;
  return { photoUrl: signed.signedUrl, ...(includePhotoId ? { photoId: exactPhoto.id } : {}),
    ...(exactPhoto.caption ? { photoCaption: exactPhoto.caption } : {}) };
}

const RATE_LIMITS: Record<PetApiAction, { seconds: number; limit: number }> = {
  house: { seconds: 60, limit: 60 },
  shared: { seconds: 60, limit: 60 },
  mine: { seconds: 60, limit: 30 },
  artwork: { seconds: 60, limit: 60 },
  design: { seconds: 60, limit: 60 },
  reveal: { seconds: 60, limit: 10 },
  ownerPhoto: { seconds: 60, limit: 30 },
  photoPrepare: { seconds: 60, limit: 30 },
  album: { seconds: 60, limit: 30 },
  albumPhoto: { seconds: 60, limit: 60 },
  setFavorite: { seconds: 60, limit: 30 },
  submit: { seconds: 60 * 60, limit: 3 },
  submitPhoto: { seconds: 60 * 60, limit: 20 },
  submissionStatus: { seconds: 60, limit: 20 },
  photoAdditionStatus: { seconds: 60, limit: 30 },
  photoAdditionUpload: { seconds: 60 * 60, limit: 20 },
  photoAdditionSubmit: { seconds: 60 * 60, limit: 10 },
  report: { seconds: 60 * 60, limit: 10 },
  rewardStart: { seconds: 60, limit: 10 },
  rewardComplete: { seconds: 60, limit: 30 },
  rewardCancel: { seconds: 60, limit: 30 },
  rewardStatus: { seconds: 60, limit: 60 },
  rewardRebind: { seconds: 60, limit: 10 },
  shareStart: { seconds: 60, limit: 10 },
  shareReward: { seconds: 60, limit: 120 },
  shareClose: { seconds: 60, limit: 30 },
  notificationSettings: { seconds: 60, limit: 30 },
  setNotificationSettings: { seconds: 60, limit: 10 },
};

function boundedEnvInteger(name: string, fallback: number, maximum: number): number {
  const parsed = Number.parseInt(Deno.env.get(name) ?? '', 10);
  return Number.isInteger(parsed) && parsed > 0 ? Math.min(parsed, maximum) : fallback;
}

async function enforceRateLimit(ownerHash: string, action: PetApiAction) {
  const policy = RATE_LIMITS[action];
  const { data, error } = await supabase.rpc('check_pet_api_rate_limit', {
    p_owner_hash: ownerHash,
    p_action: action,
    p_window_seconds: policy.seconds,
    p_limit: policy.limit,
  });
  if (error) {
    console.error('rate limit check failed', error);
    throw new ApiError('RATE_LIMIT_UNAVAILABLE', 503, '요청을 확인하지 못했어요. 잠시 뒤 다시 시도해 주세요.');
  }
  if (!data) throw new ApiError('RATE_LIMITED', 429, '요청이 너무 많아요. 잠시 뒤 다시 시도해 주세요.');
}

async function findSubmissionResult(ownerHash: string, submissionId: string, date: string) {
  const { data: existing, error: existingError } = await supabase.from('pets')
    .select('id,name,traits,status,published_accessory,published_style,design_version')
    .eq('owner_hash', ownerHash)
    .eq('submission_id', submissionId)
    .maybeSingle();
  if (existingError) throw existingError;
  if (!existing) return undefined;

  const { data: existingReward, error: existingRewardError } = await supabase.from('upload_rewards')
    .select('pet_id')
    .eq('pet_id', existing.id)
    .eq('owner_hash', ownerHash)
    .eq('reward_date', date)
    .is('used_at', null)
    .maybeSingle();
  if (existingRewardError) throw existingRewardError;
  const existingPhotos = await getExistingPetPhotos([existing.id]);
  const { status, published_accessory, published_style, design_version, ...pet } = existing;
  return {
    pet: {
      ...pet,
      publishedAccessory: published_accessory ?? undefined,
      publishedStyle: published_style ?? undefined,
      designVersion: design_version ?? 1,
      photoAvailable: existingPhotos.length > 0,
      ownerPhotoAvailable: canOpenOwnerPhoto({
        status,
        isOwner: true,
        hasExistingPhoto: existingPhotos.length > 0,
      }),
      isMine: true,
      ownerPinned: true,
      approvalStatus: status,
      shareable: isShareablePetStatus(status),
    },
    rewardGranted: Boolean(existingReward),
    uploadRewardPetId: existingReward ? existing.id : undefined,
  };
}

Deno.serve(async (request) => {
  let svgDesignClient = false;
  const reply = async (data: unknown, status = 200) => {
    try {
      if (status === 200 && !svgDesignClient) await assertLegacyDesignCompatible(supabase,data);
      const result = status === 200
        ? await (svgDesignClient ? withPublishedDesign(supabase, data) : withReviewedArtwork(supabase, data)) : data;
      return json(request, result && typeof result === 'object' ? { ...result, serverNow: new Date().toISOString() } : result, status);
    } catch (error) {
      if (error instanceof ApiError) return json(request,{ error: error.message, code: error.code },error.status);
      return json(request, { error: '저장된 캐릭터 이미지를 불러오지 못했어요. 잠시 뒤 다시 시도해 주세요.', code: 'REVIEWED_ARTWORK_UNAVAILABLE' }, 503);
    }
  };
  let verifiedOwnerHash: string | undefined;
  let albumRewardClient = false;
  let photoAdditionRequest = false;
  let photoPrepareRequest = false;
  const corsResponse = corsGuard(request);
  if (corsResponse) return corsResponse;
  if (request.method !== 'POST') return reply({ error: '지원하지 않는 요청 방식이에요.', code: 'METHOD_NOT_ALLOWED' }, 405);
  try {
    const body = await readPetApiBody(request);
    const action = requireAction(body.action);
    photoPrepareRequest = action === 'photoPrepare';
    photoAdditionRequest = action === 'photoAdditionStatus' || action === 'photoAdditionUpload' || action === 'photoAdditionSubmit';
    svgDesignClient = body.designFormat === PET_DESIGN_FORMAT;
    // Enable only after all public pets have confirmed SVG designs and the new AIT is released.
    if (Deno.env.get('PET_REQUIRE_SVG_DESIGN') === 'true' && !svgDesignClient) {
      throw new ApiError('CLIENT_RESTART_REQUIRED', 426, '새 강아지 디자인을 보려면 앱을 다시 열어 주세요.');
    }
    if (action === 'submit' || action === 'submitPhoto') rejectCreatorDesignFields(body);
    const apiVersion = body.apiVersion === 2 ? 2 : 1;
    const albumEnabled = body.albumVersion === 1 || body.albumVersion === 2;
    albumRewardClient = albumEnabled;
    const anonymousKey = requireAnonymousKey(body.userHash);
    await verifyAnonymousKey(anonymousKey);
    const ownerHash = await hashUser(anonymousKey);
    verifiedOwnerHash = ownerHash;

    if (action === 'submissionStatus') {
      await enforceRateLimit(ownerHash, action);
      const submissionId = requireUuid(body.submissionId, '사진 등록 요청을 다시 시작해 주세요.').toLowerCase();
      const result = await findSubmissionResult(ownerHash, submissionId, kstDate());
      return reply(result ? { found: true, result } : { found: false });
    }

    if (action === 'submit' || action === 'submitPhoto') {
      const submissionId = requireUuid(body.submissionId, '사진 등록 요청을 다시 시작해 주세요.').toLowerCase();
      const existing = await findSubmissionResult(ownerHash, submissionId, kstDate());
      if (existing) {
        if (action === 'submitPhoto') throw new ApiError('SUBMISSION_ALREADY_REGISTERED', 409, '이미 등록한 강아지예요. 등록 결과를 확인해 주세요.');
        return reply(existing);
      }
    }

    await enforceRateLimit(ownerHash, action);

    if (action === 'photoPrepare') return reply(await preparePhoto(ownerHash, body, kstDate()));
    if (action === 'photoAdditionStatus') return reply(await photoAdditionApi.status(ownerHash, body));
    if (action === 'photoAdditionUpload') return reply(await photoAdditionApi.upload(ownerHash, body), 201);
    if (action === 'photoAdditionSubmit') return reply(await photoAdditionApi.submit(ownerHash, body));

    if (action === 'design') {
      const result = await refreshDesign(supabase, requireUuid(body.petId));
      return json(request, { ...(result as object), serverNow: new Date().toISOString() }, 200);
    }

    if (action === 'artwork') {
      const result = await refreshArtwork(supabase, requireUuid(body.petId));
      await assertLegacyDesignCompatible(supabase,result);
      return json(request, { ...(result as object), serverNow: new Date().toISOString() }, 200);
    }

    if (action === 'album') return reply(await albumApi.album(ownerHash, body));
    if (action === 'setFavorite') return reply(await albumApi.favorite(ownerHash, body));
    if (action === 'albumPhoto') {
      const result = await albumApi.photo(ownerHash, requireUuid(body.photoId), kstDate());
      const rewardStatus = await currentRewardStatus(ownerHash, albumEnabled);
      return reply({ ...result, allowance: rewardStatus.allowance, rewardStatus });
    }

    if (action === 'notificationSettings') return reply(await getRechargeNotificationSettings(supabase, ownerHash));
    if (action === 'setNotificationSettings') {
      if (typeof body.enabled !== 'boolean') throw new ApiError('INVALID_NOTIFICATION_SETTINGS', 400, '알림 설정을 확인해 주세요.');
      return reply(await setRechargeNotificationSettings(supabase, {
        ownerHash, anonymousKey, enabled: body.enabled, tossAgreementGranted: body.tossAgreementGranted === true,
      }));
    }
    if (['rewardStart', 'rewardComplete', 'rewardCancel', 'rewardStatus', 'rewardRebind', 'shareStart', 'shareReward', 'shareClose'].includes(action)) {
      if (action === 'rewardStart' && !rewardFlags().ads) throw new ApiError('REWARDED_ADS_DISABLED', 403, '광고 만남은 잠시 준비 중이에요.');
      if (action === 'shareStart' && !rewardFlags().share) throw new ApiError('SHARE_REWARDS_DISABLED', 403, '친구 초대 보상은 잠시 준비 중이에요.');
      const rpc = rewardRpcRequest(action, body, ownerHash);
      const { data, error } = await supabase.rpc(rpc.name, rpc.args);
      if (error) throw albumEnabled ? albumRpcError(error) : rewardRpcError(error);
      const status = await currentRewardStatus(ownerHash, albumEnabled);
      const sessionId = typeof body.sessionId === 'string' ? body.sessionId : body.requestId;
      const state = data as RewardDatabaseState | null;
      return reply({ ...status, ...(typeof sessionId === 'string' ? { sessionId } : {}),
        reconciliationRequired: state?.rewardPendingReview || state?.shareSession?.reconciliationRequired
          || state?.shareSessions?.find((row) => row.sessionId === sessionId)?.reconciliationRequired || false });
    }

    if (action === 'house') {
      await noteRechargeNotificationVisit(supabase, ownerHash);
      const date = kstDate();
      if (apiVersion === 2) {
        const { data: snapshotRow, error: snapshotError } = await supabase.rpc('get_pet_house_snapshot_v2', {
          p_owner_hash: ownerHash,
          p_date: date,
        }).single();
        if (snapshotError || !snapshotRow) throw snapshotError ?? new Error('HOUSE_SNAPSHOT_UNAVAILABLE');
        const snapshot = (snapshotRow as { snapshot: HouseSnapshotV2 }).snapshot;
        const activeReveals = new Map(snapshot.activeReveals.map((reveal) => [reveal.petId, reveal]));
        const dailyPets = snapshot.dailyPets.map(({ status: _status, ownerHash: _petOwnerHash, slot, metAt: _metAt, ...pet }) => ({
          ...pet,
          houseSlot: slot,
          photoAvailable: true,
          ownerPhotoAvailable: false,
          isMine: false,
          ownerPinned: false,
          approvalStatus: 'approved',
          shareable: true,
          // `revealedToday` is a legacy access hint, so it must expire with the
          // revisit window. Daily completion remains in dailyProgress.metPetIds.
          revealedToday: activeReveals.has(pet.id),
          revisitUntil: activeReveals.get(pet.id)?.revisitUntil,
        }));
        const ownerBonusPet = snapshot.ownerBonusPet
          ? (({ status, ownerHash: _petOwnerHash, viewedToday, ...pet }) => ({
              ...pet,
              photoAvailable: true,
              ownerPhotoAvailable: true,
              isMine: true,
              ownerPinned: true,
              approvalStatus: status,
              shareable: isShareablePetStatus(status),
              revealedToday: Boolean(viewedToday),
              revisitUntil: activeReveals.get(pet.id)?.revisitUntil,
            }))(snapshot.ownerBonusPet)
          : null;
        const rewardedUsed = snapshot.todayReveals.filter((item) => item.unlockMethod === 'REWARDED').length;
        const uploadReward = snapshot.uploadReward
          ? { pet_id: snapshot.uploadReward.petId, used_at: snapshot.uploadReward.usedAt }
          : null;
        if (dailyPets.length < DAILY_PUBLIC_PET_LIMIT) {
          console.warn('daily house has empty public slots', {
            date,
            assignedCount: dailyPets.length,
            expectedCount: DAILY_PUBLIC_PET_LIMIT,
          });
        }
        const rewards = await getRewardState(ownerHash, albumEnabled);
        const albumStates = albumEnabled
          ? await albumApi.states(ownerHash, [...dailyPets.map((pet) => pet.id), ...(ownerBonusPet ? [ownerBonusPet.id] : [])])
          : undefined;
        return reply({
          apiVersion: 2,
          dailyPets: albumStates ? dailyPets.map((pet) => ({ ...pet, ...albumSummaryFields(albumStates.get(pet.id)) })) : dailyPets,
          ownerBonusPet: ownerBonusPet && albumStates
            ? { ...ownerBonusPet, ...albumSummaryFields(albumStates.get(ownerBonusPet.id)) } : ownerBonusPet,
          dailyProgress: snapshot.dailyProgress,
          allowance: rewardAllowance(allowancePayloadV2(date, snapshot.freeAllowance, rewardedUsed, uploadReward), rewards),
          rewardStatus: rewardStatusPayload(rewards, allowancePayloadV2(date, snapshot.freeAllowance, rewardedUsed, uploadReward), rewardFlags()),
        });
      }

      const { data: snapshotRow, error: snapshotError } = await supabase.rpc('get_pet_house_snapshot', {
        p_owner_hash: ownerHash,
        p_date: date,
      }).single();
      if (snapshotError || !snapshotRow) throw snapshotError ?? new Error('HOUSE_SNAPSHOT_UNAVAILABLE');
      const snapshot = (snapshotRow as { snapshot: HouseSnapshot }).snapshot;
      const activeReveals = new Map(snapshot.activeReveals.map((reveal) => [reveal.petId, reveal]));
      const owned = snapshot.ownedPets.map(({ status, ownerHash: _petOwnerHash, ...pet }) => ({
        ...pet,
        photoAvailable: true,
        ownerPhotoAvailable: true,
        isMine: true,
        ownerPinned: true,
        approvalStatus: status,
        shareable: true,
        revealedToday: activeReveals.has(pet.id),
        revisitUntil: activeReveals.get(pet.id)?.revisitUntil,
      }));
      const primaryOwnedPet = owned[0];
      const candidateSummaries = snapshot.approvedPets.map(({ status: _status, ownerHash: _petOwnerHash, ...pet }) => ({
          ...pet,
          photoAvailable: true,
          ownerPhotoAvailable: false,
          isMine: false,
          ownerPinned: false,
          approvalStatus: 'approved',
          shareable: true,
          revealedToday: activeReveals.has(pet.id),
          revisitUntil: activeReveals.get(pet.id)?.revisitUntil,
        }));
      const sameDayCandidateSummaries = (snapshot.sameDayApprovedPets ?? []).map(({ status: _status, ownerHash: _petOwnerHash, ...pet }) => ({
          ...pet,
          photoAvailable: true,
          ownerPhotoAvailable: false,
          isMine: false,
          ownerPinned: false,
          approvalStatus: 'approved',
          shareable: true,
          revealedToday: activeReveals.has(pet.id),
          revisitUntil: activeReveals.get(pet.id)?.revisitUntil,
        }));
      const activeSummaries = snapshot.activePets
        .filter((pet) => pet.status === 'approved' || pet.ownerHash === ownerHash)
        .map((pet) => {
          const petId = pet.id;
          const isMine = pet.ownerHash === ownerHash;
          return {
            id: petId,
            name: pet.name ?? undefined,
            traits: pet.traits,
            publishedAccessory: pet.publishedAccessory ?? undefined,
            publishedStyle: pet.publishedStyle ?? undefined,
            designVersion: pet.designVersion ?? 1,
            photoAvailable: true,
            ownerPhotoAvailable: isMine,
            isMine,
            ownerPinned: isMine,
            approvalStatus: pet.status,
            shareable: isShareablePetStatus(pet.status),
            revealedToday: true,
            revisitUntil: activeReveals.get(petId)?.revisitUntil,
          };
        });

      const pool: Array<Record<string, unknown>> = [];
      const occupiedIds = new Set<string>();
      const append = (pet: Record<string, unknown> | undefined) => {
        if (!pet || pool.length >= LEGACY_HOUSE_PET_LIMIT) return;
        const petId = String(pet.id);
        if (occupiedIds.has(petId)) return;
        occupiedIds.add(petId);
        pool.push(pet);
      };
      append(primaryOwnedPet);
      for (const reveal of snapshot.activeReveals) {
        append(activeSummaries.find((pet) => pet.id === reveal.petId));
      }
      for (const pet of orderDailyPets(candidateSummaries, ownerHash, date)) append(pet);
      for (const pet of orderDailyPets(sameDayCandidateSummaries, ownerHash, date)) append(pet);
      const metIds = new Set(snapshot.todayMetPetIds ?? snapshot.todayReveals.map((reveal) => reveal.petId));
      const metPetIds = pool.map((pet) => String(pet.id)).filter((petId) => metIds.has(petId));
      const rewardedUsed = snapshot.todayReveals.filter((item) => item.unlockMethod === 'REWARDED').length;
      const uploadReward = snapshot.uploadReward
        ? { pet_id: snapshot.uploadReward.petId, used_at: snapshot.uploadReward.usedAt }
        : null;
      return reply({
        pets: pool,
        dailyProgress: {
          date,
          metPetIds,
          metCount: metPetIds.length,
          totalCount: pool.length,
          completed: pool.length > 0 && metPetIds.length === pool.length,
        },
        allowance: allowancePayload(date, snapshot.freeAllowance, rewardedUsed, uploadReward),
      });
    }

    if (action === 'shared') {
      await noteRechargeNotificationVisit(supabase, ownerHash);
      const petId = requireUuid(body.petId);
      const { data: pet, error } = await supabase.from('pets')
        .select('id,name,traits,status,owner_hash,published_accessory,published_style,design_version')
        .eq('id', petId)
        .in('status', [...SHARED_CHARACTER_PET_STATUSES])
        .maybeSingle();
      if (error) throw error;
      if (!pet) return reply({ error: '이 친구는 지금 만날 수 없어요.', code: 'PET_NOT_AVAILABLE' }, 404);
      const existingPhotos = await getExistingPetPhotos([petId]);
      if (!existingPhotos.length) return reply({ error: '이 친구는 지금 만날 수 없어요.', code: 'PET_NOT_AVAILABLE' }, 404);
      const { status, owner_hash: petOwnerHash, published_accessory, published_style, design_version, ...summary } = pet;
      const date = kstDate();
      const { data: snapshotRow, error: snapshotError } = await supabase.rpc('get_pet_house_snapshot', {
        p_owner_hash: ownerHash,
        p_date: date,
      }).single();
      if (snapshotError || !snapshotRow) throw snapshotError ?? new Error('HOUSE_SNAPSHOT_UNAVAILABLE');
      const snapshot = (snapshotRow as { snapshot: HouseSnapshot }).snapshot;
      const activeReveal = snapshot.activeReveals.find((reveal) => reveal.petId === petId);
      const uploadReward = snapshot.uploadReward
        ? { pet_id: snapshot.uploadReward.petId, used_at: snapshot.uploadReward.usedAt }
        : null;
      const isMine = petOwnerHash === ownerHash;
      const rewards = apiVersion === 2 ? await getRewardState(ownerHash, albumEnabled) : undefined;
      const albumState = albumEnabled ? (await albumApi.states(ownerHash, [petId])).get(petId) : undefined;
      return reply({
        pet: {
          ...summary,
          publishedAccessory: published_accessory ?? undefined,
          publishedStyle: published_style ?? undefined,
          designVersion: design_version ?? 1,
          photoAvailable: true,
          ownerPhotoAvailable: canOpenOwnerPhoto({ status, isOwner: isMine, hasExistingPhoto: true }),
          isMine,
          ownerPinned: isMine,
          approvalStatus: status,
          shareable: true,
          revealedToday: Boolean(activeReveal),
          revisitUntil: activeReveal?.revisitUntil,
          ...(albumEnabled ? albumSummaryFields(albumState) : {}),
        },
        allowance: apiVersion === 2
          ? rewardAllowance(allowancePayloadV2(
              date,
              snapshot.freeAllowance,
              snapshot.todayReveals.filter((item) => item.unlockMethod === 'REWARDED').length,
              uploadReward,
            ), rewards!)
          : allowancePayload(
              date,
              snapshot.freeAllowance,
              snapshot.todayReveals.filter((item) => item.unlockMethod === 'REWARDED').length,
              uploadReward,
            ),
        ...(rewards ? { rewardStatus: rewardStatusPayload(rewards,
          allowancePayloadV2(date, snapshot.freeAllowance, rewards.adsCompletedToday, uploadReward), rewardFlags()) } : {}),
      });
    }

    if (action === 'mine') {
      const [pets, activeRows] = await Promise.all([
        collectKeysetPages<OwnedPetRow>(async (cursor, size) => {
          let query = supabase.from('pets')
          .select('id,name,traits,status,created_at,rejection_reason,published_accessory,published_style,design_version')
          .eq('owner_hash', ownerHash)
          // Keep the owner's full submission history visible. A soft-deleted
          // record remains as a status row; only an explicit privacy deletion
          // removes the underlying record and photo.
          .order('created_at', { ascending: false }).order('id', { ascending: false }).limit(size);
          if (cursor) query = query.or(`created_at.lt.${cursor.created_at},and(created_at.eq.${cursor.created_at},id.lt.${cursor.id})`);
          const { data, error } = await query;
          if (error) throw error;
          return (data ?? []) as OwnedPetRow[];
        }),
        getActiveReveals(ownerHash),
      ]);
      const activeReveals = activeRevisitMap(activeRows);
      const existingPhotoPetIds = new Set(
        (await getExistingPetPhotos((pets ?? []).map((pet) => pet.id))).map((photo) => photo.pet_id),
      );
      const albumStates = albumEnabled ? await albumApi.states(ownerHash, pets.map((pet) => pet.id)) : undefined;
      return reply({ pets: (pets ?? []).map(({ status, created_at, rejection_reason, published_accessory, published_style, design_version, ...pet }) => ({
        ...pet,
        publishedAccessory: published_accessory ?? undefined,
        publishedStyle: published_style ?? undefined,
        designVersion: design_version ?? 1,
        photoAvailable: existingPhotoPetIds.has(pet.id),
        ownerPhotoAvailable: canOpenOwnerPhoto({
          status,
          isOwner: true,
          hasExistingPhoto: existingPhotoPetIds.has(pet.id),
        }),
        isMine: true,
        ownerPinned: true,
        approvalStatus: status,
        createdAt: created_at,
        rejectionReason: rejection_reason ?? undefined,
        shareable: isShareablePetStatus(status),
        revealedToday: activeReveals.has(pet.id),
        revisitUntil: activeReveals.get(pet.id)?.revisit_until,
        ...(albumStates ? { ...albumSummaryFields(albumStates.get(pet.id)), favoriteCount: albumStates.get(pet.id)?.favoriteCount ?? 0 } : {}),
      })) });
    }

    if (action === 'ownerPhoto') {
      const petId = requireUuid(body.petId);
      const { data: pet, error: petError } = await supabase.from('pets')
        .select('id,status,owner_hash')
        .eq('id', petId)
        .maybeSingle();
      if (petError) throw petError;
      if (!pet) throw new ApiError('PET_NOT_AVAILABLE', 404, '이 친구는 지금 만날 수 없어요.');
      if (pet.owner_hash !== ownerHash) {
        throw new ApiError('OWNER_PHOTO_FORBIDDEN', 403, '본인이 소개한 강아지 사진만 볼 수 있어요.');
      }
      const existingPhotos = await getExistingPetPhotos([petId]);
      if (!canOpenOwnerPhoto({
        status: pet.status,
        isOwner: true,
        hasExistingPhoto: existingPhotos.length > 0,
      })) {
        throw new ApiError('OWNER_PHOTO_NOT_AVAILABLE', 404, '지금은 사진을 볼 수 없어요.');
      }

      const date = kstDate();
      // A failed signature must not record a photo visit. The download can
      // still fail after this server response, so retries keep the daily key.
      const signedPhoto = await createPetPhotoSignedResult(petId, ownerHash, date, true, albumEnabled);
      const { error: viewError } = await supabase.from('daily_pet_views').upsert({
        owner_hash: ownerHash,
        view_date: date,
        pet_id: petId,
      }, {
        onConflict: 'owner_hash,view_date,pet_id',
        ignoreDuplicates: true,
      });
      if (viewError) throw viewError;
      return reply({
        ...signedPhoto,
        signedUrlExpiresAt: new Date(Date.now() + 600_000).toISOString(),
        ownerPhotoAvailable: true,
      });
    }

    if (action === 'reveal') {
      const petId = requireUuid(body.petId);
      const date = kstDate();
      if (albumEnabled && body.unlockMethod !== 'UPLOAD') {
        // The ad switch gates new starts, not an already earned credit. The
        // atomic photo RPC verifies its owner, dog and completed status before
        // consuming it once; replay never consumes an ad credit.
        const result = await albumApi.reveal(ownerHash, body, date);
        const rewardStatus = await currentRewardStatus(ownerHash, albumEnabled);
        return reply({ ...result, allowance: rewardStatus.allowance, rewardStatus });
      }
      if (apiVersion === 2 && body.requestId !== undefined && body.revisit !== true && body.unlockMethod !== 'UPLOAD') {
        const requestId = requireUuid(body.requestId, '사진 요청을 다시 확인해 주세요.');
        if (typeof body.unlockMethod !== 'string' || !['FREE', 'SHARE', 'REWARDED'].includes(body.unlockMethod)) {
          throw new ApiError('INVALID_UNLOCK_METHOD', 400, '올바르지 않은 티켓 방식이에요.');
        }
        const { data, error } = await supabase.rpc('record_pet_reveal_v4', {
          p_owner_hash: ownerHash, p_reveal_date: date, p_pet_id: petId,
          p_unlock_method: body.unlockMethod, p_request_id: requestId,
          p_ad_session_id: body.adSessionId === undefined ? null : requireUuid(body.adSessionId),
        });
        if (error) throw rewardRpcError(error);
        const result = data as AtomicRevealResult & { revealDate?: string; unlockMethod?: string };
        if (!result?.revisitUntil || !isRevisitActive(result.revisitUntil)) {
          throw new ApiError('PET_REVISIT_EXPIRED', 403, '다시 만날 수 있는 시간이 지났어요. 티켓으로 다시 만나주세요.');
        }
        const signedPhoto = await createPetPhotoSignedResult(petId, ownerHash, result.revealDate ?? date, false);
        const status = await currentRewardStatus(ownerHash, albumEnabled);
        return reply({
          apiVersion: 2, ...result, ...signedPhoto,
          signedUrlExpiresAt: new Date(Date.now() + 600_000).toISOString(),
          allowance: status.allowance, rewardStatus: status,
        });
      }
      const [{ data: reveals, error: revealError }, activeRows] = await Promise.all([
        supabase.from('daily_reveals')
          .select('unlock_method,pet_id')
          .eq('owner_hash', ownerHash)
          .eq('reveal_date', date),
        getActiveReveals(ownerHash, petId),
      ]);
      if (revealError) throw revealError;
      const revealRows = reveals ?? [];
      const activeReveal = activeRows[0];
      const rewardState = await getRewardState(ownerHash, albumEnabled);
      const rewardedUsed = Math.max(rewardState.adsCompletedToday,
        revealRows.filter((item) => item.unlock_method === 'REWARDED').length);
      const { data: uploadReward, error: uploadCheckError } = await supabase.from('upload_rewards')
        .select('pet_id,used_at')
        .eq('owner_hash', ownerHash)
        .eq('reward_date', date)
        .maybeSingle();
      if (uploadCheckError) throw uploadCheckError;
      const uploadUsed = Boolean(uploadReward?.used_at);
      const freeAllowance = await getFreeAllowance(ownerHash);
      const currentAllowance = rewardAllowance(apiVersion === 2
        ? allowancePayloadV2(date, freeAllowance, rewardedUsed, uploadReward)
        : allowancePayload(date, freeAllowance, rewardedUsed, uploadReward), rewardState);

      if (activeReveal) {
        const signedPhoto = await createPetPhotoSignedResult(petId, ownerHash, activeReveal.reveal_date, true, albumEnabled);
        const dailyProgress = apiVersion === 2
          ? await markDailyHousePetMet(ownerHash, date, petId)
          : undefined;
        return reply({
          ...(apiVersion === 2 ? { apiVersion: 2 } : {}),
          ...signedPhoto,
          signedUrlExpiresAt: new Date(Date.now() + 600_000).toISOString(),
          revisitUntil: activeReveal.revisit_until,
          allowance: apiVersion === 2 ? rewardAllowance(currentAllowance, await getRewardState(ownerHash, albumEnabled)) : currentAllowance,
          ...(dailyProgress ? { dailyProgress } : {}),
        });
      }

      if (body.revisit === true) {
        throw new ApiError('PET_REVISIT_EXPIRED', 403, '다시 만날 수 있는 시간이 지났어요. 티켓으로 다시 만나주세요.');
      }

      if (typeof body.unlockMethod !== 'string' || !['FREE', 'REWARDED', 'UPLOAD'].includes(body.unlockMethod)) {
        throw new ApiError('INVALID_UNLOCK_METHOD', 400, '올바르지 않은 해금 방식이에요.');
      }
      const unlockMethod = body.unlockMethod as 'FREE' | 'REWARDED' | 'UPLOAD';
      if (unlockMethod === 'REWARDED' && Deno.env.get('AIT_REWARDED_ADS_ENABLED') !== 'true') {
        throw new ApiError('REWARDED_ADS_DISABLED', 403, '광고 만남은 아직 준비 중이에요.');
      }
      const adSessionId = unlockMethod === 'REWARDED'
        ? requireUuid(body.adSessionId, '광고 완료 값을 다시 확인해 주세요.')
        : undefined;
      if (unlockMethod === 'FREE' && freeAllowance.remaining < 1) throw new ApiError('FREE_ALLOWANCE_EMPTY', 409, '티켓은 3시간마다 한 장씩 충전돼요.');
      if (unlockMethod === 'REWARDED' && freeAllowance.remaining > 0) throw new ApiError('FREE_ALLOWANCE_AVAILABLE', 409, '충전된 티켓으로 먼저 만나보세요.');
      if (unlockMethod === 'REWARDED' && rewardState.bonusTickets > 0) throw new ApiError('BONUS_ALLOWANCE_AVAILABLE', 409, '보너스 티켓으로 먼저 만나보세요.');
      if (unlockMethod === 'REWARDED' && rewardedUsed >= MAX_REWARDED_PER_DAY) throw new ApiError('DAILY_LIMIT_REACHED', 409, '오늘의 광고 보상을 모두 받았어요. 티켓 충전을 기다려 주세요.');
      if (unlockMethod === 'UPLOAD') {
        if (uploadUsed) return reply({ error: '사진 등록으로 받은 만남을 이미 사용했어요.', code: 'UPLOAD_REWARD_USED' }, 409);
        if (!uploadReward || uploadReward.pet_id !== petId) return reply({ error: '등록한 강아지에게만 쓸 수 있는 만남이에요.', code: 'UPLOAD_REWARD_MISMATCH' }, 403);
      }

      const signedPhoto = await createPetPhotoSignedResult(petId, ownerHash, date, unlockMethod === 'UPLOAD', albumEnabled);
      const recordArgs = {
        p_owner_hash: ownerHash, p_reveal_date: date, p_pet_id: petId,
        p_unlock_method: unlockMethod, p_ad_session_id: adSessionId ?? null,
      };
      const { data: recordedResult, error: recordError } = apiVersion === 2
        ? await supabase.rpc('record_pet_reveal_v3', recordArgs)
        : await supabase.rpc('record_pet_reveal_v2', recordArgs);
      if (recordError) {
        if (recordError.message.includes('PET_REVISIT_ACTIVE')) {
          const concurrentReveal = (await getActiveReveals(ownerHash, petId))[0];
          if (concurrentReveal) {
            const [latestFreeAllowance, { data: latestRows, error: latestRowsError }, { data: latestReward, error: latestRewardError }] = await Promise.all([
              getFreeAllowance(ownerHash),
              supabase.from('daily_reveals').select('unlock_method').eq('owner_hash', ownerHash).eq('reveal_date', date),
              supabase.from('upload_rewards').select('pet_id,used_at').eq('owner_hash', ownerHash).eq('reward_date', date).maybeSingle(),
            ]);
            if (latestRowsError || latestRewardError) throw latestRowsError ?? latestRewardError;
            const concurrentSignedPhoto = await createPetPhotoSignedResult(petId, ownerHash, concurrentReveal.reveal_date, true);
            const dailyProgress = apiVersion === 2
              ? await markDailyHousePetMet(ownerHash, date, petId)
              : undefined;
            return reply({
              ...(apiVersion === 2 ? { apiVersion: 2 } : {}),
              ...concurrentSignedPhoto,
              signedUrlExpiresAt: new Date(Date.now() + 600_000).toISOString(),
              revisitUntil: concurrentReveal.revisit_until,
              allowance: apiVersion === 2
                ? allowancePayloadV2(
                    date,
                    latestFreeAllowance,
                    (latestRows ?? []).filter((item) => item.unlock_method === 'REWARDED').length,
                    latestReward,
                  )
                : allowancePayload(
                    date,
                    latestFreeAllowance,
                    (latestRows ?? []).filter((item) => item.unlock_method === 'REWARDED').length,
                    latestReward,
                  ),
              ...(dailyProgress ? { dailyProgress } : {}),
            });
          }
        }
        throw rewardRpcError(recordError);
      }
      const atomicResult = apiVersion === 2 && recordedResult && typeof recordedResult === 'object'
        ? recordedResult as AtomicRevealResult
        : undefined;
      let revisitUntil = apiVersion === 2
        ? atomicResult?.revisitUntil
        : typeof recordedResult === 'string' ? recordedResult : undefined;
      if (!revisitUntil) revisitUntil = (await getActiveReveals(ownerHash, petId))[0]?.revisit_until;
      if (!revisitUntil) throw new Error('REVISIT_WINDOW_NOT_RECORDED');
      const latestFreeAllowance = unlockMethod === 'FREE'
        ? await getFreeAllowance(ownerHash)
        : freeAllowance;
      const dailyProgress = apiVersion === 2 ? atomicResult?.dailyProgress : undefined;
      if (apiVersion === 2 && !dailyProgress) throw new Error('DAILY_HOUSE_PROGRESS_NOT_RECORDED');
      return reply({
        ...(apiVersion === 2 ? { apiVersion: 2 } : {}),
        ...signedPhoto,
        signedUrlExpiresAt: new Date(Date.now() + 600_000).toISOString(),
        revisitUntil,
        allowance: {
          ...(apiVersion === 2
            ? allowancePayloadV2(
                date,
                latestFreeAllowance,
                rewardedUsed + (unlockMethod === 'REWARDED' ? 1 : 0),
                uploadReward,
              )
            : allowancePayload(
                date,
                latestFreeAllowance,
                rewardedUsed + (unlockMethod === 'REWARDED' ? 1 : 0),
                uploadReward,
              )),
          uploadUsed: uploadUsed || unlockMethod === 'UPLOAD',
        },
        ...(dailyProgress ? { dailyProgress } : {}),
      });
    }

    if (action === 'submitPhoto') {
      if (Deno.env.get('AIT_UPLOADS_ENABLED') !== 'true') {
        throw new ApiError('UPLOADS_DISABLED', 503, '사진 소개는 지금 준비 중이에요. 잠시 뒤 다시 시도해 주세요.');
      }
      const submissionId = requireUuid(body.submissionId, '사진 등록 요청을 다시 시작해 주세요.').toLowerCase();
      const { photoIndex, dataUri } = requirePhotoUploadInput(body);
      const photo = decodeDataUri(dataUri);
      return reply(await uploadSubmissionPhoto(submissionClient, { ownerHash, submissionId, photoIndex }, photo,
        Deno.env.get('USER_HASH_SALT') ?? ''), 201);
    }

    if (action === 'submit') {
      if (Deno.env.get('AIT_UPLOADS_ENABLED') !== 'true') {
        return reply({ error: '사진 소개는 지금 준비 중이에요. 잠시 뒤 다시 시도해 주세요.', code: 'UPLOADS_DISABLED' }, 503);
      }
      const submissionId = requireUuid(body.submissionId, '사진 등록 요청을 다시 시작해 주세요.').toLowerCase();
      const date = kstDate();
      const existing = await findSubmissionResult(ownerHash, submissionId, date);
      if (existing) return reply(existing);
      const normalizedName = requirePetName(body.name);
      const staged = hasSubmissionPhotoReceipts(body);
      // Hosted Edge CPU limits allow one normalization per request. Multi-photo
      // finalization verifies compact receipts and performs no JPEG decoding.
      const receipts = staged ? await verifyPhotoReceipts(body.photoReceipts, { ownerHash, submissionId },
        Deno.env.get('USER_HASH_SALT') ?? '') : undefined;
      const photos = staged ? undefined : [decodeDataUri(requireDirectSubmissionDataUri(body))];
      const traits = requirePetTraits(body.traits);
      const style = requirePetStyle(body.style ?? {
        schemaVersion: 1,
        coatMode: traits.baseColor === traits.secondaryColor && traits.markingPattern === 'none' ? 'solid' : 'point',
        furStyle: 'neat',
      }, traits);
      const accessorySubmission = requireAccessorySubmission(body.accessorySelectionMode, body.requestedAccessory);
      const id = crypto.randomUUID();
      const registrationArgs = {
        p_owner_hash: ownerHash,
        p_submission_id: submissionId,
        p_pet_id: id,
        p_name: normalizedName,
        p_traits: traits,
        p_style: style,
        p_reveal_date: date,
        p_global_daily_limit: boundedEnvInteger('AIT_DAILY_UPLOAD_LIMIT', 25, 500),
        p_global_pending_limit: boundedEnvInteger('AIT_PENDING_UPLOAD_LIMIT', 100, 1000),
        p_accessory_selection_mode: accessorySubmission.mode,
        p_requested_accessory: accessorySubmission.requestedAccessory,
      };
      const recover = () => findSubmissionResult(ownerHash, submissionId, date);
      const submitted = receipts
        ? await registerSubmissionPhotoPaths(submissionClient, registrationArgs, receipts.map((photo) => photo.storagePath), recover)
        : await registerSubmissionPhotos(submissionClient, registrationArgs, photos!, recover);
      if (submitted.recovered) return reply(submitted.recovered);
      const registration = submitted.registration;
      const rewardGranted = Boolean(registration.reward_granted);
      const registeredPetId = registration.pet_id;
      return reply({
        pet: {
          id: registeredPetId,
          name: normalizedName,
          traits,
          photoAvailable: true,
          ownerPhotoAvailable: true,
          isMine: true,
          ownerPinned: true,
          approvalStatus: 'pending',
          shareable: true,
          publishedAccessory: accessorySubmission.mode === 'owner' ? accessorySubmission.requestedAccessory ?? undefined : undefined,
          publishedStyle: style,
          designVersion: 1,
        },
        rewardGranted,
        uploadRewardPetId: rewardGranted ? registeredPetId : undefined,
      }, 201);
    }

    if (action === 'report') {
      const petId = requireUuid(body.petId);
      const reason = typeof body.reason === 'string' && ['inappropriate', 'not_dog', 'privacy', 'copyright', 'other'].includes(body.reason) ? body.reason : 'other';
      const { error } = await supabase.from('reports').insert({ pet_id: petId, reporter_hash: ownerHash, reason });
      if (error && error.code !== '23505') throw error;
      return reply({ reported: true });
    }

    return reply({ error: '알 수 없는 요청이에요.', code: 'INVALID_ACTION' }, 404);
  } catch (error) {
    let recovery: Record<string, unknown> = {};
    if (verifiedOwnerHash && !photoAdditionRequest && !photoPrepareRequest) {
      try {
        const state = await currentRewardStatus(verifiedOwnerHash, albumRewardClient);
        recovery = { allowance: state.allowance, nextChargeAt: state.allowance.nextChargeAt };
      } catch { /* Preserve the original failure if allowance lookup is also unavailable. */ }
    }
    if (error instanceof ApiError) {
      return reply({ error: error.message, code: error.code, ...recovery,
        ...(error.status === 429 || error.status === 503 ? { retryAfter: 5 } : {}) }, error.status);
    }
    const requestId = crypto.randomUUID();
    console.error('pet-api unhandled error', { requestId, error });
    return reply({ error: '서버에서 요청을 완료하지 못했어요. 잠시 뒤 다시 시도해 주세요.', code: 'INTERNAL_ERROR', requestId, ...recovery }, 500);
  }
});
