import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { canonicalPetDesign, validatePetDesign, type PetDesignV1, type SvgDesignNode } from '../../supabase/functions/_shared/pet-design';
import { PetDesignSvg } from '../components/PetDesignSvg';
import { buildPetDesign, type BuildPetDesignInput } from './buildPetDesign';
import { createDesignEditor, restoreDesignEditor, updateDesignEditor } from './designEditor';

const input: BuildPetDesignInput = {
  traits: { schemaVersion: 1, earShape: 'upright', headShape: 'round', baseColor: 'white', secondaryColor: 'white', markingPattern: 'none', muzzle: 'short', confidence: 0.9 },
  style: { schemaVersion: 1, coatMode: 'solid', furStyle: 'fluffy' },
};
const eachNode = (nodes: SvgDesignNode[]): SvgDesignNode[] => nodes.flatMap((node) => [node, ...eachNode(node.children ?? [])]);

describe('portable SVG contract', () => {
  it('normalizes internal IDs and attribute key order into identical canonical documents', () => {
    const left = buildPetDesign(input);
    const serialized = JSON.stringify(left).replaceAll('d0', 'other-head');
    const right = JSON.parse(serialized) as PetDesignV1;
    right.nodes = right.nodes.map((node) => ({ ...node, ...(node.attrs ? { attrs: Object.fromEntries(Object.entries(node.attrs).reverse()) } : {}) }));
    expect(canonicalPetDesign(right)).toBe(canonicalPetDesign(left));
    expect(validatePetDesign(validatePetDesign(left))).toEqual(left);
  });

  it.each([
    { tag: 'script' }, { tag: 'foreignObject' }, { tag: 'image', attrs: { href: 'https://outside.test/x' } },
    { tag: 'path', attrs: { style: 'animation:evil' } }, { tag: 'path', attrs: { className: 'app-modal' } },
    { tag: 'path', attrs: { onClick: 'alert(1)' } }, { tag: 'path', attrs: { fill: 'url(https://outside.test/x)' } },
    { tag: 'path', attrs: { 'data-note': 'https://outside.test' } }, { tag: 'path', attrs: { 'data-note': '<script>' } },
    { tag: 'path', attrs: { fill: 'currentColor' } },
    { tag: 'path', attrs: { clipPath: 'url(#missing)' } }, { tag: 'path', attrs: { d: 'M0 0 L1e200 1' } },
  ])('rejects executable, external or unsupported SVG payload %#', (node) => {
    expect(() => validatePetDesign({ schemaVersion: 1, motionVersion: 1, viewBox: [0, 0, 180, 156], nodes: [node] })).toThrow('INVALID_PET_DESIGN');
  });

  it('bounds tree depth, duplicate IDs, and unsupported versions', () => {
    let node: SvgDesignNode = { tag: 'path', attrs: { d: 'M0 0' } };
    for (let index = 0; index < 25; index++) node = { tag: 'g', children: [node] };
    const base = { schemaVersion: 1, motionVersion: 1, viewBox: [0, 0, 180, 156] };
    expect(() => validatePetDesign({ ...base, nodes: [node] })).toThrow('tree bounds');
    expect(() => validatePetDesign({ ...base, nodes: [{ tag: 'g', attrs: { id: 'same' } }, { tag: 'g', attrs: { id: 'same' } }] })).toThrow('duplicate ID');
    expect(() => validatePetDesign({ ...buildPetDesign(input), motionVersion: 2 })).toThrow('unsupported version');
  });
});

describe('stored SVG renderer and authoring', () => {
  it.each(['chocolate-cookie', 'black-sunglasses', 'strawberry-milk', 'chive-bundle', 'chew-bone', 'cheese-wedge', 'cloud-cotton-candy', 'birthday-star', 'gray-backpack', 'milk-carton'] as const)('retains %s geometry after JSON storage', (signature) => {
    const document = JSON.parse(JSON.stringify(buildPetDesign({ ...input, signature })));
    const { container } = render(<PetDesignSvg document={document} />);
    expect(container.querySelector(`[data-pet-signature="${signature}"]`)).not.toBeNull();
    expect(container.querySelector('img')).toBeNull();
  });

  it('prefixes masks per instance and preserves nested cookie muzzle and animation transforms', () => {
    const document = buildPetDesign({ ...input, signature: 'chocolate-cookie' });
    const { container } = render(<><PetDesignSvg document={document} panting eating /><PetDesignSvg document={document} /></>);
    const ids = Array.from(container.querySelectorAll('clipPath')).map((element) => element.id);
    expect(new Set(ids).size).toBe(2);
    const markReferences = Array.from(container.querySelectorAll('[data-head-markings]')).map((element) => element.getAttribute('clip-path'));
    expect(markReferences).toEqual(ids.map((id) => `url(#${id})`));
    expect(container.querySelector('[data-cookie-muzzle]')).toHaveAttribute('transform', 'translate(90 88) scale(.75) translate(-90 -88)');
    expect(container.querySelector('[data-cookie-muzzle] .dog-tongue')).not.toBeNull();
    expect(container.querySelector('.is-eating.is-panting .dog-tail')).not.toBeNull();
  });

  it('preserves freeform custom geometry and layer position when standard traits change after restoring', () => {
    const state = createDesignEditor({ ...input, signature: 'chocolate-cookie' });
    const head = eachNode(state.document.nodes).find((node) => node.attrs?.['data-head-fill']);
    head!.attrs!.d = 'M90 12 Q140 10 145 80 Q90 145 35 80 Q40 10 90 12Z';
    const custom: SvgDesignNode = { tag: 'g', attrs: { 'data-design-part': 'author-new-flower' }, children: [{ tag: 'circle', attrs: { cx: 140, cy: 120, r: 8, fill: '#AA22AA' } }] };
    state.document.nodes.splice(3, 0, custom);
    const restored = restoreDesignEditor(JSON.parse(JSON.stringify(state)));
    const changed = updateDesignEditor(restored, { traits: { ...input.traits, baseColor: 'gray', secondaryColor: 'gray' } });
    const nodes = eachNode(changed.document.nodes);
    expect(nodes.find((node) => node.attrs?.['data-head-fill'])?.attrs?.d).toBe(head!.attrs!.d);
    expect(nodes.find((node) => node.attrs?.['data-head-fill'])?.attrs?.fill).toBe('#A8A6AE');
    expect(changed.document.nodes[3].attrs?.['data-design-part']).toBe('author-new-flower');
    expect(nodes.find((node) => node.attrs?.['data-cookie-muzzle'])?.attrs?.transform).toContain('scale(.75)');
    expect(nodes.find((node) => node.attrs?.['data-pet-signature'] === 'chocolate-cookie')).toBeTruthy();
  });

  it('changes a standard accessory without losing an independently added signature', () => {
    const state = createDesignEditor({ ...input, signature: 'black-sunglasses', accessory: { kind: 'ball', color: 'yellow', assetKey: 'builtin:ball' } });
    const changed = updateDesignEditor(state, { accessory: { kind: 'scarf', color: 'mint', assetKey: 'builtin:scarf' } });
    const nodes = eachNode(changed.document.nodes);
    expect(nodes.some((node) => node.attrs?.['data-pet-accessory'] === 'ball')).toBe(false);
    expect(nodes.some((node) => node.attrs?.['data-pet-accessory'] === 'scarf')).toBe(true);
    expect(nodes.some((node) => node.attrs?.['data-seolgi-bow-tie'])).toBe(true);
    expect(nodes.some((node) => node.attrs?.['data-pet-signature'] === 'black-sunglasses')).toBe(true);
  });

  it('retains an explicitly edited layer order after another trait change', () => {
    const state = createDesignEditor(input);
    const bodyIndex = state.document.nodes.findIndex((node) => node.attrs?.['data-design-part'] === 'body');
    const [body] = state.document.nodes.splice(bodyIndex, 1);
    state.document.nodes.push(body);
    const changed = updateDesignEditor(state, { traits: { ...input.traits, baseColor: 'gray', secondaryColor: 'gray' } });
    expect(changed.document.nodes.at(-1)?.attrs?.['data-design-part']).toBe('body');
    expect(changed.document.nodes.at(-1)?.attrs?.fill).toBe('#A8A6AE');
  });
});
