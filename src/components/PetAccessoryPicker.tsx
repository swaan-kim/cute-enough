import type { AccessorySelectionMode, PetAccessory, PetAccessoryColor, PetAccessoryKind, PetTraitsV1 } from '../types';
import {
  PET_ACCESSORY_COLORS,
  PET_ACCESSORY_COLOR_HEX,
  PET_ACCESSORY_COLOR_LABELS,
  PET_ACCESSORY_KINDS,
  PET_ACCESSORY_KIND_LABELS,
  createPetAccessory,
} from '../lib/petAccessory';
import { PetArtwork } from './PetArtwork';

type Props = {
  traits: PetTraitsV1;
  mode?: AccessorySelectionMode;
  accessory?: PetAccessory;
  disabled?: boolean;
  onChange: (mode: AccessorySelectionMode, accessory?: PetAccessory) => void;
};

export function PetAccessoryPicker({ traits, mode, accessory, disabled = false, onChange }: Props) {
  const chooseKind = (kind: PetAccessoryKind) => {
    onChange('owner', createPetAccessory(kind, accessory?.color ?? 'pink'));
  };
  const chooseColor = (color: PetAccessoryColor) => {
    if (accessory) onChange('owner', createPetAccessory(accessory.kind, color));
  };

  return (
    <fieldset className="accessory-choice-fieldset" aria-describedby="accessory-choice-help" disabled={disabled}>
      <legend>이 친구만의 포인트</legend>
      <p className="trait-choice-help" id="accessory-choice-help">좋아하는 소품을 하나 고르거나 검수자에게 맡겨주세요.</p>
      <div className="trait-choice-grid accessory-choice-grid">
        {PET_ACCESSORY_KINDS.map((kind) => {
          const selected = mode === 'owner' && accessory?.kind === kind;
          const previewAccessory = createPetAccessory(kind, selected ? accessory.color : 'pink');
          return (
            <label className={`trait-choice-card accessory-choice-card ${selected ? 'is-selected' : ''}`} key={kind}>
              <input className="trait-choice-input" type="radio" name="pet-accessory-kind" value={kind} checked={selected} onChange={() => chooseKind(kind)} disabled={disabled} />
              <span className="trait-artwork-preview accessory-artwork-preview" aria-hidden="true"><PetArtwork traits={traits} accessory={previewAccessory} size={72} /></span>
              <span className="trait-choice-copy"><strong>{PET_ACCESSORY_KIND_LABELS[kind]}</strong></span>
            </label>
          );
        })}
      </div>
      {mode === 'owner' && accessory && (
        <fieldset className="accessory-color-fieldset">
          <legend>소품 색상</legend>
          <div className="accessory-color-options">
            {PET_ACCESSORY_COLORS.map((color) => (
              <label className={`accessory-color-option ${accessory.color === color ? 'is-selected' : ''}`} key={color}>
                <input className="trait-choice-input" type="radio" name="pet-accessory-color" value={color} checked={accessory.color === color} onChange={() => chooseColor(color)} disabled={disabled} />
                <span className="accessory-color-swatch" style={{ background: PET_ACCESSORY_COLOR_HEX[color] }} aria-hidden="true" />
                <span>{PET_ACCESSORY_COLOR_LABELS[color]}</span>
              </label>
            ))}
          </div>
        </fieldset>
      )}
      <button className={`accessory-reviewer-choice ${mode === 'reviewer' ? 'is-selected' : ''}`} type="button" aria-pressed={mode === 'reviewer'} disabled={disabled} onClick={() => onChange('reviewer')}>
        <span aria-hidden="true">{mode === 'reviewer' ? '✓' : '✦'}</span>
        <span><strong>검수자에게 맡기기</strong><small>사진을 보고 어울리는 포인트를 골라드려요.</small></span>
      </button>
    </fieldset>
  );
}
