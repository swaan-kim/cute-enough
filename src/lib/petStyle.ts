import type {
  BrowStyle,
  CoatColor,
  CoatMode,
  FurStyle,
  PetStyleV1,
  PetTraitsV1,
  TongueShape,
} from '../types';

const COAT_MODES: readonly CoatMode[] = ['solid', 'point'];
const FUR_STYLES: readonly FurStyle[] = ['neat', 'fluffy', 'cloud'];
const BROW_STYLES: readonly BrowStyle[] = ['none', 'soft', 'caterpillar', 'angled'];
const TONGUE_SHAPES: readonly TongueShape[] = ['drop', 'round', 'wide', 'side'];

export const SOFT_POINT_COLOR: Readonly<Record<CoatColor, CoatColor>> = {
  white: 'cream',
  cream: 'white',
  caramel: 'cream',
  chocolate: 'cream',
  black: 'cream',
  gray: 'white',
};

export function getSoftPointColor(baseColor: CoatColor): CoatColor {
  return SOFT_POINT_COLOR[baseColor];
}

export function inferCoatMode(traits: PetTraitsV1): CoatMode {
  return traits.baseColor === traits.secondaryColor && traits.markingPattern === 'none'
    ? 'solid'
    : 'point';
}

export function normalizePetStyle(traits: PetTraitsV1, value?: Partial<PetStyleV1> | null): PetStyleV1 {
  const coatMode = value?.coatMode && COAT_MODES.includes(value.coatMode)
    ? value.coatMode
    : inferCoatMode(traits);
  const furStyle = value?.furStyle && FUR_STYLES.includes(value.furStyle)
    ? value.furStyle
    : 'neat';
  const expression = value?.expression
    && BROW_STYLES.includes(value.expression.browStyle)
    && TONGUE_SHAPES.includes(value.expression.tongueShape)
    ? value.expression
    : undefined;
  return { schemaVersion: 1, coatMode, furStyle, ...(expression ? { expression } : {}) };
}

export function applyCoatMode(
  traits: PetTraitsV1,
  coatMode: CoatMode,
  point?: Pick<PetTraitsV1, 'secondaryColor' | 'markingPattern'>,
): PetTraitsV1 {
  if (coatMode === 'solid') {
    return { ...traits, secondaryColor: traits.baseColor, markingPattern: 'none' };
  }
  const secondaryColor = point?.secondaryColor && point.secondaryColor !== traits.baseColor
    ? point.secondaryColor
    : getSoftPointColor(traits.baseColor);
  return {
    ...traits,
    secondaryColor,
    markingPattern: point?.markingPattern ?? traits.markingPattern,
  };
}

export function isPetStyleInvariantValid(traits: PetTraitsV1, style: PetStyleV1): boolean {
  if (style.coatMode === 'solid') {
    return traits.baseColor === traits.secondaryColor && traits.markingPattern === 'none';
  }
  return traits.baseColor !== traits.secondaryColor;
}
