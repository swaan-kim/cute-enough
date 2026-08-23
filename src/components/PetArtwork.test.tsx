import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { PetArtwork } from './PetArtwork';
import type { PetSummary } from '../types';

const illustratedPet: PetSummary = {
  id: 'illustrated-dog',
  name: '그림이',
  illustrationUrl: '/pet-artwork/illustrated-dog.webp',
  traits: {
    schemaVersion: 1,
    earShape: 'floppy',
    headShape: 'round',
    baseColor: 'cream',
    secondaryColor: 'caramel',
    markingPattern: 'none',
    muzzle: 'short',
    confidence: 0.95,
  },
};

describe('PetArtwork expressions', () => {
  it('does not overlay generated expression parts on finished artwork', () => {
    const { container, getByRole } = render(<PetArtwork pet={illustratedPet} size={114} panting />);
    expect(getByRole('img', { name: '그림이 캐릭터' })).toBeInTheDocument();
    expect(container.querySelector('[data-brow-style]')).not.toBeInTheDocument();
    expect(container.querySelector('[data-tongue-shape]')).not.toBeInTheDocument();
  });
});
