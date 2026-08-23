import { createClient } from 'npm:@supabase/supabase-js@2';
import { corsHeaders, json } from '../_shared/cors.ts';
import { decodeDataUri, hashUser, kstDate } from '../_shared/security.ts';
import { verifyAnalysisToken } from '../_shared/analysis-token.ts';

const supabase = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  { auth: { persistSession: false } },
);

function shuffled<T>(items: T[]) {
  return [...items].sort(() => Math.random() - 0.5);
}

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  try {
    const body = await request.json();
    if (!body.userHash || typeof body.userHash !== 'string') return json({ error: '사용자 식별값이 필요해요.' }, 400);
    const ownerHash = await hashUser(body.userHash);

    if (body.action === 'house') {
      const { data, error } = await supabase.from('pets').select('id,name,traits,owner_hash,owner_pinned_pending').eq('status', 'approved').limit(100);
      if (error) throw error;
      const owned = data.find((pet) => pet.owner_hash === ownerHash && pet.owner_pinned_pending);
      const pool = shuffled(data.filter((pet) => pet.id !== owned?.id)).slice(0, owned ? 4 : 5);
      const selected = shuffled(owned ? [owned, ...pool] : pool).map(({ owner_hash: _, owner_pinned_pending, ...pet }) => ({ ...pet, ownerPinned: owner_pinned_pending }));
      if (owned) await supabase.from('pets').update({ owner_pinned_pending: false }).eq('id', owned.id);
      return json({ pets: selected });
    }

    if (body.action === 'reveal') {
      if (!['FREE', 'REWARDED', 'UPLOAD'].includes(body.unlockMethod)) return json({ error: '올바르지 않은 해금 방식이에요.' }, 400);
      const date = kstDate();
      const { data: reveals, error: revealError } = await supabase.from('daily_reveals').select('unlock_method').eq('owner_hash', ownerHash).eq('reveal_date', date);
      if (revealError) throw revealError;
      const freeUsed = reveals.some((item) => item.unlock_method === 'FREE');
      const rewardedUsed = reveals.filter((item) => item.unlock_method === 'REWARDED').length;
      const uploadUsed = reveals.some((item) => item.unlock_method === 'UPLOAD');
      const kstStart = new Date(`${date}T00:00:00+09:00`);
      const kstEnd = new Date(kstStart.getTime() + 86_400_000);
      const { count: eligibleUploadCount, error: uploadCheckError } = await supabase
        .from('pets')
        .select('id', { count: 'exact', head: true })
        .eq('owner_hash', ownerHash)
        .gte('created_at', kstStart.toISOString())
        .lt('created_at', kstEnd.toISOString())
        .neq('status', 'deleted');
      if (uploadCheckError) throw uploadCheckError;
      if (body.unlockMethod === 'FREE' && freeUsed) return json({ error: '오늘의 무료 사진을 이미 봤어요.' }, 409);
      if (body.unlockMethod === 'REWARDED' && rewardedUsed >= 2) return json({ error: '오늘 볼 수 있는 사진을 모두 만났어요.' }, 409);
      if (body.unlockMethod === 'REWARDED' && !body.adSessionId) return json({ error: '광고 완료 값이 필요해요.' }, 400);
      if (body.unlockMethod === 'UPLOAD') {
        if (uploadUsed) return json({ error: '사진 등록으로 받은 만남을 이미 사용했어요.' }, 409);
        if (!eligibleUploadCount) return json({ error: '오늘 등록한 강아지 사진이 필요해요.' }, 403);
      }

      const { data: pet, error: petError } = await supabase.from('pets').select('id,storage_path,status').eq('id', body.petId).single();
      if (petError || pet.status !== 'approved') return json({ error: '공개할 수 없는 사진이에요.' }, 404);
      const { error: insertError } = await supabase.from('daily_reveals').insert({
        owner_hash: ownerHash, reveal_date: date, pet_id: pet.id, unlock_method: body.unlockMethod,
        ad_session_id: body.unlockMethod === 'REWARDED' ? body.adSessionId : null,
      });
      if (insertError) return json({ error: '이미 사용했거나 만료된 해금이에요.' }, 409);
      const { data: signed, error: signError } = await supabase.storage.from('pet-photos').createSignedUrl(pet.storage_path, 600);
      if (signError) throw signError;
      return json({
        photoUrl: signed.signedUrl,
        signedUrlExpiresAt: new Date(Date.now() + 600_000).toISOString(),
        allowance: {
          date,
          freeUsed: freeUsed || body.unlockMethod === 'FREE',
          rewardedUsed: rewardedUsed + (body.unlockMethod === 'REWARDED' ? 1 : 0),
          uploadCredit: Boolean(eligibleUploadCount),
          uploadUsed: uploadUsed || body.unlockMethod === 'UPLOAD',
        },
      });
    }

    if (body.action === 'submit') {
      const { bytes, mime } = decodeDataUri(body.dataUri);
      if (!body.analysisToken || !await verifyAnalysisToken(body.analysisToken, ownerHash, body.dataUri)) {
        return json({ error: '사진 안전 검사가 만료됐어요. 다시 분석해 주세요.' }, 422);
      }
      if (!body.traits || body.traits.schemaVersion !== 1) return json({ error: '캐릭터 특징을 다시 확인해 주세요.' }, 400);
      const normalizedName = typeof body.name === 'string' ? body.name.trim().normalize('NFC') : '';
      if (Array.from(normalizedName).length > 4) return json({ error: '강아지 이름은 네 글자까지 입력해 주세요.' }, 400);
      const ext = mime.split('/')[1].replace('jpeg', 'jpg');
      const id = crypto.randomUUID();
      const path = `${ownerHash}/${id}.${ext}`;
      const { error: uploadError } = await supabase.storage.from('pet-photos').upload(path, bytes, { contentType: mime, upsert: false });
      if (uploadError) throw uploadError;
      const { error: insertError } = await supabase.from('pets').insert({
        id, owner_hash: ownerHash, name: normalizedName || null,
        storage_path: path, traits: body.traits, status: 'pending', moderation: { automatic: 'passed' },
      });
      if (insertError) { await supabase.storage.from('pet-photos').remove([path]); throw insertError; }
      return json({ id, status: 'pending' }, 201);
    }

    if (body.action === 'report') {
      const reason = ['inappropriate', 'not_dog', 'privacy', 'copyright', 'other'].includes(body.reason) ? body.reason : 'other';
      const { error } = await supabase.from('reports').insert({ pet_id: body.petId, reporter_hash: ownerHash, reason });
      if (error && error.code !== '23505') throw error;
      const { count } = await supabase.from('reports').select('id', { count: 'exact', head: true }).eq('pet_id', body.petId).eq('status', 'open');
      if ((count ?? 0) >= 3) await supabase.from('pets').update({ status: 'paused', reports_count: count }).eq('id', body.petId).eq('status', 'approved');
      return json({ reported: true });
    }

    if (body.action === 'delete') {
      const { data: pet } = await supabase.from('pets').select('id,storage_path').eq('id', body.petId).eq('owner_hash', ownerHash).single();
      if (!pet) return json({ error: '삭제할 사진이 없어요.' }, 404);
      await supabase.from('pets').update({ status: 'deleted', deleted_at: new Date().toISOString() }).eq('id', pet.id);
      await supabase.storage.from('pet-photos').remove([pet.storage_path]);
      return json({ deleted: true });
    }

    return json({ error: '알 수 없는 요청이에요.' }, 404);
  } catch (error) {
    console.error(error);
    return json({ error: error instanceof Error ? error.message : '서버 오류가 발생했어요.' }, 500);
  }
});
