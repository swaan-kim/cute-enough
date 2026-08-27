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

  it('adds a signature only to allowlisted trait artwork', () => {
    const curated = render(<PetArtwork pet={{ ...illustratedPet, id: 'sample-gureumi', illustrationUrl: undefined }} size={114} />);
    expect(curated.container.querySelector('[data-pet-signature="sky-bandana"]')).toBeInTheDocument();
    expect(curated.container.querySelector('[data-ear-variant="high-floppy"]')).toBeInTheDocument();
    curated.unmount();

    const uploaded = render(<PetArtwork pet={{ ...illustratedPet, id: 'uploaded-dog', illustrationUrl: undefined }} size={114} />);
    expect(uploaded.container.querySelector('[data-pet-signature]')).not.toBeInTheDocument();
    expect(uploaded.container.querySelector('[data-ear-variant]')).not.toBeInTheDocument();
  });

  it('does not overlay a signature on finished curated artwork', () => {
    const { container } = render(<PetArtwork pet={{ ...illustratedPet, id: 'sample-gureumi' }} size={114} />);
    expect(container.querySelector('[data-pet-signature]')).not.toBeInTheDocument();
  });
});
