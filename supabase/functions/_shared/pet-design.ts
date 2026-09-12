/** Untrusted, portable artwork contract shared by review, API and the app. */
export type SvgDesignTag = 'g' | 'path' | 'ellipse' | 'circle' | 'rect' | 'line' | 'polyline' | 'polygon' | 'defs' | 'clipPath' | 'mask' | 'linearGradient' | 'radialGradient' | 'stop';
export type SvgDesignValue = string | number | boolean;
export interface SvgDesignNode {
  tag: SvgDesignTag;
  attrs?: Record<string, SvgDesignValue>;
  children?: SvgDesignNode[];
  motion?: 'tail' | 'tongue';
}
export interface PetDesignV1 {
  schemaVersion: 1;
  motionVersion: 1;
  viewBox: [number, number, number, number];
  nodes: SvgDesignNode[];
}
export interface PublishedPetDesign {
  id: string;
  designVersion: number;
  sha256: string;
  document: PetDesignV1;
}

export const PET_DESIGN_LIMITS = { bytes: 200_000, nodes: 1024, depth: 24, attributes: 32, pathLength: 8192, coordinate: 100_000 } as const;
const tags = new Set(['g', 'path', 'ellipse', 'circle', 'rect', 'line', 'polyline', 'polygon', 'defs', 'clipPath', 'mask', 'linearGradient', 'radialGradient', 'stop']);
const containers = new Set(['g', 'defs', 'clipPath', 'mask', 'linearGradient', 'radialGradient']);
const numbers = new Set(['x', 'y', 'x1', 'x2', 'y1', 'y2', 'cx', 'cy', 'r', 'rx', 'ry', 'width', 'height', 'strokeWidth', 'strokeMiterlimit', 'opacity', 'fillOpacity', 'strokeOpacity', 'stopOpacity', 'offset', 'fx', 'fy']);
const aliases: Record<string, string> = {
  'stroke-width': 'strokeWidth', 'stroke-linecap': 'strokeLinecap', 'stroke-linejoin': 'strokeLinejoin',
  'stroke-miterlimit': 'strokeMiterlimit', 'stroke-dasharray': 'strokeDasharray', 'stroke-dashoffset': 'strokeDashoffset',
  'fill-rule': 'fillRule', 'clip-rule': 'clipRule', 'clip-path': 'clipPath', 'fill-opacity': 'fillOpacity',
  'stroke-opacity': 'strokeOpacity', 'pointer-events': 'pointerEvents', 'stop-color': 'stopColor', 'stop-opacity': 'stopOpacity',
};
const enumerations: Record<string, readonly string[]> = {
  strokeLinecap: ['round', 'butt', 'square'], strokeLinejoin: ['round', 'miter', 'bevel'],
  fillRule: ['evenodd', 'nonzero'], clipRule: ['evenodd', 'nonzero'],
  pointerEvents: ['none'], clipPathUnits: ['userSpaceOnUse', 'objectBoundingBox'],
  maskUnits: ['userSpaceOnUse', 'objectBoundingBox'], maskContentUnits: ['userSpaceOnUse', 'objectBoundingBox'],
  gradientUnits: ['userSpaceOnUse', 'objectBoundingBox'], spreadMethod: ['pad', 'reflect', 'repeat'],
};
const colorPattern = /^(?:#[\da-f]{3,4}|#[\da-f]{6}|#[\da-f]{8}|none|transparent|white|black)$/i;
const idPattern = /^[a-zA-Z_][a-zA-Z0-9_.:-]{0,79}$/;
const numberPattern = /^[+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?$/i;
const fail = (message: string): never => { throw new Error(`INVALID_PET_DESIGN: ${message}`); };
const plain = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value) && (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);
function exactKeys(value: Record<string, unknown>, allowed: readonly string[]): void {
  if (Object.keys(value).some((key) => !allowed.includes(key))) fail('unknown field');
}
function finiteCoordinate(value: unknown): number {
  if (typeof value !== 'number' && (typeof value !== 'string' || !numberPattern.test(value))) return fail('invalid number');
  const result = Number(value);
  if (!Number.isFinite(result) || Math.abs(result) > PET_DESIGN_LIMITS.coordinate) return fail('number out of bounds');
  return Object.is(result, -0) ? 0 : result;
}
function boundedNumbers(value: string): void {
  const tokens = value.match(/[+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?/gi) ?? [];
  tokens.forEach(finiteCoordinate);
}

/** Validates and returns a detached, deterministic tree. IDs are normalized by definition order. */
export function validatePetDesign(value: unknown): PetDesignV1 {
  if (!plain(value)) return fail('document must be an object');
  exactKeys(value, ['schemaVersion', 'motionVersion', 'viewBox', 'nodes']);
  if (value.schemaVersion !== 1 || value.motionVersion !== 1) return fail('unsupported version');
  if (!Array.isArray(value.viewBox) || value.viewBox.length !== 4) return fail('invalid viewBox');
  const viewBox = value.viewBox.map(finiteCoordinate) as PetDesignV1['viewBox'];
  if (viewBox.some((coordinate) => !Number.isSafeInteger(coordinate))) return fail('viewBox must use integer coordinates');
  if (viewBox[2] <= 0 || viewBox[3] <= 0 || viewBox[2] > 4096 || viewBox[3] > 4096) return fail('invalid viewport size');
  let count = 0;
  let bytes = 0;
  const ids = new Map<string, string>();
  const references: { attrs: Record<string, SvgDesignValue>; key: string; id: string }[] = [];
  function walk(input: unknown, depth: number): SvgDesignNode {
    if (++count > PET_DESIGN_LIMITS.nodes || depth > PET_DESIGN_LIMITS.depth || !plain(input)) return fail('tree bounds');
    exactKeys(input, ['tag', 'attrs', 'children', 'motion']);
    if (typeof input.tag !== 'string' || !tags.has(input.tag)) return fail('unsupported SVG element');
    const result: SvgDesignNode = { tag: input.tag as SvgDesignTag };
    if (input.motion !== undefined) {
      if (input.tag !== 'g' || (input.motion !== 'tail' && input.motion !== 'tongue')) return fail('unsupported motion role');
      result.motion = input.motion;
    }
    if (input.attrs !== undefined) {
      if (!plain(input.attrs) || Object.keys(input.attrs).length > PET_DESIGN_LIMITS.attributes) return fail('attribute bounds');
      const attrs: Record<string, SvgDesignValue> = {};
      for (const originalKey of Object.keys(input.attrs).sort()) {
        const key = aliases[originalKey] ?? originalKey;
        if (Object.hasOwn(attrs, key)) return fail('duplicate attribute alias');
        const raw = input.attrs[originalKey];
        if (!['string', 'number', 'boolean'].includes(typeof raw)) return fail('attribute must be primitive');
        const text = String(raw);
        bytes += key.length + text.length;
        if (bytes > PET_DESIGN_LIMITS.bytes || text.length > PET_DESIGN_LIMITS.pathLength) return fail('document size');
        if (/[<>";\\\u0000-\u001f\u007f]/.test(text) || /(?:javascript:|data:|https?:|@import|expression\s*\()/i.test(text)
          || (/url\s*\(/i.test(text) && !['mask', 'clipPath', 'fill', 'stroke'].includes(key))) return fail('unsafe attribute content');
        if (/^data-[a-z][a-z0-9-]{0,63}$/.test(key)) {
          if (text.length > 256) return fail('diagnostic attribute size');
          if (typeof raw === 'number') finiteCoordinate(raw);
          attrs[key] = text;
        } else if (key === 'aria-hidden') {
          if (raw !== true && raw !== 'true') return fail('aria attribute');
          attrs[key] = true;
        } else if (numbers.has(key) || key === 'strokeDashoffset') {
          const numeric = finiteCoordinate(raw);
          if (['opacity', 'fillOpacity', 'strokeOpacity', 'stopOpacity', 'offset'].includes(key) && (numeric < 0 || numeric > 1)) return fail('opacity or offset range');
          if (['r', 'rx', 'ry', 'width', 'height', 'strokeWidth'].includes(key) && numeric < 0) return fail('negative length');
          attrs[key] = String(numeric);
        } else if (key === 'id') {
          if (!idPattern.test(text) || ids.has(text)) return fail('invalid or duplicate ID');
          const normalized = `d${ids.size}`;
          ids.set(text, normalized);
          attrs.id = normalized;
        } else if (key === 'clipPath' || key === 'mask' || ['fill', 'stroke', 'stopColor'].includes(key)) {
          const reference = /^url\(#([a-zA-Z_][a-zA-Z0-9_.:-]{0,79})\)$/.exec(text);
          if (reference && key !== 'stopColor') {
            references.push({ attrs, key, id: reference[1] }); attrs[key] = text;
          } else if ((key === 'clipPath' || key === 'mask') ? text === 'none' : colorPattern.test(text)) attrs[key] = text;
          else return fail('unsafe paint or reference');
        } else if (key === 'd') {
          if (!/^[MmZzLlHhVvCcSsQqTtAa0-9eE+.,\s-]*$/.test(text)) return fail('invalid path');
          boundedNumbers(text); attrs[key] = text;
        } else if (key === 'points' || key === 'strokeDasharray') {
          if (!/^[0-9eE+.,\s-]+$/.test(text)) return fail('invalid number list');
          boundedNumbers(text); attrs[key] = text;
        } else if (key === 'transform' || key === 'gradientTransform') {
          const commands = text.match(/(?:matrix|translate|scale|rotate|skewX|skewY)\(\s*[0-9eE+.,\s-]+\)/g);
          if (!commands || commands.join('').replace(/\s/g, '') !== text.replace(/\s/g, '')) return fail('invalid transform');
          boundedNumbers(text); attrs[key] = text;
        } else if (enumerations[key]?.includes(text)) attrs[key] = text;
        else return fail(`unsupported attribute ${key}`);
      }
      if (Object.keys(attrs).length) result.attrs = Object.fromEntries(Object.entries(attrs).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0));
      // References must update the object that is returned, rather than the temporary attribute map.
      for (const reference of references) if (reference.attrs === attrs) reference.attrs = result.attrs!;
    }
    if (input.children !== undefined) {
      if (!containers.has(result.tag) || !Array.isArray(input.children) || input.children.length > PET_DESIGN_LIMITS.nodes) return fail('invalid children');
      result.children = input.children.map((child) => walk(child, depth + 1));
    }
    return result;
  }
  if (!Array.isArray(value.nodes) || !value.nodes.length || value.nodes.length > PET_DESIGN_LIMITS.nodes) return fail('missing nodes');
  const nodes = value.nodes.map((node) => walk(node, 1));
  for (const reference of references) {
    const id = ids.get(reference.id);
    if (!id) return fail('unresolved internal reference');
    reference.attrs[reference.key] = `url(#${id})`;
  }
  const result: PetDesignV1 = { schemaVersion: 1, motionVersion: 1, viewBox, nodes };
  if (new TextEncoder().encode(JSON.stringify(result)).byteLength > PET_DESIGN_LIMITS.bytes) return fail('document size');
  return result;
}

export function canonicalPetDesign(value: unknown): string {
  return JSON.stringify(sortKeys(validatePetDesign(value)));
}

function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (!plain(value)) return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, sortKeys(value[key])]));
}

export async function hashPetDesign(value: unknown): Promise<string> {
  const bytes = new TextEncoder().encode(canonicalPetDesign(value));
  const hash = await globalThis.crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(hash), (byte) => byte.toString(16).padStart(2, '0')).join('');
}
