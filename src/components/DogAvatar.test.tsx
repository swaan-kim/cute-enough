import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { DogAvatar } from './DogAvatar';
import type { PetTraitsV1 } from '../types';

const traits: PetTraitsV1 = {
  schemaVersion: 1,
  earShape: 'floppy',
  headShape: 'round',
  baseColor: 'cream',
  secondaryColor: 'caramel',
  markingPattern: 'brow',
  muzzle: 'short',
  confidence: 0.96,
};

describe('DogAvatar expressions', () => {
  it('renders the safe default expression for existing data', () => {
    const { container } = render(<DogAvatar traits={traits} panting />);
    expect(container.querySelector('[data-brow-style]')).not.toBeInTheDocument();
    expect(container.querySelector('[data-tongue-shape="drop"]')).toBeInTheDocument();
  });

  it('renders a selected eyebrow and tongue independently from coat markings', () => {
    const { container } = render(<DogAvatar traits={traits} expression={{ browStyle: 'caterpillar', tongueShape: 'side' }} panting />);
    expect(container.querySelector('[data-brow-style="caterpillar"]')).toBeInTheDocument();
    expect(container.querySelector('[data-tongue-shape="side"]')).toBeInTheDocument();
    expect(container.querySelector('.dog-tongue--side')).toBeInTheDocument();
  });
});
