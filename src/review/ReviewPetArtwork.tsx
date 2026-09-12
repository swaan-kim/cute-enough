import { useMemo, type ComponentProps } from 'react';
import type { PetArtwork } from '../components/PetArtwork';
import { PetDesignSvg } from '../components/PetDesignSvg';
import { buildPetDesign } from '../design/buildPetDesign';
import type { PetDesignV1 } from '../../supabase/functions/_shared/pet-design';
import { makeReviewDesignInput } from './reviewDesign';

export { getReviewFixedAccessoryLabel } from './reviewDesign';

export function ReviewPetArtwork({ document: editorDocument, ...props }: ComponentProps<typeof PetArtwork> & { document?: PetDesignV1 }) {
  const { pet, traits, style, accessory, name, size, active, eating, panting, happy } = props;
  const resolvedTraits = pet?.traits ?? traits;
  const resolvedStyle = pet?.publishedStyle ?? style;
  const resolvedAccessory = pet?.publishedAccessory ?? accessory;
  const saved = editorDocument ?? pet?.publishedDesign?.document;
  const document = useMemo(() => saved ?? (resolvedTraits ? buildPetDesign(makeReviewDesignInput(pet?.id, resolvedTraits, resolvedStyle, resolvedAccessory)) : undefined),
    [saved, pet?.id, resolvedTraits, resolvedStyle, resolvedAccessory]);
  if (!document) return null;
  return <div className="pet-artwork-design"><PetDesignSvg document={document} name={pet?.name ?? name} size={size}
    active={active} eating={eating} panting={panting} happy={happy} /></div>;
}
