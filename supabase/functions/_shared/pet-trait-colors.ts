export const PET_COAT_COLORS = ['cream', 'caramel', 'chocolate', 'black', 'gray', 'white'] as const;

export type PetCoatColor = typeof PET_COAT_COLORS[number];

export interface PetTraitColorFields {
  baseColor: PetCoatColor;
  secondaryColor: PetCoatColor;
  markingPattern: string;
}

const CONTRASTING_COAT_COLORS: Record<PetCoatColor, PetCoatColor> = {
  white: 'caramel',
  cream: 'caramel',
  caramel: 'cream',
  chocolate: 'cream',
  black: 'cream',
  gray: 'white',
};

/** Returns the default point color to use when it must contrast with the base coat. */
export function getContrastingCoatColor(baseColor: PetCoatColor): PetCoatColor {
  return CONTRASTING_COAT_COLORS[baseColor];
}

/** A single-color dog may share colors, but visible markings must contrast. */
export function isPetTraitColorContrastValid(traits: PetTraitColorFields): boolean {
  return traits.markingPattern === 'none' || traits.baseColor !== traits.secondaryColor;
}

/**
 * Repairs legacy or intermediate traits without replacing a valid extracted point color.
 * The original object is returned when no correction is needed.
 */
export function normalizePetTraitColors<T extends PetTraitColorFields>(traits: T): T {
  if (isPetTraitColorContrastValid(traits)) return traits;
  return {
    ...traits,
    secondaryColor: getContrastingCoatColor(traits.baseColor),
  };
}
