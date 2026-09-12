import { forwardRef, type ButtonHTMLAttributes } from 'react';
import type { PetSummary } from '../types';
import { usePetDesign } from '../lib/petDesignResource';

/** An unavailable design turns the existing card into retry without starting an encounter. */
export const PetArtworkButton = forwardRef<HTMLButtonElement, ButtonHTMLAttributes<HTMLButtonElement> & { pet: PetSummary }>(
  function PetArtworkButton({ pet, onClick, onPointerDown, children, ...props }, ref) {
    const design = usePetDesign(pet);
    const failed = design?.snapshot.status === 'error';
    const loading = design?.snapshot.status === 'loading';
    return <button {...props} ref={ref} aria-busy={loading || undefined} aria-label={failed ? `${pet.name ?? '강아지'} 캐릭터 다시 불러오기` : props['aria-label']}
      onPointerDown={(event) => { if (!failed && !loading) onPointerDown?.(event); }}
      onClick={(event) => {
        if (failed) { event.preventDefault(); event.stopPropagation(); void design?.resource.retry(); }
        else if (loading) { event.preventDefault(); event.stopPropagation(); }
        else onClick?.(event);
      }}>{children}</button>;
  },
);
