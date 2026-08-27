import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !serviceRoleKey) {
  throw new Error('SUPABASE_URL과 SUPABASE_SERVICE_ROLE_KEY를 현재 터미널에만 설정해 주세요. VITE_ 변수로 만들면 안 됩니다.');
}

const supabase = createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false } });
const ownerHash = 'system:initial-pets';
const pets = [
  {
    key: 'gureumi',
    id: 'd5e1c8c1-4d66-4c6e-a0fe-2dc98c9bf001',
    name: '구르미',
    photos: [
      { key: '01', file: 'gureumi-01.jpg' },
      { key: '02', file: 'gureumi-02.jpg' },
      { key: '03', file: 'gureumi-03.jpg' },
    ],
    traits: { schemaVersion: 1, earShape: 'floppy', headShape: 'round', baseColor: 'white', secondaryColor: 'cream', markingPattern: 'none', muzzle: 'medium', confidence: 1 },
  },
  {
    key: 'haneul',
    id: 'd5e1c8c1-4d66-4c6e-a0fe-2dc98c9bf003',
    name: '하늘',
    photos: [
      { key: '01', file: 'haneul-01.jpg' },
      { key: '02', file: 'haneul-02.jpg' },
    ],
    traits: { schemaVersion: 1, earShape: 'upright', headShape: 'oval', baseColor: 'cream', secondaryColor: 'white', markingPattern: 'blaze', muzzle: 'short', confidence: 1 },
  },
];

const requestedKeyIndex = process.argv.indexOf('--pet');
const requestedKey = requestedKeyIndex >= 0 ? process.argv[requestedKeyIndex + 1] : undefined;
const selectedPets = requestedKey ? pets.filter((pet) => pet.key === requestedKey) : pets;
if (selectedPets.length === 0) {
  throw new Error(`알 수 없는 강아지 키예요: ${requestedKey}. gureumi, haneul 중에서 골라주세요.`);
}

let uploadedPhotoCount = 0;
for (const pet of selectedPets) {
  const photos = pet.photos.map((photo, sortOrder) => ({
    ...photo,
    sortOrder,
    storagePath: `initial/${pet.key}/${photo.key}.jpg`,
  }));

  for (const photo of photos) {
    const bytes = await readFile(resolve('public', 'sample-pets', photo.file));
    const { error: uploadError } = await supabase.storage.from('pet-photos').upload(photo.storagePath, bytes, {
      contentType: 'image/jpeg', cacheControl: '3600', upsert: true,
    });
    if (uploadError) throw uploadError;
    uploadedPhotoCount += 1;
  }

  const { data: existingPet, error: existingPetError } = await supabase.from('pets')
    .select('reviewed_at')
    .eq('id', pet.id)
    .maybeSingle();
  if (existingPetError) throw existingPetError;

  const { error: petError } = await supabase.from('pets').upsert({
    id: pet.id,
    owner_hash: ownerHash,
    name: pet.name,
    storage_path: photos[0].storagePath,
    status: 'approved',
    traits: pet.traits,
    moderation: { automatic: 'operator_seed', requiresHumanReview: false, source: 'owner_provided' },
    consent_version: 'owner-provided-2026-08-25',
    reviewed_at: existingPet?.reviewed_at ?? new Date().toISOString(),
  }, { onConflict: 'id' });
  if (petError) throw petError;

  const { error: photoRowsError } = await supabase.from('pet_photos').upsert(
    photos.map((photo) => ({
      pet_id: pet.id,
      storage_path: photo.storagePath,
      sort_order: photo.sortOrder,
      is_active: true,
    })),
    { onConflict: 'pet_id,sort_order' },
  );
  if (photoRowsError) throw photoRowsError;

  const activePaths = new Set(photos.map((photo) => photo.storagePath));
  const { data: existingPhotos, error: existingPhotosError } = await supabase.from('pet_photos')
    .select('id,storage_path')
    .eq('pet_id', pet.id);
  if (existingPhotosError) throw existingPhotosError;
  const stalePhotoIds = (existingPhotos ?? []).filter((photo) => !activePaths.has(photo.storage_path)).map((photo) => photo.id);
  if (stalePhotoIds.length > 0) {
    const { error: staleError } = await supabase.from('pet_photos').update({ is_active: false }).in('id', stalePhotoIds);
    if (staleError) throw staleError;
  }
}

// 이전 임시 이름은 동일한 실제 강아지를 중복 집계하므로 삭제하지 않고 안전하게 노출만 중지한다.
// --pet으로 한 마리씩 올릴 때도 임시 캐릭터가 집에 남지 않아야 한다.
const retiredIds = [
  'd5e1c8c1-4d66-4c6e-a0fe-2dc98c9bf002',
  'd5e1c8c1-4d66-4c6e-a0fe-2dc98c9bf004',
];
const { data: retired, error: retireError } = await supabase.from('pets')
  .update({ status: 'paused' })
  .in('id', retiredIds)
  .eq('owner_hash', ownerHash)
  .neq('status', 'deleted')
  .neq('status', 'paused')
  .select('id');
if (retireError) throw retireError;
if ((retired ?? []).length > 0) {
  const { error: auditError } = await supabase.from('admin_audit_logs').insert(retired.map((pet) => ({
    pet_id: pet.id,
    actor: 'seed:initial-pets',
    action: 'pause_duplicate_identity',
    detail: { reason: '실제 강아지 한 마리당 하나의 pet id로 통합' },
  })));
  if (auditError) throw auditError;
}

console.log(`초기 강아지 ${selectedPets.length}마리와 private 사진 ${uploadedPhotoCount}장을 등록했습니다.`);
