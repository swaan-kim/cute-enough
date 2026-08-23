import type { PetSummary, PetTraitsV1 } from '../types';
import { getPetArtwork } from '../data/petArtwork';
import { DogAvatar } from './DogAvatar';

type PetArtworkProps = {
  pet?: PetSummary;
  traits?: PetTraitsV1;
  name?: string;
  size: number;
  active?: boolean;
  eating?: boolean;
  panting?: boolean;
  happy?: boolean;
};

export function PetArtwork({ pet, traits, name, size, active, eating, panting, happy }: PetArtworkProps) {
  const artwork = getPetArtwork(pet?.id, pet?.illustrationUrl);

  if (artwork) {
    return (
      <figure className={`pet-artwork-image ${active ? 'is-active' : ''} ${eating ? 'is-eating' : ''} ${happy ? 'is-happy' : ''}`} style={{ width: size }}>
        <img src={artwork} alt={`${pet?.name ?? name ?? '강아지'} 캐릭터`} />
        {panting && <span className="panting-tongue-point" aria-hidden="true" />}
        {(pet?.name ?? name) && <figcaption>{pet?.name ?? name}</figcaption>}
      </figure>
    );
  }

  const resolvedTraits = pet?.traits ?? traits;
  if (!resolvedTraits) return null;
  return (
    <DogAvatar
      traits={resolvedTraits}
      name={pet?.name ?? name}
      size={size}
      active={active}
      eating={eating}
      panting={panting}
      happy={happy}
    />
  );
}
