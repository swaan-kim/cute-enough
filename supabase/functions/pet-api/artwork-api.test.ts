import { describe, expect, it, vi } from 'vitest';
import { refreshArtwork } from './artwork-api';
import { readFileSync } from 'node:fs';

describe('artwork-only refresh authorization', () => {
  it.each(['pending', 'paused', 'rejected', 'deleted'])('cannot renew a %s pet image', async () => {
    const query = { eq: vi.fn().mockReturnThis(), maybeSingle: vi.fn().mockResolvedValue({ data: null }) };
    const client = { from: () => ({ select: () => query }), rpc: vi.fn(), storage: { from: vi.fn() } };
    await expect(refreshArtwork(client as unknown as Parameters<typeof refreshArtwork>[0], 'pet-id')).rejects.toMatchObject({ code: 'PET_NOT_AVAILABLE', status: 404 });
    expect(query.eq).toHaveBeenCalledWith('status', 'approved');
    expect(client.rpc).not.toHaveBeenCalled();
    expect(client.storage.from).not.toHaveBeenCalled();
  });
  it('stays behind the existing mTLS identity and rate-limit boundary', () => {
    const source = readFileSync('supabase/functions/pet-api/index.ts', 'utf8');
    const action = source.indexOf("if (action === 'artwork')");
    expect(action).toBeGreaterThan(source.indexOf('await verifyAnonymousKey(anonymousKey)'));
    expect(action).toBeGreaterThan(source.indexOf('await enforceRateLimit(ownerHash, action)'));
    const helper = readFileSync('supabase/functions/pet-api/artwork-api.ts', 'utf8');
    expect(helper).not.toContain('.rpc(');
    expect(helper).not.toContain('pet-photos');
  });
});
