import type { PetAccessory, PetStyleV1, PetSummary, PetTraitsV1 } from '../types';
import { getPetArtwork } from '../data/petArtwork';
import { getPetEarVariant, getPetSignature } from '../data/petSignature';
import { getPetExpression } from '../lib/petExpression';
import { normalizePetStyle } from '../lib/petStyle';
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
  accessory?: PetAccessory;
  style?: PetStyleV1;
};

export function PetArtwork({ pet, traits, name, size, active, eating, panting, happy, accessory, style }: PetArtworkProps) {
  const artwork = getPetArtwork(pet?.id, pet?.illustrationUrl);
  const resolvedAccessory = pet?.publishedAccessory ?? accessory;

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
  const resolvedStyle = normalizePetStyle(resolvedTraits, pet?.publishedStyle ?? style);
  return (
    <DogAvatar
      traits={resolvedTraits}
      style={resolvedStyle}
      expression={resolvedStyle.expression ?? getPetExpression(pet?.id)}
      signature={getPetSignature(pet?.id)}
      earVariant={getPetEarVariant(pet?.id)}
      name={pet?.name ?? name}
      size={size}
      active={active}
      eating={eating}
      panting={panting}
      happy={happy}
      accessory={resolvedAccessory}
    />
  );
}
