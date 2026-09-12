import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { PetArtwork } from '../components/PetArtwork';
import type { PetSummary } from '../types';
import { ReviewPetArtwork } from './ReviewPetArtwork';
import { buildPetDesign } from '../design/buildPetDesign';

const ordinaryPet: PetSummary = {
  id: 'ordinary-upload',
  name: '쿠키',
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
  publishedAccessory: { kind: 'ball', color: 'mint', assetKey: 'builtin:ball' },
};

const draftOnlyParts = '[data-pet-signature="chocolate-cookie"], [data-pet-signature="black-sunglasses"], [data-pet-signature="strawberry-milk"], [data-pet-signature="chive-bundle"], [data-pet-signature="chew-bone"], [data-pet-signature="cheese-wedge"], [data-pet-signature="cloud-cotton-candy"], [data-pet-ear-detail="cookie-pomeranian"], [data-cookie-muzzle], [data-cookie-chest]';

describe('ReviewPetArtwork', () => {
  it('displays the stored SVG instead of regenerating a custom draft', () => {
    const document = buildPetDesign({ traits: ordinaryPet.traits });
    const pet = { ...ordinaryPet, id: 'dc852ee9-b0dd-4090-a4f0-c5014bf70d2b', publishedDesign: { id: 'design-1', designVersion: 3, sha256: 'a'.repeat(64), document } };
    const { container } = render(<ReviewPetArtwork pet={pet} size={114} panting />);
    expect(container.querySelector('img')).not.toBeInTheDocument();
    expect(container.querySelector('svg')).toBeInTheDocument();
    expect(container.querySelector('[data-pet-signature="chocolate-cookie"]')).not.toBeInTheDocument();
    expect(container.querySelector('.is-panting .dog-tongue')).toBeInTheDocument();
  });
  it.each([
    { id: 'dc852ee9-b0dd-4090-a4f0-c5014bf70d2b', name: '쿠키', signature: 'chocolate-cookie' },
    { id: '617f58af-0866-4955-a290-91d57ebd6a25', name: '설기', signature: 'black-sunglasses' },
    { id: 'd830288c-8499-4093-a202-5e05f9bff3be', name: '밀크', signature: 'strawberry-milk' },
    { id: '9abe3197-ca76-4681-ae2c-b37cc9b4f3a6', name: '부추', signature: 'chive-bundle' },
    { id: '9372e013-c676-4832-951f-17e45cb8a9c4', name: '옹이', signature: 'chew-bone' },
    { id: '08a244a0-bb9e-4ca7-9dce-ca9ad6508b9c', name: '치즈', signature: 'cheese-wedge' },
    { id: 'd5e1c8c1-4d66-4c6e-a0fe-2dc98c9bf001', name: '구르미', signature: 'cloud-cotton-candy' },
  ])('shows $name details only in the review draft, never in shared artwork', ({ id, name, signature }) => {
    const pet = { ...ordinaryPet, id, name, publishedAccessory: undefined };
    const { container, rerender } = render(<ReviewPetArtwork pet={pet} size={114} />);

    expect(container.querySelector(`[data-pet-signature="${signature}"]`)).toBeInTheDocument();
    if (signature === 'chocolate-cookie') {
      expect(container.querySelector('[data-pet-ear-detail="cookie-pomeranian"]')).toBeInTheDocument();
      expect(container.querySelector('[data-cookie-muzzle="short"]')).toBeInTheDocument();
    } else {
      expect(container.querySelector('[data-pet-ear-detail="cookie-pomeranian"]')).not.toBeInTheDocument();
    }

    rerender(<PetArtwork pet={pet} size={114} />);
    expect(container.querySelector(draftOnlyParts)).not.toBeInTheDocument();
    expect(container.querySelector('svg')).not.toBeInTheDocument();
  });

  it('replaces Cheese\'s ball while preserving Gureumi\'s white ears and bandana', () => {
    const { container, rerender } = render(<ReviewPetArtwork pet={{ ...ordinaryPet, id: '08a244a0-bb9e-4ca7-9dce-ca9ad6508b9c' }} size={114} />);
    expect(container.querySelector('[data-pet-accessory="ball"]')).toBeNull();
    expect(container.querySelector('[data-pet-signature="cheese-wedge"]')).not.toBeNull();
    rerender(<ReviewPetArtwork pet={{ ...ordinaryPet, id: 'd5e1c8c1-4d66-4c6e-a0fe-2dc98c9bf001', publishedAccessory: undefined }} size={114} />);
    expect(container.querySelector('[data-ear-variant="high-floppy"]')).toHaveAttribute('fill', '#FFFDF8');
    expect(container.querySelector('[data-pet-signature="sky-bandana"]')).not.toBeNull();
    expect(container.querySelector('[data-pet-signature="cloud-cotton-candy"]')).not.toBeNull();
  });

  it('uses the ordinary renderer and its existing accessory even when another dog has the same name', () => {
    const { container, rerender } = render(<PetArtwork traits={ordinaryPet.traits} accessory={ordinaryPet.publishedAccessory} name={ordinaryPet.name} size={64} active panting />);
    const headPath = container.querySelector('[data-head-outline]')?.getAttribute('d');
    const earPath = container.querySelector('[data-ear-part="left-fill"]')?.getAttribute('d');
    const artworkClass = container.firstElementChild?.className;

    rerender(<ReviewPetArtwork pet={ordinaryPet} size={64} active panting />);
    expect(container.querySelector('[data-head-outline]')).toHaveAttribute('d', headPath);
    expect(container.querySelector('[data-ear-part="left-fill"]')).toHaveAttribute('d', earPath);
    expect(container.firstElementChild?.className.trim()).toBe(artworkClass?.trim());
    expect(container.querySelector('[data-pet-accessory="ball"]')).toHaveAttribute('data-accessory-color', 'mint');
    expect(container.querySelector(draftOnlyParts)).not.toBeInTheDocument();
  });
});
