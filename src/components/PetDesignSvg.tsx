import { createElement, useId, useMemo } from 'react';
import { validatePetDesign, type PetDesignV1, type SvgDesignNode } from '../../supabase/functions/_shared/pet-design';
import './PetDesignSvg.css';

export interface PetDesignSvgProps {
  document: PetDesignV1;
  name?: string;
  size?: number;
  active?: boolean;
  eating?: boolean;
  panting?: boolean;
  happy?: boolean;
}

/** The only final artwork renderer. Geometry is data; trusted CSS owns motion. */
export function PetDesignSvg({ document, name, size = 150, active = false, eating = false, panting = false, happy = false }: PetDesignSvgProps) {
  const instanceId = `pet-${useId().replace(/[^a-zA-Z0-9_-]/g, '')}-`;
  const design = useMemo(() => validatePetDesign(document), [document]);
  function renderNode(node: SvgDesignNode, key: string): React.ReactNode {
    const attrs: Record<string, unknown> = { ...node.attrs, key };
    if (typeof attrs.id === 'string') attrs.id = `${instanceId}${attrs.id}`;
    for (const attribute of ['clipPath', 'mask', 'fill', 'stroke']) {
      if (typeof attrs[attribute] === 'string') attrs[attribute] = (attrs[attribute] as string).replace(/^url\(#([^)]+)\)$/, `url(#${instanceId}$1)`);
    }
    const children = node.children?.map((child, index) => renderNode(child, `${key}.${index}`));
    if (node.motion) {
      const tongueShape = node.attrs?.['data-tongue-shape'];
      const suffix = node.motion === 'tongue' && ['drop', 'round', 'wide', 'side'].includes(String(tongueShape)) ? ` dog-tongue--${tongueShape}` : '';
      // Keep the stored transform outside the group whose transform CSS animates.
      return createElement('g', attrs, createElement('g', { className: `dog-${node.motion}${suffix}`, 'data-motion-role': node.motion }, children));
    }
    return createElement(node.tag, attrs, children);
  }
  const stateClasses = [active && 'is-active', eating && 'is-eating', panting && 'is-panting', happy && 'is-happy'].filter(Boolean).join(' ');
  return (
    <div className={`dog-avatar pet-design-svg ${stateClasses}`} style={{ width: size }} aria-label={name ? `${name} 강아지` : '강아지'} data-design-schema={design.schemaVersion}>
      <svg viewBox={design.viewBox.join(' ')} role="img" aria-hidden="true">
        {design.nodes.map((node, index) => renderNode(node, String(index)))}
      </svg>
      {name && <span className="dog-name">{name}</span>}
    </div>
  );
}
