import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { catalogArtworkStatus, ReviewCatalogArtwork } from './ReviewCatalogArtwork';
import { buildPetDesign } from '../design/buildPetDesign';
import type { ReviewCatalogItem } from './types';

const traits = { schemaVersion: 1, earShape: 'upright', headShape: 'round', baseColor: 'white', secondaryColor: 'white', markingPattern: 'none', muzzle: 'short', confidence: 0.9 } as const;
const item: ReviewCatalogItem = {
  petId: 'dc852ee9-b0dd-4090-a4f0-c5014bf70d2b', name: '쿠키', status: 'approved', designVersion: 3,
  traits, publishedStyle: { schemaVersion: 1, coatMode: 'solid', furStyle: 'fluffy' }, publishedAccessory: null,
  publishedDesign: { id: 'design-3', sha256: 'a'.repeat(64), designVersion: 3, document: buildPetDesign({ traits }) }, designStatus: 'ready',
};

describe('review stored SVG verification', () => {
  it('shows the stored tree and only retries through the catalog after an unavailable response', () => {
    const onReload = vi.fn();
    const { container, rerender } = render(<ReviewCatalogArtwork item={item} loading={false} onReload={onReload} />);
    expect(container.querySelector('svg')).not.toBeNull();
    expect(container.querySelector('img')).toBeNull();
    expect(container.querySelector('[data-pet-signature="chocolate-cookie"]')).toBeNull();
    rerender(<ReviewCatalogArtwork item={{ ...item, designStatus: 'unavailable' }} loading={false} onReload={onReload} />);
    expect(container.querySelector('svg')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: '저장본 새로고침' }));
    expect(onReload).toHaveBeenCalledOnce();
    rerender(<ReviewCatalogArtwork item={item} loading={false} onReload={onReload} />);
    expect(container.querySelector('svg')).not.toBeNull();
  });

  it('refuses a stale document even if the server marks it ready', () => {
    const stale = { ...item, designVersion: 4 };
    expect(catalogArtworkStatus(stale)).toBe('version-mismatch');
    const { container } = render(<ReviewCatalogArtwork item={stale} loading={false} onReload={() => {}} />);
    expect(screen.getByRole('status')).toHaveTextContent('SVG 버전 확인 필요');
    expect(container.querySelector('svg, img')).toBeNull();
  });

  it('distinguishes an unconfirmed migration draft from an unavailable saved document', () => {
    const missing = { ...item, publishedDesign: null, designStatus: 'missing' as const };
    const { container, rerender } = render(<ReviewCatalogArtwork item={missing} loading={false} onReload={() => {}} />);
    expect(catalogArtworkStatus(missing)).toBe('missing');
    expect(container.querySelector('[data-pet-signature="chocolate-cookie"]')).not.toBeNull();
    rerender(<ReviewCatalogArtwork item={{ ...item, publishedDesign: null, designStatus: 'unavailable' }} loading={false} onReload={() => {}} />);
    expect(container.querySelector('svg')).toBeNull();
    expect(screen.getByRole('button', { name: '저장본 새로고침' })).toBeEnabled();
  });
});
