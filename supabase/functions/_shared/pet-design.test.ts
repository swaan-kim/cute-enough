import { createHash, webcrypto } from 'node:crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { canonicalPetDesign, hashPetDesign } from './pet-design';

describe('portable document hash', () => {
  afterEach(() => vi.unstubAllGlobals());
  it('uses recursively sorted compact JSON and SHA-256 of normalized UTF-8 bytes', async () => {
    vi.stubGlobal('crypto', webcrypto);
    const document = { nodes: [{ attrs: { fill: '#FFFFFF', r: 5, cy: '12', cx: 6, 'data-note': '확정 소품', 'data-bool': true }, tag: 'circle' }], viewBox: [0, 0, 180, 156], motionVersion: 1, schemaVersion: 1 };
    const canonical = canonicalPetDesign(document);
    expect(canonical).toBe('{"motionVersion":1,"nodes":[{"attrs":{"cx":"6","cy":"12","data-bool":"true","data-note":"확정 소품","fill":"#FFFFFF","r":"5"},"tag":"circle"}],"schemaVersion":1,"viewBox":[0,0,180,156]}');
    expect(await hashPetDesign(document)).toBe(createHash('sha256').update(canonical, 'utf8').digest('hex'));
  });
});
