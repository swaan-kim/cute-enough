import { validatePetDesign, type PetDesignV1, type SvgDesignNode } from '../../supabase/functions/_shared/pet-design';
import { buildPetDesign, type BuildPetDesignInput } from './buildPetDesign';

/** Private authoring data. Public responses contain document only. */
export interface PetDesignEditorState {
  schemaVersion: 1;
  input: BuildPetDesignInput;
  baseDocument: PetDesignV1;
  document: PetDesignV1;
}

const copy = <T,>(value: T): T => JSON.parse(JSON.stringify(value)) as T;
const same = (left: unknown, right: unknown) => JSON.stringify(left) === JSON.stringify(right);

export function createDesignEditor(input: BuildPetDesignInput, document?: PetDesignV1): PetDesignEditorState {
  const baseDocument = buildPetDesign(input);
  return { schemaVersion: 1, input: copy(input), baseDocument, document: document ? validatePetDesign(document) : copy(baseDocument) };
}

/** Restoring uses the saved tree and baseline, never the newest compiler output. */
export function restoreDesignEditor(value: PetDesignEditorState): PetDesignEditorState {
  if (value.schemaVersion !== 1 || !value.input || typeof value.input !== 'object') throw new Error('INVALID_DESIGN_EDITOR');
  return { schemaVersion: 1, input: copy(value.input), baseDocument: validatePetDesign(value.baseDocument), document: validatePetDesign(value.document) };
}

function keyed(nodes: SvgDesignNode[]): { key: string; node: SvgDesignNode }[] {
  const counts = new Map<string, number>();
  return nodes.map((node) => {
    const attrs = node.attrs ?? {};
    const marker = ['data-head-fill', 'data-head-outline', 'data-head-markings', 'data-ear-shape', 'data-cookie-ear-inner', 'data-seolgi-bow-tie', 'data-brow-style', 'data-tongue-shape'].find((name) => Object.hasOwn(attrs, name));
    const identity = attrs['data-design-part'] ?? (node.motion ? `motion:${node.motion}` : undefined)
      ?? (attrs['data-pet-signature'] ? `signature:${attrs['data-pet-signature']}` : undefined)
      ?? (attrs['data-pet-accessory'] ? 'accessory' : undefined)
      ?? (attrs['data-ear-part'] ? `ear:${attrs['data-ear-part']}` : undefined) ?? marker ?? attrs.id ?? node.tag;
    const ordinal = counts.get(String(identity)) ?? 0;
    counts.set(String(identity), ordinal + 1);
    return { key: `${identity}:${ordinal}`, node };
  });
}

function mergeNode(base: SvgDesignNode, edited: SvgDesignNode, next: SvgDesignNode): SvgDesignNode {
  if (same(base, edited)) return copy(next);
  if (same(base, next) || edited.tag !== base.tag || next.tag !== base.tag) return copy(edited);
  const result: SvgDesignNode = { tag: edited.tag };
  const attrs: NonNullable<SvgDesignNode['attrs']> = {};
  for (const key of new Set([...Object.keys(base.attrs ?? {}), ...Object.keys(edited.attrs ?? {}), ...Object.keys(next.attrs ?? {})])) {
    const previous = base.attrs?.[key];
    const custom = edited.attrs?.[key];
    const value = same(previous, custom) ? next.attrs?.[key] : custom;
    if (value !== undefined) attrs[key] = value;
  }
  if (Object.keys(attrs).length) result.attrs = attrs;
  const motion = edited.motion === base.motion ? next.motion : edited.motion;
  if (motion) result.motion = motion;
  if (base.children || edited.children || next.children) result.children = mergeNodes(base.children ?? [], edited.children ?? [], next.children ?? []);
  return result;
}

/** Three-way merge: changed author geometry wins; unchanged parts follow the new settings. */
function mergeNodes(base: SvgDesignNode[], edited: SvgDesignNode[], next: SvgDesignNode[]): SvgDesignNode[] {
  if (same(base, edited)) return copy(next);
  const baseNodes = new Map(keyed(base).map(({ key, node }) => [key, node]));
  const editedEntries = keyed(edited);
  const editedNodes = new Map(editedEntries.map(({ key, node }) => [key, node]));
  const nextEntries = keyed(next);
  const nextNodes = new Map(nextEntries.map(({ key, node }) => [key, node]));
  const additions = new Map<string, SvgDesignNode[]>();
  const end = '__end__';
  // Preserve custom additions at their preceding layer boundary instead of moving them to the front.
  editedEntries.forEach(({ key, node }, index) => {
    if (nextNodes.has(key) || (baseNodes.has(key) && same(baseNodes.get(key), node))) return;
    const nextAnchor = editedEntries.slice(index + 1).find((entry) => nextNodes.has(entry.key));
    const anchor = nextAnchor?.key ?? end;
    additions.set(anchor, [...(additions.get(anchor) ?? []), copy(node)]);
  });
  const result: SvgDesignNode[] = [];
  for (const { key, node } of nextEntries) {
    result.push(...(additions.get(key) ?? []));
    const previous = baseNodes.get(key);
    const custom = editedNodes.get(key);
    if (previous && !custom) continue; // An explicitly deleted custom part stays deleted.
    result.push(previous && custom ? mergeNode(previous, custom, node) : copy(custom ?? node));
  }
  result.push(...(additions.get(end) ?? []));
  const originalOrder = keyed(base).filter(({ key }) => editedNodes.has(key) && nextNodes.has(key)).map(({ key }) => key);
  const editedOrder = editedEntries.filter(({ key }) => baseNodes.has(key) && nextNodes.has(key)).map(({ key }) => key);
  if (!same(originalOrder, editedOrder)) {
    // An author can intentionally reorder overlapping parts. Keep that order even after a color edit.
    const ranks = new Map(editedEntries.map(({ key }, index) => [key, index]));
    const entries = keyed(result);
    const reordered = entries.filter(({ key }) => ranks.has(key)).sort((left, right) => ranks.get(left.key)! - ranks.get(right.key)!);
    let position = 0;
    return entries.map(({ key, node }) => ranks.has(key) ? reordered[position++].node : node);
  }
  return result;
}

export function updateDesignEditor(state: PetDesignEditorState, patch: Partial<BuildPetDesignInput>): PetDesignEditorState {
  const previous = restoreDesignEditor(state);
  const input = copy({ ...previous.input, ...patch });
  const baseDocument = buildPetDesign(input);
  const document = validatePetDesign({
    ...baseDocument,
    viewBox: same(previous.document.viewBox, previous.baseDocument.viewBox) ? baseDocument.viewBox : previous.document.viewBox,
    nodes: mergeNodes(previous.baseDocument.nodes, previous.document.nodes, baseDocument.nodes),
  });
  return { schemaVersion: 1, input, baseDocument, document };
}
