import { useMemo } from 'react';
import type { PetAccessory, PetStyleV1, PetSummary, PetTraitsV1 } from '../types';
import { buildPetDesign } from '../design/buildPetDesign';
import { usePetDesign, usesPublishedDesign } from '../lib/petDesignResource';
import { PetDesignSvg } from './PetDesignSvg';
import './PetArtwork.css';

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
  /** Parent cards provide their own retry action instead of nesting buttons. */
  retryControl?: boolean;
};

export function PetArtwork({ pet, traits, name, size, active, eating, panting, happy, accessory, style, retryControl = true }: PetArtworkProps) {
  const design = usePetDesign(pet);
  const resolvedTraits = pet?.traits ?? traits;
  const resolvedStyle = pet?.publishedStyle ?? style;
  const resolvedAccessory = pet?.publishedAccessory ?? accessory;
  const isPublished = usesPublishedDesign(pet);
  const preview = useMemo(() => !isPublished && resolvedTraits
    ? buildPetDesign({ traits: resolvedTraits, style: resolvedStyle, accessory: resolvedAccessory }) : undefined,
  [isPublished, resolvedTraits, resolvedStyle, resolvedAccessory]);
  const document = design?.snapshot.publishedDesign?.document ?? preview;
  const label = pet?.name ?? name;

  if (document) return <div className={`pet-artwork-design ${eating ? 'is-eating' : ''}`} data-design-sha256={design?.snapshot.publishedDesign?.sha256}
    data-design-version={design?.snapshot.publishedDesign?.designVersion}>
    <PetDesignSvg document={document} name={label} size={size} active={active} eating={eating} panting={panting} happy={happy} />
  </div>;

  if (!design) return null;
  const failed = design.snapshot.status === 'error';
  return <figure className="pet-artwork-image pet-design-unavailable" data-design-state={design.snapshot.status} style={{ width: size }}>
    <span className="pet-artwork-frame">
      <span className="pet-artwork-status" role="status" aria-live="polite">
        <span aria-hidden="true">{failed ? '↻' : '· · ·'}</span>
        <span className="pet-artwork-status-copy">{failed ? '다시 불러오기' : '불러오는 중'}</span>
        <span className="pet-artwork-sr-only">{label ?? '강아지'} 캐릭터{failed ? '를 불러오지 못했어요.' : '를 불러오고 있어요.'}</span>
      </span>
      {failed && retryControl && <button className="pet-artwork-retry" type="button" aria-label={`${label ?? '강아지'} 캐릭터 다시 불러오기`}
        onClick={(event) => { event.stopPropagation(); void design.resource.retry(); }} />}
    </span>
    {label && <figcaption>{label}</figcaption>}
  </figure>;
}
