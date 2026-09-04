import { useEffect, useRef, useState } from 'react';
import type { PetAccessory, PetStyleV1, PetTraitsV1 } from '../types';
import { PetArtwork } from './PetArtwork';

type Props = { traits: PetTraitsV1; style?: PetStyleV1; name: string; accessory?: PetAccessory };

export function UploadPetPreview({ traits, style, name, accessory }: Props) {
  const sentinelRef = useRef<HTMLDivElement>(null);
  const [compact, setCompact] = useState(false);

  useEffect(() => {
    const update = () => {
      const sentinel = sentinelRef.current;
      if (sentinel) setCompact(sentinel.getBoundingClientRect().bottom <= 4);
    };
    update();
    window.addEventListener('scroll', update, { passive: true });
    window.addEventListener('resize', update);
    return () => {
      window.removeEventListener('scroll', update);
      window.removeEventListener('resize', update);
    };
  }, []);

  return (
    <>
      <div className="preview-panel upload-pet-preview upload-pet-preview--large">
        <PetArtwork traits={traits} style={style} accessory={accessory} name={name.trim() || undefined} size={190} />
        <span><strong>이 모습으로<br />집에 놀러 와요</strong><small>사진의 대표 털색을 참고했어요</small></span>
      </div>
      <div className="upload-preview-sentinel" ref={sentinelRef} aria-hidden="true" />
      {compact && (
        <div className="upload-pet-preview-compact" aria-hidden="true">
          <PetArtwork traits={traits} style={style} accessory={accessory} size={82} />
          <span><strong>{name.trim() || '꾸미는 중'}</strong><small>바꾼 모습이 바로 반영돼요</small></span>
        </div>
      )}
    </>
  );
}
