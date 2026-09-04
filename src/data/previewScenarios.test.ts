import { afterEach, describe, expect, it } from 'vitest';
import {
  getPreviewScenario,
  getScenarioOwnerPet,
  getScenarioPublicPets,
  getScenarioStorage,
  PREVIEW_SCENARIO_PETS,
} from './previewScenarios';

afterEach(() => localStorage.clear());

describe('preview URL scenarios', () => {
  it('accepts only the documented preview scenario names', () => {
    expect(getPreviewScenario('?scenario=five')).toBe('five');
    expect(getPreviewScenario('?scenario=owner')).toBe('owner');
    expect(getPreviewScenario('?scenario=complete')).toBe('complete');
    expect(getPreviewScenario('?scenario=ads-off')).toBe('ads-off');
    expect(getPreviewScenario('?scenario=production')).toBeUndefined();
    expect(getPreviewScenario('')).toBeUndefined();
  });

  it('provides five visibly marked, unique local-photo fixtures', () => {
    expect(PREVIEW_SCENARIO_PETS).toHaveLength(5);
    expect(new Set(PREVIEW_SCENARIO_PETS.map(({ id }) => id))).toHaveLength(5);
    expect(PREVIEW_SCENARIO_PETS.every(({ name }) => name?.startsWith('샘플'))).toBe(true);
    expect(PREVIEW_SCENARIO_PETS.every(({ photoUrl }) => photoUrl?.startsWith('/sample-pets/'))).toBe(true);
    expect(getScenarioPublicPets('five')).toBe(PREVIEW_SCENARIO_PETS);
    expect(getScenarioPublicPets(undefined)).toBeUndefined();
  });

  it('adds the owner fixture only to the owner scenario', () => {
    expect(getScenarioOwnerPet('owner')).toMatchObject({
      name: '내 샘플', isMine: true, ownerPinned: true, ownerPhotoAvailable: true,
    });
    expect(getScenarioOwnerPet('five')).toBeUndefined();
  });

  it('keeps scenario state out of the ordinary preview storage keys', () => {
    const scenarioStorage = getScenarioStorage('five');
    scenarioStorage.setItem('allowance', 'scenario-value');
    localStorage.setItem('allowance', 'default-value');

    expect(scenarioStorage.getItem('allowance')).toBe('scenario-value');
    expect(localStorage.getItem('allowance')).toBe('default-value');
  });
});
