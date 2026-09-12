import { describe, expect, it, vi } from 'vitest';
import { withReviewedArtwork } from './reviewed-artwork';
const id = '11111111-1111-4111-8111-111111111111';
const metadata = { sha256: 'a'.repeat(64), width: 1080, height: 936, designVersion: 2 };
const row = { id, design_version: 2, reviewed_artwork: { path: `${id}/image.png`, ...metadata } };
const delivered = { illustrationUrl: 'https://example.invalid/saved.png', illustrationStatus: 'ready',
  illustrationExpiresAt: expect.any(String), reviewedArtwork: metadata, designVersion: 2 };
function fixture(rows: unknown[], signingError = false) {
  const query = { in: vi.fn().mockReturnThis(), eq: vi.fn().mockResolvedValue({ data: rows }) };
  const sign = vi.fn().mockResolvedValue(signingError ? { error: 'offline' } : { data: [{ path: `${id}/image.png`, signedUrl: 'https://example.invalid/saved.png' }] });
  const client = { from: vi.fn(() => ({ select: () => query })), storage: { from: vi.fn(() => ({ createSignedUrls: sign })) } };
  return { client: client as unknown as Parameters<typeof withReviewedArtwork>[0], query, sign };
}
describe('saved artwork delivery', () => {
  it('sends the same saved URL in house, shared pet and album summaries without altering the design', async () => {
    const { client, query } = fixture([row]);
    const pet = { id, traits: { custom: 'unchanged' } };
    const result = await withReviewedArtwork(client, { pet, pets: [pet] }) as { pet: typeof pet & { illustrationUrl: string }; pets: unknown[] };
    expect(result.pet).toEqual({ ...pet, ...delivered });
    expect(result.pets).toEqual([result.pet]);
    expect(query.in).toHaveBeenCalledWith('id', [id]);
    expect(query.eq).toHaveBeenCalledWith('status', 'approved');
  });
  it('preserves legacy pets and avoids artwork queries for non-pet responses', async () => {
    const { client, sign } = fixture([]);
    const payload = { pets: [{ id, name: '친구' }] };
    expect(await withReviewedArtwork(client, payload)).toEqual(payload);
    expect(sign).not.toHaveBeenCalled();
    expect(await withReviewedArtwork(client, { remaining: 2 })).toEqual({ remaining: 2 });
  });
  it('covers the app-preferred dailyPets and ownerBonusPet fields even without legacy pets', async () => {
    const { client, query } = fixture([row]);
    const pet = { id, name: '저장본' };
    const result = await withReviewedArtwork(client, { dailyPets: [pet], ownerBonusPet: pet }) as Record<string, unknown>;
    const saved = { ...pet, ...delivered };
    expect(result.dailyPets).toEqual([saved]);
    expect(result.ownerBonusPet).toEqual(saved);
    expect(query.in).toHaveBeenCalledWith('id', [id]);
  });
  it('does not silently replace a saved image with a generated dog when signing fails', async () => {
    const { client } = fixture([row], true);
    await expect(withReviewedArtwork(client, { pet: { id }, allowance: { remaining: 1 } })).resolves.toMatchObject({
      pet: { id, illustrationStatus: 'unavailable', reviewedArtwork: metadata }, allowance: { remaining: 1 },
    });
  });

  it('isolates one bad signature without leaking paths or breaking the healthy pet', async () => {
    const otherId = '22222222-2222-4222-8222-222222222222';
    const { client, sign } = fixture([row, { ...row, id: otherId, reviewed_artwork: { ...metadata, path: `${otherId}/other.png` } }]);
    sign.mockResolvedValue({ data: [
      { path: `${otherId}/other.png`, signedUrl: '', error: 'not found' },
      { path: `${id}/image.png`, signedUrl: 'https://example.invalid/saved.png' },
    ] });
    const result = await withReviewedArtwork(client, { dailyPets: [{ id }, { id: otherId }] });
    expect(result).toMatchObject({ dailyPets: [{ id, ...delivered }, { id: otherId, illustrationStatus: 'unavailable' }] });
    expect(JSON.stringify(result)).not.toContain('/other.png');
    expect(sign).toHaveBeenCalledWith([`${id}/image.png`, `${otherId}/other.png`], 21600);
  });

  it('keeps unknown artwork in retry state on metadata errors while pending drafts stay unchanged', async () => {
    const { client, query } = fixture([]);
    query.eq.mockRejectedValue(new Error('offline'));
    const pending = { id: '22222222-2222-4222-8222-222222222222', approvalStatus: 'pending' };
    expect(await withReviewedArtwork(client, { pets: [{ id }, pending] })).toEqual({
      pets: [{ id, illustrationStatus: 'unavailable', illustrationUrl: undefined, illustrationExpiresAt: undefined }, pending],
    });
  });

  it('refuses a previous design image after a mismatching legacy approval', async () => {
    const { client, sign } = fixture([{ ...row, design_version: 3 }]);
    expect(await withReviewedArtwork(client, { pet: { id } })).toMatchObject({ pet: { illustrationStatus: 'unavailable' } });
    expect(sign).not.toHaveBeenCalled();
  });
});
