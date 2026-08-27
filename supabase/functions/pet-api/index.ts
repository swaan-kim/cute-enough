import { createClient } from 'npm:@supabase/supabase-js@2.57.4';
import { verifyAnonymousKey } from '../_shared/anonymous-key.ts';
import { ApiError } from '../_shared/api-error.ts';
import { corsGuard, json } from '../_shared/cors.ts';
import { orderDailyPets } from '../_shared/daily-pool.ts';
import { decodeDataUri, hashUser, kstDate } from '../_shared/security.ts';
import {
  canRevealStoredPetPhoto,
  isShareablePetStatus,
  OWNER_VISIBLE_PET_STATUSES,
  SHARED_CHARACTER_PET_STATUSES,
  wasPetRevealedToday,
} from '../_shared/pet-visibility.ts';
import {
  normalizePetName,
  requireAction,
  requireAnonymousKey,
  requirePetTraits,
  requireUuid,
  type PetApiAction,
} from '../_shared/validation.ts';

const supabase = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  { auth: { persistSession: false } },
);

const DAILY_FREE_PETS = 2;
const MAX_REWARDED_PER_DAY = 2;
const HOUSE_PET_LIMIT = 5;

type FreeAllowance = { remaining: number; nextChargeAt?: string };

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

async function selectDailyPhotoPath(petId: string, ownerHash: string, date: string, paths: string[]): Promise<string> {
  if (paths.length === 1) return paths[0];
  const encoded = new TextEncoder().encode(`photo-v1:${petId}:${ownerHash}:${date}`);
  const digest = await crypto.subtle.digest('SHA-256', encoded);
  const index = new DataView(digest).getUint32(0, false) % paths.length;
  return paths[index];
}

async function createPetPhotoSignedUrl(
  petId: string,
  ownerHash: string,
  date: string,
  allowPendingOwner: boolean,
): Promise<string> {
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

  const { data: photos, error: photoError } = await supabase.from('pet_photos')
    .select('storage_path,sort_order')
    .eq('pet_id', pet.id)
    .eq('is_active', true)
    .order('sort_order', { ascending: true });
  if (photoError) throw photoError;
  if (!photos?.length) {
    throw new ApiError('PHOTO_NOT_REVEALABLE', 404, '공개할 수 있는 사진이 없어요.');
  }
  const photoPaths = photos.map((photo) => photo.storage_path);
  const selectedPath = await selectDailyPhotoPath(pet.id, ownerHash, date, photoPaths);
  const { data: signed, error: signError } = await supabase.storage.from('pet-photos').createSignedUrl(selectedPath, 600);
  if (signError) throw signError;
  return signed.signedUrl;
}

const RATE_LIMITS: Record<PetApiAction, { seconds: number; limit: number }> = {
  house: { seconds: 60, limit: 60 },
  shared: { seconds: 60, limit: 60 },
  mine: { seconds: 60, limit: 30 },
  reveal: { seconds: 60, limit: 10 },
  submit: { seconds: 60 * 60, limit: 3 },
  report: { seconds: 60 * 60, limit: 10 },
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

Deno.serve(async (request) => {
  const reply = (data: unknown, status = 200) => json(request, data, status);
  const corsResponse = corsGuard(request);
  if (corsResponse) return corsResponse;
  if (request.method !== 'POST') return reply({ error: '지원하지 않는 요청 방식이에요.', code: 'METHOD_NOT_ALLOWED' }, 405);
  const contentLength = Number(request.headers.get('Content-Length') ?? 0);
  if (contentLength > 6 * 1024 * 1024) return reply({ error: '요청한 사진 용량이 너무 커요.', code: 'REQUEST_TOO_LARGE' }, 413);
  try {
    const body = await request.json().catch(() => { throw new ApiError('INVALID_JSON', 400, '요청 내용을 확인해 주세요.'); }) as Record<string, unknown>;
    const action = requireAction(body.action);
    const anonymousKey = requireAnonymousKey(body.userHash);
    await verifyAnonymousKey(anonymousKey);
    const ownerHash = await hashUser(anonymousKey);
    await enforceRateLimit(ownerHash, action);

    if (action === 'house') {
      const date = kstDate();
      const { data: reveals, error: revealError } = await supabase.from('daily_reveals').select('unlock_method,pet_id').eq('owner_hash', ownerHash).eq('reveal_date', date);
      if (revealError) throw revealError;
      const [{ data: uploadReward, error: rewardError }, freeAllowance] = await Promise.all([
        supabase.from('upload_rewards').select('pet_id,used_at').eq('owner_hash', ownerHash).eq('reward_date', date).maybeSingle(),
        getFreeAllowance(ownerHash),
      ]);
      if (rewardError) throw rewardError;
      const revealedPetIds = new Set(reveals.map((item) => item.pet_id));
      const [{ data: ownedPets, error: ownedError }, { data: approvedPets, error: approvedError }] = await Promise.all([
        supabase.from('pets')
          .select('id,name,traits,status,pet_photos!inner(id)')
          .eq('owner_hash', ownerHash)
          .in('status', [...OWNER_VISIBLE_PET_STATUSES])
          .eq('pet_photos.is_active', true)
          .order('created_at', { ascending: false })
          .limit(1),
        supabase.from('pets')
          .select('id,name,traits,pet_photos!inner(id)')
          .eq('status', 'approved')
          .neq('owner_hash', ownerHash)
          .eq('pet_photos.is_active', true)
          .order('reviewed_at', { ascending: false, nullsFirst: false })
          .order('created_at', { ascending: false })
          .limit(200),
      ]);
      if (ownedError || approvedError) throw ownedError ?? approvedError;
      const owned = (ownedPets ?? []).map(({ status, pet_photos: _photoRows, ...pet }) => ({
        ...pet,
        photoAvailable: true,
        isMine: true,
        ownerPinned: true,
        approvalStatus: status,
        shareable: true,
        revealedToday: revealedPetIds.has(pet.id),
      }));
      const primaryOwnedPet = owned[0];
      const candidateSummaries = (approvedPets ?? []).map(({ pet_photos: _photoRows, ...pet }) => ({
          ...pet,
          photoAvailable: true,
          isMine: false,
          ownerPinned: false,
          approvalStatus: 'approved',
          shareable: true,
          revealedToday: revealedPetIds.has(pet.id),
        }));
      const publicSlots = HOUSE_PET_LIMIT - (primaryOwnedPet ? 1 : 0);
      const selectedPublicPets = orderDailyPets(candidateSummaries, ownerHash, date).slice(0, publicSlots);
      const pool = [...(primaryOwnedPet ? [primaryOwnedPet] : []), ...selectedPublicPets];
      const rewardedUsed = reveals.filter((item) => item.unlock_method === 'REWARDED').length;
      return reply({
        pets: pool,
        allowance: allowancePayload(date, freeAllowance, rewardedUsed, uploadReward),
      });
    }

    if (action === 'shared') {
      const petId = requireUuid(body.petId);
      const { data: pet, error } = await supabase.from('pets')
        .select('id,name,traits,status,owner_hash,pet_photos!inner(id)')
        .eq('id', petId)
        .in('status', [...SHARED_CHARACTER_PET_STATUSES])
        .eq('pet_photos.is_active', true)
        .maybeSingle();
      if (error) throw error;
      if (!pet) return reply({ error: '이 친구는 지금 만날 수 없어요.', code: 'PET_NOT_AVAILABLE' }, 404);
      const { status, owner_hash: petOwnerHash, pet_photos: _photoRows, ...summary } = pet;
      const date = kstDate();
      const [{ data: reveals, error: revealError }, { data: uploadReward, error: rewardError }, freeAllowance] = await Promise.all([
        supabase.from('daily_reveals').select('unlock_method,pet_id').eq('owner_hash', ownerHash).eq('reveal_date', date),
        supabase.from('upload_rewards').select('pet_id,used_at').eq('owner_hash', ownerHash).eq('reward_date', date).maybeSingle(),
        getFreeAllowance(ownerHash),
      ]);
      if (revealError || rewardError) throw revealError ?? rewardError;
      return reply({
        pet: {
          ...summary,
          photoAvailable: true,
          isMine: petOwnerHash === ownerHash,
          ownerPinned: petOwnerHash === ownerHash,
          approvalStatus: status,
          shareable: true,
          revealedToday: reveals.some((item) => item.pet_id === petId),
        },
        allowance: allowancePayload(
          date,
          freeAllowance,
          reveals.filter((item) => item.unlock_method === 'REWARDED').length,
          uploadReward,
        ),
      });
    }

    if (action === 'mine') {
      const date = kstDate();
      const [{ data: pets, error }, { data: reveals, error: revealError }] = await Promise.all([
        supabase.from('pets')
          .select('id,name,traits,status,created_at,rejection_reason')
          .eq('owner_hash', ownerHash)
          .neq('status', 'deleted')
          .order('created_at', { ascending: false })
          .limit(50),
        supabase.from('daily_reveals')
          .select('pet_id')
          .eq('owner_hash', ownerHash)
          .eq('reveal_date', date),
      ]);
      if (error || revealError) throw error ?? revealError;
      const revealedPetIds = new Set((reveals ?? []).map((item) => item.pet_id));
      return reply({ pets: pets.map(({ status, created_at, rejection_reason, ...pet }) => ({
        ...pet,
        isMine: true,
        ownerPinned: true,
        approvalStatus: status,
        createdAt: created_at,
        rejectionReason: rejection_reason ?? undefined,
        shareable: isShareablePetStatus(status),
        revealedToday: wasPetRevealedToday(pet.id, revealedPetIds),
      })) });
    }

    if (action === 'reveal') {
      const petId = requireUuid(body.petId);
      const date = kstDate();
      const { data: reveals, error: revealError } = await supabase.from('daily_reveals')
        .select('unlock_method,pet_id')
        .eq('owner_hash', ownerHash)
        .eq('reveal_date', date);
      if (revealError) throw revealError;
      const revealRows = reveals ?? [];
      const rewardedUsed = revealRows.filter((item) => item.unlock_method === 'REWARDED').length;
      const { data: uploadReward, error: uploadCheckError } = await supabase.from('upload_rewards')
        .select('pet_id,used_at')
        .eq('owner_hash', ownerHash)
        .eq('reward_date', date)
        .maybeSingle();
      if (uploadCheckError) throw uploadCheckError;
      const uploadUsed = Boolean(uploadReward?.used_at);
      const freeAllowance = await getFreeAllowance(ownerHash);
      const currentAllowance = allowancePayload(date, freeAllowance, rewardedUsed, uploadReward);

      if (body.revisit === true) {
        if (!revealRows.some((item) => item.pet_id === petId)) {
          throw new ApiError('PET_NOT_REVEALED_TODAY', 403, '오늘 만난 사진만 다시 볼 수 있어요.');
        }
        const photoUrl = await createPetPhotoSignedUrl(petId, ownerHash, date, true);
        return reply({
          photoUrl,
          signedUrlExpiresAt: new Date(Date.now() + 600_000).toISOString(),
          allowance: currentAllowance,
        });
      }

      if (typeof body.unlockMethod !== 'string' || !['FREE', 'REWARDED', 'UPLOAD'].includes(body.unlockMethod)) {
        throw new ApiError('INVALID_UNLOCK_METHOD', 400, '올바르지 않은 해금 방식이에요.');
      }
      const unlockMethod = body.unlockMethod as 'FREE' | 'REWARDED' | 'UPLOAD';
      if (unlockMethod === 'REWARDED' && Deno.env.get('AIT_REWARDED_ADS_ENABLED') !== 'true') {
        return reply({ error: '광고 만남은 아직 준비 중이에요.', code: 'REWARDED_ADS_DISABLED' }, 403);
      }
      const adSessionId = unlockMethod === 'REWARDED'
        ? requireUuid(body.adSessionId, '광고 완료 값을 다시 확인해 주세요.')
        : undefined;
      if (unlockMethod === 'FREE' && freeAllowance.remaining < 1) return reply({
        error: '이용권은 3시간마다 한 마리씩 충전돼요.',
        code: 'FREE_ALLOWANCE_EMPTY',
        nextChargeAt: freeAllowance.nextChargeAt,
      }, 409);
      if (unlockMethod === 'REWARDED' && rewardedUsed >= MAX_REWARDED_PER_DAY) return reply({ error: '오늘의 귀여움은 여기까지예요\n내일 다시 만나요', code: 'DAILY_LIMIT_REACHED' }, 409);
      if (unlockMethod === 'UPLOAD') {
        if (uploadUsed) return reply({ error: '사진 등록으로 받은 만남을 이미 사용했어요.', code: 'UPLOAD_REWARD_USED' }, 409);
        if (!uploadReward || uploadReward.pet_id !== petId) return reply({ error: '등록한 강아지에게만 쓸 수 있는 만남이에요.', code: 'UPLOAD_REWARD_MISMATCH' }, 403);
      }

      const photoUrl = await createPetPhotoSignedUrl(petId, ownerHash, date, unlockMethod === 'UPLOAD');
      const { error: recordError } = await supabase.rpc('record_pet_reveal', {
        p_owner_hash: ownerHash, p_reveal_date: date, p_pet_id: petId,
        p_unlock_method: unlockMethod, p_ad_session_id: adSessionId ?? null,
      });
      if (recordError) {
        if (recordError.message.includes('FREE_ALLOWANCE_EMPTY')) {
          const latestFreeAllowance = await getFreeAllowance(ownerHash);
          return reply({
            error: '이용권은 3시간마다 한 마리씩 충전돼요.',
            code: 'FREE_ALLOWANCE_EMPTY',
            nextChargeAt: latestFreeAllowance.nextChargeAt,
          }, 409);
        }
        return reply({ error: '이미 사용했거나 만료된 해금이에요.', code: 'UNLOCK_ALREADY_USED' }, 409);
      }
      const latestFreeAllowance = unlockMethod === 'FREE'
        ? await getFreeAllowance(ownerHash)
        : freeAllowance;
      return reply({
        photoUrl,
        signedUrlExpiresAt: new Date(Date.now() + 600_000).toISOString(),
        allowance: {
          ...allowancePayload(
            date,
            latestFreeAllowance,
            rewardedUsed + (unlockMethod === 'REWARDED' ? 1 : 0),
            uploadReward,
          ),
          uploadUsed: uploadUsed || unlockMethod === 'UPLOAD',
        },
      });
    }

    if (action === 'submit') {
      if (Deno.env.get('AIT_UPLOADS_ENABLED') !== 'true') {
        return reply({ error: '사진 소개는 지금 준비 중이에요. 잠시 뒤 다시 시도해 주세요.', code: 'UPLOADS_DISABLED' }, 503);
      }
      const submissionId = requireUuid(body.submissionId, '사진 등록 요청을 다시 시작해 주세요.');
      const date = kstDate();
      const { data: existing, error: existingError } = await supabase.from('pets')
        .select('id,name,traits,status')
        .eq('owner_hash', ownerHash)
        .eq('submission_id', submissionId)
        .maybeSingle();
      if (existingError) throw existingError;
      if (existing) {
        const { data: existingReward, error: existingRewardError } = await supabase.from('upload_rewards')
          .select('pet_id')
          .eq('pet_id', existing.id)
          .eq('owner_hash', ownerHash)
          .eq('reward_date', date)
          .is('used_at', null)
          .maybeSingle();
        if (existingRewardError) throw existingRewardError;
        const { status, ...pet } = existing;
        return reply({
          pet: { ...pet, photoAvailable: true, isMine: true, ownerPinned: true, approvalStatus: status, shareable: isShareablePetStatus(status) },
          rewardGranted: Boolean(existingReward),
          uploadRewardPetId: existingReward ? existing.id : undefined,
        });
      }
      const { bytes, mime } = decodeDataUri(body.dataUri);
      const traits = requirePetTraits(body.traits);
      const normalizedName = normalizePetName(body.name);
      const id = crypto.randomUUID();
      const path = `${ownerHash}/${submissionId}.jpg`;
      const { error: uploadError } = await supabase.storage.from('pet-photos').upload(path, bytes, {
        contentType: mime,
        cacheControl: '3600',
        upsert: true,
      });
      if (uploadError) throw uploadError;
      const { data: registered, error: registerError } = await supabase.rpc('register_pet_submission', {
        p_owner_hash: ownerHash,
        p_submission_id: submissionId,
        p_pet_id: id,
        p_storage_path: path,
        p_name: normalizedName || null,
        p_traits: traits,
        p_reveal_date: date,
        p_global_daily_limit: boundedEnvInteger('AIT_DAILY_UPLOAD_LIMIT', 25, 500),
        p_global_pending_limit: boundedEnvInteger('AIT_PENDING_UPLOAD_LIMIT', 100, 1000),
      }).single();
      if (registerError || !registered) {
        const { data: committed } = await supabase.from('pets')
          .select('id,name,traits,status')
          .eq('owner_hash', ownerHash)
          .eq('submission_id', submissionId)
          .maybeSingle();
        if (committed) {
          const { data: committedReward } = await supabase.from('upload_rewards')
            .select('pet_id')
            .eq('pet_id', committed.id)
            .eq('owner_hash', ownerHash)
            .eq('reward_date', date)
            .is('used_at', null)
            .maybeSingle();
          const { status, ...pet } = committed;
          return reply({
            pet: { ...pet, photoAvailable: true, isMine: true, ownerPinned: true, approvalStatus: status, shareable: isShareablePetStatus(status) },
            rewardGranted: Boolean(committedReward),
            uploadRewardPetId: committedReward ? committed.id : undefined,
          });
        }
        await supabase.storage.from('pet-photos').remove([path]);
        const message = registerError?.message ?? '';
        if (message.includes('DAILY_UPLOAD_LIMIT_REACHED')) throw new ApiError('DAILY_UPLOAD_LIMIT_REACHED', 429, '사진은 하루에 한 장만 소개할 수 있어요.');
        if (message.includes('PENDING_UPLOAD_LIMIT_REACHED')) throw new ApiError('PENDING_UPLOAD_LIMIT_REACHED', 409, '검수 중인 사진이 있어요. 검수가 끝난 뒤 다시 소개해 주세요.');
        if (message.includes('UPLOAD_CAPACITY_REACHED')) throw new ApiError('UPLOAD_CAPACITY_REACHED', 503, '오늘 받을 수 있는 사진이 모두 모였어요. 내일 다시 소개해 주세요.');
        throw registerError ?? new Error('Pet registration failed');
      }
      const rewardGranted = Boolean(registered.reward_granted);
      const registeredPetId = String(registered.pet_id);
      return reply({
        pet: { id: registeredPetId, name: normalizedName || undefined, traits, photoAvailable: true, isMine: true, ownerPinned: true, approvalStatus: 'pending', shareable: true },
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
    if (error instanceof ApiError) return reply({ error: error.message, code: error.code }, error.status);
    const requestId = crypto.randomUUID();
    console.error('pet-api unhandled error', { requestId, error });
    return reply({ error: '서버에서 요청을 완료하지 못했어요. 잠시 뒤 다시 시도해 주세요.', code: 'INTERNAL_ERROR', requestId }, 500);
  }
});
