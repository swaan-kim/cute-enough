export const MAX_PET_NAME_LENGTH = 4;

export function petNameLength(value: string) {
  return Array.from(value.normalize('NFC')).length;
}

export function limitPetName(value: string) {
  return Array.from(value.normalize('NFC')).slice(0, MAX_PET_NAME_LENGTH).join('');
}

export function preparePetName(value: string) {
  return limitPetName(value.trim());
}
