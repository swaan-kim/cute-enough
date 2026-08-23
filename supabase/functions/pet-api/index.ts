import { createClient } from 'npm:@supabase/supabase-js@2';
import { verifyAnonymousKey } from '../_shared/anonymous-key.ts';
import { ApiError } from '../_shared/api-error.ts';
import { corsHeaders, isAllowedOrigin, json } from '../_shared/cors.ts';
import { decodeDataUri, hashUser, kstDate } from '../_shared/security.ts';
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

function shuffled<T>(items: T[]) {
  return [...items].sort(() => Math.random() - 0.5);
}

const RATE_LIMITS: Record<PetApiAction, { seconds: number; limit: number }> = {
  house: { seconds: 60, limit: 60 },
  shared: { seconds: 60, limit: 60 },
  mine: { seconds: 60, limit: 30 },
  reveal: { seconds: 60, limit: 10 },
  submit: { seconds: 60 * 60, limit: 3 },
  report: { seconds: 60 * 60, limit: 10 },
  delete: { seconds: 60 * 60, limit: 5 },
};

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
  if (!isAllowedOrigin(request)) return reply({ error: '허용되지 않은 요청이에요.', code: 'ORIGIN_NOT_ALLOWED' }, 403);
  if (request.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders(request) });
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
      const { data: reveals, error: revealError } = await supabase.from('daily_reveals').select('unlock_method').eq('owner_hash', ownerHash).eq('reveal_date', date);
      if (revealError) throw revealError;
      const { data: uploadReward, error: rewardError } = await supabase.from('upload_rewards').select('pet_id,used_at').eq('owner_hash', ownerHash).eq('reward_date', date).maybeSingle();
      if (rewardError) throw rewardError;
      const { data, error } = await supabase.from('pets').select('id,name,traits').eq('status', 'approved').limit(100);
      if (error) throw error;
      let rewardPet: Record<string, unknown> | null = null;
      if (uploadReward && !uploadReward.used_at) {
        const { data: owned } = await supabase.from('pets').select('id,name,traits,status').eq('id', uploadReward.pet_id).eq('owner_hash', ownerHash).in('status', ['pending', 'approved']).maybeSingle();
        if (owned) rewardPet = { ...owned, ownerPinned: true, approvalStatus: owned.status, shareable: true };
      }
      const pool = shuffled(data.filter((pet) => pet.id !== uploadReward?.pet_id)).slice(0, rewardPet ? 4 : 5)
        .map((pet) => ({ ...pet, approvalStatus: 'approved', shareable: true }));
      if (rewardPet) pool.splice(2, 0, rewardPet as never);
      const freeUsed = reveals.some((item) => item.unlock_method === 'FREE');
      const rewardedUsed = reveals.filter((item) => item.unlock_method === 'REWARDED').length;
      return reply({
        pets: pool,
        allowance: {
          date, freeUsed, rewardedUsed,
          uploadCredit: Boolean(uploadReward),
          uploadUsed: Boolean(uploadReward?.used_at),
          uploadRewardPetId: uploadReward?.pet_id,
        },
      });
    }

    if (action === 'shared') {
      const petId = requireUuid(body.petId);
      const { data: pet, error } = await supabase.from('pets').select('id,name,traits,status').eq('id', petId).in('status', ['pending', 'approved']).maybeSingle();
      if (error) throw error;
      if (!pet) return reply({ error: '이 친구는 지금 만날 수 없어요.', code: 'PET_NOT_AVAILABLE' }, 404);
      const { status, ...summary } = pet;
      const date = kstDate();
      const [{ data: reveals, error: revealError }, { data: uploadReward, error: rewardError }] = await Promise.all([
        supabase.from('daily_reveals').select('unlock_method').eq('owner_hash', ownerHash).eq('reveal_date', date),
        supabase.from('upload_rewards').select('pet_id,used_at').eq('owner_hash', ownerHash).eq('reward_date', date).maybeSingle(),
      ]);
      if (revealError || rewardError) throw revealError ?? rewardError;
      return reply({
        pet: { ...summary, approvalStatus: status, shareable: true },
        allowance: {
          date,
          freeUsed: reveals.some((item) => item.unlock_method === 'FREE'),
          rewardedUsed: reveals.filter((item) => item.unlock_method === 'REWARDED').length,
          uploadCredit: Boolean(uploadReward),
          uploadUsed: Boolean(uploadReward?.used_at),
          uploadRewardPetId: uploadReward?.pet_id,
        },
      });
    }

    if (action === 'mine') {
      const { data: pets, error } = await supabase.from('pets')
        .select('id,name,traits,status,created_at,rejection_reason')
        .eq('owner_hash', ownerHash)
        .neq('status', 'deleted')
        .order('created_at', { ascending: false })
        .limit(50);
      if (error) throw error;
      return reply({ pets: pets.map(({ status, created_at, rejection_reason, ...pet }) => ({
        ...pet,
        approvalStatus: status,
        createdAt: created_at,
        rejectionReason: rejection_reason ?? undefined,
        shareable: status === 'pending' || status === 'approved',
      })) });
    }

    if (action === 'reveal') {
      const petId = requireUuid(body.petId);
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
      const date = kstDate();
      const { data: reveals, error: revealError } = await supabase.from('daily_reveals').select('unlock_method').eq('owner_hash', ownerHash).eq('reveal_date', date);
      if (revealError) throw revealError;
      const freeUsed = reveals.some((item) => item.unlock_method === 'FREE');
      const rewardedUsed = reveals.filter((item) => item.unlock_method === 'REWARDED').length;
      const { data: uploadReward, error: uploadCheckError } = await supabase.from('upload_rewards').select('pet_id,used_at').eq('owner_hash', ownerHash).eq('reward_date', date).maybeSingle();
      if (uploadCheckError) throw uploadCheckError;
      const uploadUsed = Boolean(uploadReward?.used_at);
      if (unlockMethod === 'FREE' && freeUsed) return reply({ error: '오늘의 무료 사진을 이미 봤어요.', code: 'FREE_ALREADY_USED' }, 409);
      if (unlockMethod === 'REWARDED' && rewardedUsed >= 2) return reply({ error: '오늘의 귀여움은 여기까지예요\n내일 다시 만나요', code: 'DAILY_LIMIT_REACHED' }, 409);
      if (unlockMethod === 'UPLOAD') {
        if (uploadUsed) return reply({ error: '사진 등록으로 받은 만남을 이미 사용했어요.', code: 'UPLOAD_REWARD_USED' }, 409);
        if (!uploadReward || uploadReward.pet_id !== petId) return reply({ error: '등록한 강아지에게만 쓸 수 있는 만남이에요.', code: 'UPLOAD_REWARD_MISMATCH' }, 403);
      }

      const { data: pet, error: petError } = await supabase.from('pets').select('id,storage_path,status,owner_hash').eq('id', petId).single();
      const canReveal = pet && (pet.status === 'approved' || (unlockMethod === 'UPLOAD' && pet.owner_hash === ownerHash && pet.status === 'pending'));
      if (petError || !canReveal) return reply({ error: '공개할 수 없는 사진이에요.', code: 'PHOTO_NOT_REVEALABLE' }, 404);
      const { data: signed, error: signError } = await supabase.storage.from('pet-photos').createSignedUrl(pet.storage_path, 600);
      if (signError) throw signError;
      const { error: recordError } = await supabase.rpc('record_pet_reveal', {
        p_owner_hash: ownerHash, p_reveal_date: date, p_pet_id: pet.id,
        p_unlock_method: unlockMethod, p_ad_session_id: adSessionId ?? null,
      });
      if (recordError) return reply({ error: '이미 사용했거나 만료된 해금이에요.', code: 'UNLOCK_ALREADY_USED' }, 409);
      return reply({
        photoUrl: signed.signedUrl,
        signedUrlExpiresAt: new Date(Date.now() + 600_000).toISOString(),
        allowance: {
          date,
          freeUsed: freeUsed || unlockMethod === 'FREE',
          rewardedUsed: rewardedUsed + (unlockMethod === 'REWARDED' ? 1 : 0),
          uploadCredit: Boolean(uploadReward),
          uploadUsed: uploadUsed || unlockMethod === 'UPLOAD',
          uploadRewardPetId: uploadReward?.pet_id,
        },
      });
    }

    if (action === 'submit') {
      const { bytes, mime } = decodeDataUri(body.dataUri);
      const traits = requirePetTraits(body.traits);
      const normalizedName = normalizePetName(body.name);
      const ext = 'jpg';
      const id = crypto.randomUUID();
      const path = `${ownerHash}/${id}.${ext}`;
      const { error: uploadError } = await supabase.storage.from('pet-photos').upload(path, bytes, { contentType: mime, upsert: false });
      if (uploadError) throw uploadError;
      const { error: insertError } = await supabase.from('pets').insert({
        id, owner_hash: ownerHash, name: normalizedName || null,
        storage_path: path,
        traits,
        status: 'pending',
        moderation: { automatic: 'not_run', source: 'local_color_suggestion', requiresHumanReview: true },
      });
      if (insertError) { await supabase.storage.from('pet-photos').remove([path]); throw insertError; }
      const date = kstDate();
      const { error: rewardError } = await supabase.from('upload_rewards').insert({ owner_hash: ownerHash, reward_date: date, pet_id: id });
      const rewardGranted = !rewardError;
      if (rewardError && rewardError.code !== '23505') throw rewardError;
      return reply({
        pet: { id, name: normalizedName || undefined, traits, ownerPinned: rewardGranted, approvalStatus: 'pending', shareable: true },
        rewardGranted,
        uploadRewardPetId: rewardGranted ? id : undefined,
      }, 201);
    }

    if (action === 'report') {
      const petId = requireUuid(body.petId);
      const reason = typeof body.reason === 'string' && ['inappropriate', 'not_dog', 'privacy', 'copyright', 'other'].includes(body.reason) ? body.reason : 'other';
      const { error } = await supabase.from('reports').insert({ pet_id: petId, reporter_hash: ownerHash, reason });
      if (error && error.code !== '23505') throw error;
      const { count } = await supabase.from('reports').select('id', { count: 'exact', head: true }).eq('pet_id', petId).eq('status', 'open');
      if ((count ?? 0) >= 3) await supabase.from('pets').update({ status: 'paused', reports_count: count }).eq('id', petId).eq('status', 'approved');
      return reply({ reported: true });
    }

    if (action === 'delete') {
      const petId = requireUuid(body.petId);
      const { data: pet } = await supabase.from('pets').select('id,storage_path').eq('id', petId).eq('owner_hash', ownerHash).single();
      if (!pet) return reply({ error: '삭제할 사진이 없어요.', code: 'PET_NOT_FOUND' }, 404);
      await supabase.from('pets').update({ status: 'deleted', deleted_at: new Date().toISOString() }).eq('id', pet.id);
      await supabase.storage.from('pet-photos').remove([pet.storage_path]);
      return reply({ deleted: true });
    }

    return reply({ error: '알 수 없는 요청이에요.', code: 'INVALID_ACTION' }, 404);
  } catch (error) {
    if (error instanceof ApiError) return reply({ error: error.message, code: error.code }, error.status);
    const requestId = crypto.randomUUID();
    console.error('pet-api unhandled error', { requestId, error });
    return reply({ error: '서버에서 요청을 완료하지 못했어요. 잠시 뒤 다시 시도해 주세요.', code: 'INTERNAL_ERROR', requestId }, 500);
  }
});
