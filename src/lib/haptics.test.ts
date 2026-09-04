import { beforeEach, describe, expect, it, vi } from 'vitest';

const bridge = vi.hoisted(() => ({
  triggerHaptic: vi.fn<({ type }: { type: string }) => Promise<void>>(),
}));

vi.mock('@apps-in-toss/web-framework', () => ({
  Device: { triggerHaptic: bridge.triggerHaptic },
}));

import { playHaptic, type HapticCue } from './haptics';

describe('playHaptic', () => {
  beforeEach(() => {
    bridge.triggerHaptic.mockReset();
    bridge.triggerHaptic.mockResolvedValue(undefined);
  });

  it.each<[HapticCue, string]>([
    ['friendsArrived', 'tickWeak'],
    ['dragStart', 'tickWeak'],
    ['treatSuccess', 'softMedium'],
    ['pet', 'tickWeak'],
    ['photoReveal', 'success'],
    ['photoHeart', 'tickWeak'],
    ['uploadSuccess', 'success'],
  ])('maps %s to the intended Toss preset', async (cue, type) => {
    await playHaptic(cue);
    expect(bridge.triggerHaptic).toHaveBeenCalledWith({ type });
  });

  it('silently ignores a missing or disabled native haptic bridge', async () => {
    bridge.triggerHaptic.mockRejectedValueOnce(new Error('not supported'));
    await expect(playHaptic('dragStart')).resolves.toBeUndefined();
  });
});
