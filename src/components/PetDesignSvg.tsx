import { createElement, useId, useMemo, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
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
  smiling?: boolean;
}

/** The only final artwork renderer. Geometry is data; trusted CSS owns motion. */
export function PetDesignSvg({ document, name, size = 150, active = false, eating = false, panting = false, happy = false, smiling = false }: PetDesignSvgProps) {
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
    const original = createElement(node.tag, attrs, children);
    const part = node.attrs?.['data-design-part'];
    return part === 'left-eye' || part === 'right-eye'
      ? <SmileEye key={key} smiling={smiling}>{original}</SmileEye>
      : original;
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

/** Transient expression only: measure the saved eye, never rewrite its document. */
function SmileEye({ smiling, children }: { smiling: boolean; children: ReactNode }) {
  const originalRef = useRef<SVGGElement>(null);
  const [eye, setEye] = useState<{ x: number; y: number; width: number; height: number; color: string }>();
  useLayoutEffect(() => {
    if (!smiling) { setEye(undefined); return; }
    const original = originalRef.current;
    if (!original || typeof original.getBBox !== 'function') return;
    try {
      // The wrapper's box includes transforms on the stored eye node.
      const box = original.getBBox();
      if (![box.x, box.y, box.width, box.height].every(Number.isFinite) || box.width <= 0 || box.height <= 0) return;
      const shape = original.querySelector('circle,ellipse,path,rect') ?? original.firstElementChild;
      const fill = shape ? getComputedStyle(shape).fill : '';
      const color = fill && fill !== 'none' && !fill.startsWith('url(') ? fill : '#25222A';
      setEye({ x: box.x, y: box.y, width: box.width, height: box.height, color });
    } catch { /* Unmeasurable eyes retain the original approved artwork. */ }
  }, [smiling]);
  const visible = smiling && eye;
  return <g className="pet-smile-eye">
    <g ref={originalRef} visibility={visible ? 'hidden' : undefined}>{children}</g>
    {visible && <path
      className="pet-smile-arc"
      d={`M ${eye.x} ${eye.y + eye.height * .65} A ${eye.width / 2} ${eye.height * .6} 0 0 1 ${eye.x + eye.width} ${eye.y + eye.height * .65}`}
      fill="none" stroke={eye.color} strokeWidth={eye.width * .27} strokeLinecap="round"
      pointerEvents="none" aria-hidden="true"
    />}
  </g>;
}
