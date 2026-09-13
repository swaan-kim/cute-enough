import { render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { PetDesignSvg } from './PetDesignSvg';
import { SAMPLE_PETS } from '../data/samplePets';

const document = SAMPLE_PETS[0].publishedDesign!.document;
const originalBBox = Object.getOwnPropertyDescriptor(SVGElement.prototype, 'getBBox');
afterEach(() => {
  if (originalBBox) Object.defineProperty(SVGElement.prototype, 'getBBox', originalBBox);
  else Reflect.deleteProperty(SVGElement.prototype, 'getBBox');
});

describe('transient reviewed SVG smile', () => {
  it('uses the measured saved eye geometry and restores the untouched document', () => {
    const before = JSON.stringify(document);
    Object.defineProperty(SVGElement.prototype, 'getBBox', { configurable: true, value: vi.fn(() => ({ x: 31, y: 42, width: 10, height: 8 })) });
    const { container, rerender } = render(<PetDesignSvg document={document} smiling />);
    const arcs = container.querySelectorAll('.pet-smile-arc');
    expect(arcs).toHaveLength(2);
    expect(arcs[0]).toHaveAttribute('d', 'M 31 47.2 A 5 4.8 0 0 1 41 47.2');
    expect(arcs[0]).toHaveAttribute('stroke-linecap', 'round');
    expect(container.querySelector('[data-design-part="left-eye"]')?.parentElement).toHaveAttribute('visibility', 'hidden');
    rerender(<PetDesignSvg document={document} smiling={false} />);
    expect(container.querySelector('.pet-smile-arc')).toBeNull();
    expect(container.querySelector('[data-design-part="left-eye"]')?.parentElement).not.toHaveAttribute('visibility');
    expect(JSON.stringify(document)).toBe(before);
  });

  it.each(['missing', 'empty', 'throws'])('keeps the original eyes when geometry is %s', (kind) => {
    if (kind !== 'missing') Object.defineProperty(SVGElement.prototype, 'getBBox', { configurable: true, value: () => {
      if (kind === 'throws') throw new Error('not measurable');
      return { x: 0, y: 0, width: 0, height: 0 };
    } });
    const { container } = render(<PetDesignSvg document={document} smiling />);
    expect(container.querySelector('.pet-smile-arc')).toBeNull();
    expect(container.querySelector('[data-design-part="left-eye"]')?.parentElement).not.toHaveAttribute('visibility');
  });
});
