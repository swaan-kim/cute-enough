import { act, fireEvent, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { PetArtwork } from './PetArtwork';
import { PetArtworkButton } from './PetArtworkButton';
import { SAMPLE_PETS } from '../data/samplePets';
import type { PetSummary } from '../types';
const mocks = vi.hoisted(() => ({ fetchPetDesign: vi.fn() }));
vi.mock('../lib/api', () => mocks);
afterEach(() => mocks.fetchPetDesign.mockReset());
const pet: PetSummary = { ...SAMPLE_PETS[0], id: 'published-dog', name: '그림이', approvalStatus: 'approved' };

describe('published SVG artwork', () => {
  it('renders stored geometry and animated parts without image overlays or a pet-ID branch', () => {
    const { container } = render(<PetArtwork pet={{ ...pet, id: 'dc852ee9-b0dd-4090-a4f0-c5014bf70d2b' }} size={114} panting />);
    expect(container.querySelector('.pet-artwork-design')).toHaveAttribute('data-design-sha256', pet.publishedDesign!.sha256);
    expect(container.querySelector('.dog-avatar')).toHaveClass('is-panting');
    expect(container.querySelector('[data-pet-signature="peach-hairpin"]')).toBeInTheDocument();
    expect(container.querySelector('[data-pet-signature="chocolate-cookie"]')).toBeNull();
    expect(container.querySelector('.dog-tail')).toBeInTheDocument();
    expect(container.querySelector('.dog-tongue')).toBeInTheDocument();
    expect(container.querySelector('img,.panting-tongue-point')).toBeNull();
  });

  it('ignores changed trait fields when a published document is present', () => {
    const { container, rerender } = render(<PetArtwork pet={pet} size={114} />);
    const head = container.querySelector('[data-head-outline]')?.getAttribute('d');
    const fill = container.querySelector('[data-head-fill]')?.getAttribute('fill');
    rerender(<PetArtwork pet={{ ...pet, traits: { ...pet.traits, headShape: 'long', baseColor: 'black' } }} size={114} />);
    expect(container.querySelector('[data-head-outline]')).toHaveAttribute('d', head);
    expect(container.querySelector('[data-head-fill]')).toHaveAttribute('fill', fill);
  });

  it('compiles only a submission preview with existing choices and the same SVG renderer', () => {
    const draft = { ...pet, publishedDesign: undefined, designStatus: undefined, approvalStatus: 'pending' as const };
    const { container } = render(<PetArtwork pet={draft} size={114} />);
    expect(container.querySelector('.pet-design-svg')).toBeInTheDocument();
    expect(container.querySelector('[data-pet-signature]')).toBeNull();
    expect(container.querySelector('[data-ear-variant]')).toBeNull();
  });

  it('shows retry for missing or invalid published geometry and never draws an approximation', async () => {
    const missing = { ...pet, id: 'missing-design', publishedDesign: undefined, designStatus: 'missing' as const };
    mocks.fetchPetDesign.mockResolvedValueOnce({ ...pet, id: missing.id });
    const { container, getByRole, queryByRole } = render(<PetArtwork pet={missing} size={114} />);
    expect(getByRole('status')).toHaveTextContent('다시 불러오기');
    expect(container.querySelector('svg')).toBeNull();
    await act(async () => fireEvent.click(getByRole('button', { name: '그림이 캐릭터 다시 불러오기' })));
    expect(container.querySelector('.pet-design-svg')).toBeInTheDocument();
    expect(queryByRole('status')).not.toBeInTheDocument();
  });

  it('uses the parent card to retry without nested buttons or starting a meeting', async () => {
    const onSelect = vi.fn();
    const missing = { ...pet, id: 'missing-card', publishedDesign: undefined, designStatus: 'unavailable' as const };
    mocks.fetchPetDesign.mockResolvedValueOnce({ ...pet, id: missing.id });
    const { container, getByRole } = render(<PetArtworkButton pet={missing} onClick={onSelect} aria-label="친구 만나기"><PetArtwork pet={missing} size={114} retryControl={false} /></PetArtworkButton>);
    expect(container.querySelector('button button')).toBeNull();
    await act(async () => fireEvent.click(getByRole('button', { name: '그림이 캐릭터 다시 불러오기' })));
    expect(onSelect).not.toHaveBeenCalled();
    fireEvent.click(getByRole('button', { name: '친구 만나기' }));
    expect(onSelect).toHaveBeenCalledOnce();
  });
});
