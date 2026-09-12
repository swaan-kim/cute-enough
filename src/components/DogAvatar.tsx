import { useMemo } from 'react';
import { buildPetDesign, type BuildPetDesignInput } from '../design/buildPetDesign';
import { PetDesignSvg, type PetDesignSvgProps } from './PetDesignSvg';

export { COAT_COLOR_HEX, EAR_VISUAL_SPECS, getEarVisualSpec, getSolidCoatShade, getHeadOutlinePath } from '../design/buildPetDesign';
export type { EarVisualSpec } from '../design/buildPetDesign';
export type DogAvatarProps = BuildPetDesignInput & Omit<PetDesignSvgProps, 'document'>;

/** Registration preview facade: publication uses stored PetDesignV1 directly. */
export function DogAvatar({ traits, style, expression, signature, earVariant, accessory, ...display }: DogAvatarProps) {
  const document = useMemo(() => buildPetDesign({ traits, style, expression, signature, earVariant, accessory }), [traits, style, expression, signature, earVariant, accessory]);
  return <PetDesignSvg document={document} {...display} />;
}
