import type { BrowStyle, PetExpression, TongueShape } from '../types';

const BROW_STYLES: BrowStyle[] = ['none', 'soft', 'caterpillar', 'angled'];
const TONGUE_SHAPES: TongueShape[] = ['drop', 'round', 'wide', 'side'];

const SAMPLE_EXPRESSIONS: Readonly<Record<string, PetExpression>> = {
  'sample-haneul': { browStyle: 'none', tongueShape: 'wide' },
  'd5e1c8c1-4d66-4c6e-a0fe-2dc98c9bf003': { browStyle: 'none', tongueShape: 'wide' },
  'sample-gureumi': { browStyle: 'soft', tongueShape: 'round' },
  'd5e1c8c1-4d66-4c6e-a0fe-2dc98c9bf001': { browStyle: 'soft', tongueShape: 'round' },
};

const DEFAULT_EXPRESSION: PetExpression = { browStyle: 'none', tongueShape: 'drop' };

function hashPetId(petId: string, seed: number) {
  let hash = seed >>> 0;
  for (const character of petId) {
    hash ^= character.charCodeAt(0);
    hash = Math.imul(hash, 16777619) >>> 0;
  }
  return hash;
}

export function getPetExpression(petId?: string): PetExpression {
  if (!petId) return DEFAULT_EXPRESSION;
  const sampleExpression = SAMPLE_EXPRESSIONS[petId];
  if (sampleExpression) return sampleExpression;

  return {
    browStyle: BROW_STYLES[hashPetId(petId, 2166136261) % BROW_STYLES.length],
    tongueShape: TONGUE_SHAPES[hashPetId(petId, 3339675911) % TONGUE_SHAPES.length],
  };
}
