import { ApiError } from '../_shared/api-error.ts';
import { requireUuid } from '../_shared/validation.ts';

type QueryResult = { data: unknown; error: { message?: string; code?: string } | null };
interface ReadQuery extends PromiseLike<QueryResult> {
  select(columns: string): ReadQuery;
  eq(column: string, value: unknown): ReadQuery;
  order(column: string, options?: { ascending?: boolean }): ReadQuery;
  limit(count: number): ReadQuery;
  maybeSingle(): PromiseLike<QueryResult>;
}
export interface PhotoPrepareClient {
  from(table: string): ReadQuery;
  rpc(name: string, args: Record<string, unknown>): PromiseLike<QueryResult>;
  storage: { from(bucket: string): {
    createSignedUrl(path: string, expiresIn: number): PromiseLike<{
      data: { signedUrl: string } | null; error: { message?: string } | null;
    }>;
  } };
}
type Photo = { id: string; pet_id: string; storage_path: string; sort_order: number; caption?: string | null };
type Grant = { photo_id: string; unlocked_at: string };
type AuthorizedPhoto = { petId: string; photoId: string; storagePath: string; photoCaption?: string | null };
const unavailable = () => new ApiError('PHOTO_PREPARE_UNAVAILABLE', 404, '미리 준비할 수 있는 사진이 없어요.');

/** Only SELECTs and read-only authorization RPCs. Completion still reauthorizes
 * and records the actual visit; this candidate is never a collection receipt. */
export function createPhotoPrepareApi(client: PhotoPrepareClient) {
  async function read<T>(query: PromiseLike<QueryResult>): Promise<T> {
    const { data, error } = await query;
    if (error) throw new ApiError('PHOTO_PREPARE_UNAVAILABLE', 503, '사진을 미리 준비하지 못했어요.');
    return data as T;
  }

  return async (ownerHash: string, body: Record<string, unknown>, date: string) => {
    const petId = requireUuid(body.petId).toLowerCase();
    const requestId = requireUuid(body.requestId).toLowerCase();
    if (body.accessKind !== 'owner' && body.accessKind !== 'replay') {
      throw new ApiError('INVALID_PHOTO_PREPARE', 400, '사진 준비 방법을 다시 확인해 주세요.');
    }
    if (!ownerHash) throw unavailable();
    const pet = await read<{ id: string; owner_hash: string; status: string } | null>(client.from('pets')
      .select('id,owner_hash,status').eq('id', petId).maybeSingle());
    if (!pet || pet.id !== petId) throw unavailable();
    if (body.accessKind === 'owner') {
      if (pet.owner_hash !== ownerHash || !['pending', 'approved'].includes(pet.status)) throw unavailable();
    } else if (pet.owner_hash === ownerHash || pet.status !== 'approved') throw unavailable();

    // This existing RPC only joins active pet_photos to private Storage objects.
    // In particular, do not call prepare_pet_photo_replay/get_pet_album_state:
    // those can initialize legacy gifts for an unadopted account.
    const [existing, photoRows] = await Promise.all([
      read<Array<{ pet_id: string; storage_path: string; sort_order: number }>>(client.rpc('get_existing_pet_photos', { p_pet_ids: [petId] })),
      read<Photo[]>(client.from('pet_photos').select('id,pet_id,storage_path,sort_order,caption')
        .eq('pet_id', petId).eq('is_active', true).order('sort_order').order('id')),
    ]);
    const existingPaths = new Set((existing ?? []).filter((row) => row.pet_id === petId).map((row) => row.storage_path));
    const photos = (photoRows ?? []).filter((row) => row.pet_id === petId && existingPaths.has(row.storage_path));
    if (!photos.length) throw unavailable();
    let chosen: Photo | undefined;

    if (body.accessKind === 'owner') {
      // Match the established owner-photo date selection exactly.
      const paths = (existing ?? []).filter((row) => row.pet_id === petId)
        .sort((a, b) => a.sort_order - b.sort_order || a.storage_path.localeCompare(b.storage_path));
      const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`photo-v1:${petId}:${ownerHash}:${date}`));
      const path = paths[new DataView(digest).getUint32(0, false) % paths.length]?.storage_path;
      chosen = photos.find((photo) => photo.storage_path === path);
    } else {
      const [grants, previousRequest, collectedToday] = await Promise.all([
        read<Grant[]>(client.from('user_photo_unlocks').select('photo_id,unlocked_at')
          .eq('owner_hash', ownerHash).eq('pet_id', petId).order('unlocked_at', { ascending: false }).order('photo_id', { ascending: false })),
        read<{ pet_id: string; photo_id: string } | null>(client.from('pet_photo_replay_requests').select('pet_id,photo_id')
          .eq('owner_hash', ownerHash).eq('request_id', requestId).maybeSingle()),
        read<{ photo_id: string } | null>(client.from('pet_daily_photo_collections').select('photo_id')
          .eq('owner_hash', ownerHash).eq('pet_id', petId).eq('collection_date', date).maybeSingle()),
      ]);
      const owned = photos.filter((photo) => (grants ?? []).some((grant) => grant.photo_id === photo.id));
      if (!owned.length) throw unavailable();
      if (previousRequest) {
        if (previousRequest.pet_id !== petId) throw unavailable();
        chosen = owned.find((photo) => photo.id === previousRequest.photo_id);
      } else if (collectedToday) {
        chosen = owned.find((photo) => photo.id === collectedToday.photo_id);
        // A withdrawn representative can only fall back to an existing grant.
        chosen ??= (grants ?? []).map((grant) => owned.find((photo) => photo.id === grant.photo_id)).find(Boolean);
      } else if (owned.length < photos.length) {
        chosen = (grants ?? []).map((grant) => owned.find((photo) => photo.id === grant.photo_id)).find(Boolean);
      } else {
        const previous = await read<{ photo_id: string } | null>(client.from('pet_daily_photo_replays').select('photo_id')
          .eq('owner_hash', ownerHash).eq('pet_id', petId).order('recorded_at', { ascending: false })
          .order('replay_date', { ascending: false }).limit(1).maybeSingle());
        chosen = owned[(owned.findIndex((photo) => photo.id === previous?.photo_id) + 1) % owned.length];
      }
      if (!chosen) throw unavailable();
      // Recheck the exact persisted grant and current approved/active/Storage
      // status immediately before signing. Never trust a body photoId or path.
      const authorized = await read<AuthorizedPhoto | null>(client.rpc('authorize_pet_album_photo', {
        p_owner_hash: ownerHash, p_photo_id: chosen.id,
      }));
      if (!authorized || authorized.petId !== petId || authorized.photoId !== chosen.id
        || authorized.storagePath !== chosen.storage_path) throw unavailable();
      chosen = { ...chosen, caption: authorized.photoCaption };
    }
    if (!chosen) throw unavailable();
    // Recheck owner visibility as well, including moderation while reading photos.
    if (body.accessKind === 'owner') {
      const current = await read<{ id: string; owner_hash: string; status: string } | null>(client.from('pets')
        .select('id,owner_hash,status').eq('id', petId).maybeSingle());
      if (!current || current.id !== petId || current.owner_hash !== ownerHash
        || !['pending', 'approved'].includes(current.status)) throw unavailable();
      const currentPhoto = await read<Photo | null>(client.from('pet_photos')
        .select('id,pet_id,storage_path,sort_order,caption').eq('id', chosen.id).eq('pet_id', petId)
        .eq('is_active', true).maybeSingle());
      if (!currentPhoto || currentPhoto.storage_path !== chosen.storage_path) throw unavailable();
      chosen = currentPhoto;
    }
    const { data, error } = await client.storage.from('pet-photos').createSignedUrl(chosen.storage_path, 600);
    if (error || !data?.signedUrl) throw new ApiError('PHOTO_SIGNING_FAILED', 503, '사진을 미리 준비하지 못했어요.');
    return { petId, photoId: chosen.id, photoUrl: data.signedUrl,
      signedUrlExpiresAt: new Date(Date.now() + 600_000).toISOString(),
      ...(chosen.caption ? { photoCaption: chosen.caption } : {}) };
  };
}
