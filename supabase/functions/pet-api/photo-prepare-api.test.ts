import { webcrypto } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { createPhotoPrepareApi, type PhotoPrepareClient } from './photo-prepare-api';

const petId = '10000000-0000-4000-8000-000000000001';
const photoA = '20000000-0000-4000-8000-000000000001';
const photoB = '20000000-0000-4000-8000-000000000002';
const requestId = '30000000-0000-4000-8000-000000000001';
const owner = 'verified-owner', viewer = 'verified-viewer', date = '2026-09-12';
const request = { petId, requestId, accessKind: 'replay' };
type Row = Record<string, unknown>;

function fixture() {
  const rows: Record<string, Row[]> = {
    pets: [{ id: petId, owner_hash: owner, status: 'approved' }],
    pet_photos: [photoA, photoB].map((id, index) => ({ id, pet_id: petId, storage_path: `private/${index}.jpg`,
      sort_order: index, is_active: true, caption: index === 0 ? '첫 사진' : '두 번째' })),
    user_photo_unlocks: [{ owner_hash: viewer, pet_id: petId, photo_id: photoA, unlocked_at: '2026-09-10' }],
    pet_photo_replay_requests: [], pet_daily_photo_collections: [], pet_daily_photo_replays: [],
  };
  const missing = new Set<string>();
  const queries: Array<{ table: string; filters: Array<[string, unknown]> }> = [];
  let failedTable = '';
  function from(table: string) {
    if (!(table in rows)) throw new Error(`Unexpected table ${table}`);
    const filters: Array<[string, unknown]> = [], orders: Array<[string, boolean]> = [];
    let limit = Infinity;
    queries.push({ table, filters });
    const result = (single: boolean) => {
      if (table === failedTable) return { data: null, error: { message: 'offline' } };
      const matching = rows[table].filter((row) => filters.every(([key, value]) => row[key] === value));
      matching.sort((a, b) => {
        for (const [key, ascending] of orders) {
          const comparison = String(a[key]).localeCompare(String(b[key]));
          if (comparison) return ascending ? comparison : -comparison;
        }
        return 0;
      });
      return { data: single ? matching[0] ?? null : matching.slice(0, limit), error: null };
    };
    const query = {
      select: (_columns: string) => query,
      eq: (key: string, value: unknown) => { filters.push([key, value]); return query; },
      order: (key: string, options?: { ascending?: boolean }) => { orders.push([key, options?.ascending !== false]); return query; },
      limit: (count: number) => { limit = count; return query; },
      maybeSingle: () => Promise.resolve(result(true)),
      then: (resolve: (value: unknown) => unknown, reject: (error: unknown) => unknown) => Promise.resolve(result(false)).then(resolve, reject),
    };
    return query;
  }
  const rpc = vi.fn(async (name: string, args: Record<string, unknown>) => {
    if (name === 'get_existing_pet_photos') return { data: rows.pet_photos.filter((photo) => photo.is_active
      && (args.p_pet_ids as string[]).includes(photo.pet_id as string) && !missing.has(photo.storage_path as string)), error: null };
    if (name === 'authorize_pet_album_photo') {
      const photo = rows.pet_photos.find((row) => row.id === args.p_photo_id && row.is_active && !missing.has(row.storage_path as string));
      const pet = rows.pets.find((row) => row.id === photo?.pet_id && row.status === 'approved' && row.owner_hash !== args.p_owner_hash);
      const grant = rows.user_photo_unlocks.find((row) => row.owner_hash === args.p_owner_hash && row.photo_id === photo?.id);
      return { data: photo && pet && grant ? { petId: pet.id, photoId: photo.id, storagePath: photo.storage_path, photoCaption: photo.caption } : null, error: null };
    }
    throw new Error(`Mutation or unexpected RPC ${name}`);
  });
  const sign = vi.fn(async (_path: string, _seconds: number) => ({ data: { signedUrl: 'https://photo.test/signed' }, error: null as { message: string } | null }));
  const client = { from, rpc, storage: { from: (bucket: string) => { expect(bucket).toBe('pet-photos'); return { createSignedUrl: sign }; } } } as unknown as PhotoPrepareClient;
  return { rows, missing, queries, rpc, sign, prepare: createPhotoPrepareApi(client), fail: (table: string) => { failedTable = table; } };
}

describe('read-only photo preparation behavior', () => {
  it.each(['pending', 'approved'])('prepares an owner %s photo without allowance, adoption, view or grant changes', async (status) => {
    vi.stubGlobal('crypto', webcrypto);
    try {
      const h = fixture(); h.rows.pets[0].status = status;
      const before = structuredClone(h.rows);
      const result = await h.prepare(owner, { ...request, accessKind: 'owner', userHash: 'forged', photoId: 'forged' }, date);
      expect(result).toMatchObject({ petId, photoUrl: 'https://photo.test/signed' });
      expect([photoA, photoB]).toContain(result.photoId);
      expect(new Date(result.signedUrlExpiresAt).getTime() - Date.now()).toBeGreaterThan(599_000);
      expect(h.sign).toHaveBeenCalledWith(expect.stringMatching(/^private\/[01]\.jpg$/), 600);
      expect(h.rows).toEqual(before);
      expect(h.rpc.mock.calls.map(([name]) => name)).toEqual(['get_existing_pet_photos']);
    } finally { vi.unstubAllGlobals(); }
  });

  it.each(['owner', 'replay'])('denies someone else’s pending photo through %s access', async (accessKind) => {
    const h = fixture(); h.rows.pets[0].status = 'pending';
    await expect(h.prepare(viewer, { ...request, accessKind, ownerHash: owner, isMine: true }, date)).rejects.toMatchObject({ code: 'PHOTO_PREPARE_UNAVAILABLE' });
    expect(h.sign).not.toHaveBeenCalled(); expect(h.rpc).not.toHaveBeenCalled();
  });

  it.each(['paused', 'rejected', 'deleted'])('denies %s photos even with an existing grant', async (status) => {
    const h = fixture(); h.rows.pets[0].status = status;
    await expect(h.prepare(viewer, request, date)).rejects.toMatchObject({ code: 'PHOTO_PREPARE_UNAVAILABLE' });
    expect(h.sign).not.toHaveBeenCalled();
  });

  it.each([{ requestId: 'bad' }, { petId: 'bad' }, { accessKind: 'collect' }, { accessKind: 'REWARDED' }, { accessKind: undefined }])('rejects invalid preparation input before reads: %j', async (override) => {
    const h = fixture();
    await expect(h.prepare(viewer, { ...request, ...override }, date)).rejects.toBeDefined();
    expect(h.queries).toHaveLength(0); expect(h.sign).not.toHaveBeenCalled();
  });

  it('denies an unseen photo even if the caller supplies a photo ID, completed ad or fake ownership', async () => {
    const h = fixture(); h.rows.user_photo_unlocks = [];
    await expect(h.prepare(viewer, { ...request, photoId: photoB, adSessionId: requestId, ownerHash: owner }, date)).rejects.toMatchObject({ code: 'PHOTO_PREPARE_UNAVAILABLE' });
    expect(h.sign).not.toHaveBeenCalled();
  });

  it('prepares only the latest existing grant and reauthorizes its exact identity', async () => {
    const h = fixture(), before = structuredClone(h.rows);
    const result = await h.prepare(viewer, { ...request, photoId: photoB, storagePath: 'forged' }, date);
    expect(result).toMatchObject({ photoId: photoA, photoCaption: '첫 사진' });
    expect(result).not.toHaveProperty('storagePath');
    expect(h.rpc).toHaveBeenLastCalledWith('authorize_pet_album_photo', { p_owner_hash: viewer, p_photo_id: photoA });
    expect(h.rows).toEqual(before);
    expect(h.queries.filter((query) => query.table !== 'pets' && query.table !== 'pet_photos')
      .every((query) => query.filters.some(([key, value]) => key === 'owner_hash' && value === viewer))).toBe(true);
  });

  it('uses today’s already-collected image instead of advancing the replay rotation', async () => {
    const h = fixture();
    h.rows.user_photo_unlocks.push({ owner_hash: viewer, pet_id: petId, photo_id: photoB, unlocked_at: '2026-09-11' });
    h.rows.pet_daily_photo_collections.push({ owner_hash: viewer, pet_id: petId, photo_id: photoA, collection_date: date });
    const before = structuredClone(h.rows);
    expect((await h.prepare(viewer, request, date)).photoId).toBe(photoA);
    expect(h.rows).toEqual(before);
  });

  it('prepares the next existing image for a completed collection without recording the rotation', async () => {
    const h = fixture();
    h.rows.user_photo_unlocks.push({ owner_hash: viewer, pet_id: petId, photo_id: photoB, unlocked_at: '2026-09-11' });
    h.rows.pet_daily_photo_replays.push({ owner_hash: viewer, pet_id: petId, photo_id: photoA, recorded_at: date, replay_date: date });
    const before = structuredClone(h.rows);
    expect((await h.prepare(viewer, request, date)).photoId).toBe(photoB);
    expect((await h.prepare(viewer, request, date)).photoId).toBe(photoB);
    expect(h.rows).toEqual(before);
  });

  it('pins an existing replay request and rejects a crossed-dog request', async () => {
    const h = fixture();
    h.rows.pet_photo_replay_requests.push({ owner_hash: viewer, request_id: requestId, pet_id: petId, photo_id: photoA });
    expect((await h.prepare(viewer, request, date)).photoId).toBe(photoA);
    h.rows.pet_photo_replay_requests[0].pet_id = requestId;
    await expect(h.prepare(viewer, request, date)).rejects.toMatchObject({ code: 'PHOTO_PREPARE_UNAVAILABLE' });
    expect(h.sign).toHaveBeenCalledTimes(1);
  });

  it.each(['inactive', 'missing', 'wrong-owner'])('never substitutes an unseen image for an unavailable grant: %s', async (reason) => {
    const h = fixture();
    if (reason === 'inactive') h.rows.pet_photos[0].is_active = false;
    if (reason === 'missing') h.missing.add('private/0.jpg');
    if (reason === 'wrong-owner') h.rows.user_photo_unlocks[0].owner_hash = owner;
    await expect(h.prepare(viewer, request, date)).rejects.toMatchObject({ code: 'PHOTO_PREPARE_UNAVAILABLE' });
    expect(h.sign).not.toHaveBeenCalled();
  });

  it.each(['petId', 'photoId', 'storagePath'])('never signs if final grant authorization changes %s', async (field) => {
    const h = fixture(), originalRpc = h.rpc.getMockImplementation()!;
    h.rpc.mockImplementation(async (name, args) => {
      const result = await originalRpc(name, args);
      return name === 'authorize_pet_album_photo'
        ? { ...result, data: { ...result.data, [field]: 'different-value' } } : result;
    });
    await expect(h.prepare(viewer, request, date)).rejects.toMatchObject({ code: 'PHOTO_PREPARE_UNAVAILABLE' });
    expect(h.rpc).toHaveBeenLastCalledWith('authorize_pet_album_photo', { p_owner_hash: viewer, p_photo_id: photoA });
    expect(h.sign).not.toHaveBeenCalled();
  });

  it('does not sign a grant revoked after candidate selection', async () => {
    const h = fixture(), originalRpc = h.rpc.getMockImplementation()!;
    h.rpc.mockImplementation(async (name, args) => {
      if (name === 'authorize_pet_album_photo') h.rows.user_photo_unlocks = [];
      return originalRpc(name, args);
    });
    await expect(h.prepare(viewer, request, date)).rejects.toMatchObject({ code: 'PHOTO_PREPARE_UNAVAILABLE' });
    expect(h.rpc).toHaveBeenLastCalledWith('authorize_pet_album_photo', { p_owner_hash: viewer, p_photo_id: photoA });
    expect(h.sign).not.toHaveBeenCalled();
  });

  it.each(['paused', 'new-owner', 'withdrawn-photo'])('rechecks owner access after reading candidates: %s', async (change) => {
    vi.stubGlobal('crypto', webcrypto);
    try {
      const h = fixture(), originalRpc = h.rpc.getMockImplementation()!;
      h.rpc.mockImplementation(async (name, args) => {
        const result = await originalRpc(name, args);
        if (change === 'paused') h.rows.pets[0].status = 'paused';
        if (change === 'new-owner') h.rows.pets[0].owner_hash = viewer;
        if (change === 'withdrawn-photo') for (const photo of h.rows.pet_photos) photo.is_active = false;
        return result;
      });
      await expect(h.prepare(owner, { ...request, accessKind: 'owner' }, date))
        .rejects.toMatchObject({ code: 'PHOTO_PREPARE_UNAVAILABLE' });
      expect(h.sign).not.toHaveBeenCalled();
    } finally { vi.unstubAllGlobals(); }
  });

  it('fails closed on query failure, withdrawn authorization, and failed signing', async () => {
    const failed = fixture(); failed.fail('user_photo_unlocks');
    await expect(failed.prepare(viewer, request, date)).rejects.toMatchObject({ code: 'PHOTO_PREPARE_UNAVAILABLE', status: 503 });
    expect(failed.sign).not.toHaveBeenCalled();
    const changed = fixture(); changed.rpc.mockImplementation(async () => ({ data: null, error: null }));
    await expect(changed.prepare(viewer, request, date)).rejects.toMatchObject({ code: 'PHOTO_PREPARE_UNAVAILABLE' });
    expect(changed.sign).not.toHaveBeenCalled();
    const signing = fixture(), before = structuredClone(signing.rows);
    signing.sign.mockResolvedValue({ data: { signedUrl: '' }, error: { message: 'offline' } });
    await expect(signing.prepare(viewer, request, date)).rejects.toMatchObject({ code: 'PHOTO_SIGNING_FAILED' });
    expect(signing.rows).toEqual(before);
  });
});
