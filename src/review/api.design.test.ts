import { describe, expect, it, vi } from 'vitest';
import { createReviewApi } from './api';
import { createReviewEditor } from './reviewDesign';
import { hashPetDesign } from '../../supabase/functions/_shared/pet-design';
import type { ReviewCatalogItem, SaveDesignDraftRequest } from './types';

const item: ReviewCatalogItem = {
  petId: '11111111-1111-4111-8111-111111111111', name: '쿠키', status: 'approved', designVersion: 2,
  traits: { schemaVersion: 1, earShape: 'upright', headShape: 'round', muzzle: 'short', baseColor: 'white', secondaryColor: 'white', markingPattern: 'none', confidence: 1 },
  publishedStyle: { schemaVersion: 1, coatMode: 'solid', furStyle: 'fluffy' }, publishedAccessory: null,
};
function request(): SaveDesignDraftRequest {
  const editor = createReviewEditor(item);
  return { petId: item.petId, expectedDraftRevision: 0, expectedDesignVersion: 2, document: editor.document,
    editorState: { finalTraits: item.traits, finalStyle: item.publishedStyle, publishedAccessory: null, editor } };
}
describe('review SVG roundtrip', () => {
  it('returns the verified DB document without publishing a dog', async () => {
    const input = request();
    const saved = { ...input, draftRevision: 1, sha256: await hashPetDesign(input.document) };
    const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify(saved)));
    const result = await createReviewApi(fetcher).saveDraft(input);
    expect(result.document).toEqual(input.document);
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(fetcher.mock.calls[0][0]).toBe('/api/review-design-draft');
  });
  it('rejects a changed DB document even when its own hash is valid', async () => {
    const input = request();
    const document = structuredClone(input.document);
    document.nodes.push({ tag: 'circle', attrs: { cx: '1', cy: '1', r: '1', fill: '#fff' } });
    const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify({ ...input, document, draftRevision: 1, sha256: await hashPetDesign(document) })));
    await expect(createReviewApi(fetcher).saveDraft(input)).rejects.toThrow('저장 전후 SVG가 일치하지 않아요');
  });
  it('keeps stale-save conflicts visible and never silently retries approval', async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify({ error: 'REVIEW_DRAFT_CHANGED' }), { status: 409 }));
    await expect(createReviewApi(fetcher).saveDraft(request())).rejects.toThrow('REVIEW_DRAFT_CHANGED');
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
});
