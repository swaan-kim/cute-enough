import { useEffect, useMemo, useSyncExternalStore } from 'react';
import { validatePetDesign } from '../../supabase/functions/_shared/pet-design';
import type { PetDesignDelivery, PetSummary, PublishedPetDesign } from '../types';

type Delivery = PetDesignDelivery & { id?: string; designVersion?: number; approvalStatus?: PetSummary['approvalStatus'] };
export type DesignSnapshot = Delivery & { status: 'loading' | 'ready' | 'error'; attempt: number };
type Loader = (id: string) => Promise<Delivery>;
const fetchDesign: Loader = async (id) => (await import('./api')).fetchPetDesign(id);

/** Only unpublished submissions are allowed to compile a traits preview. */
export function usesPublishedDesign(pet?: PetSummary): boolean {
  return Boolean(pet && (pet.publishedDesign || !['pending', 'rejected'].includes(pet.approvalStatus ?? 'approved')));
}

function checkedDesign(delivery: Delivery): PublishedPetDesign | undefined {
  const design = delivery.publishedDesign;
  if (delivery.approvalStatus && delivery.approvalStatus !== 'approved') return undefined;
  if (!design || delivery.designStatus === 'missing' || delivery.designStatus === 'unavailable') return undefined;
  if (typeof design.id !== 'string' || !design.id || !/^[a-f0-9]{64}$/.test(design.sha256)
    || !Number.isSafeInteger(design.designVersion) || design.designVersion < 1
    || (delivery.designVersion !== undefined && delivery.designVersion !== design.designVersion)) return undefined;
  try { return { ...design, document: validatePetDesign(design.document) }; } catch { return undefined; }
}

/** Shared memory-only document cache. Retrying never grants a photo or spends a ticket. */
export function createPetDesignResource(pet: PetSummary, load: Loader = fetchDesign) {
  const initial = checkedDesign(pet);
  let snapshot: DesignSnapshot = { publishedDesign: initial, designVersion: pet.designVersion ?? initial?.designVersion,
    designStatus: initial ? 'ready' : pet.designStatus ?? 'missing', status: initial ? 'ready' : 'error', attempt: 0 };
  let pending: Promise<void> | undefined;
  let lastRefresh = Number.NEGATIVE_INFINITY;
  let lastSeed = pet;
  const listeners = new Set<() => void>();
  const publish = (next: DesignSnapshot) => { snapshot = next; listeners.forEach((notify) => notify()); };
  const resource = {
    getSnapshot: () => snapshot,
    subscribe: (notify: () => void) => { listeners.add(notify); return () => { listeners.delete(notify); }; },
    inUse: () => listeners.size > 0,
    seed(next: PetSummary) {
      const version = next.designVersion ?? next.publishedDesign?.designVersion ?? 1;
      if (version < (snapshot.designVersion ?? 1)) return;
      // A successful design-only retry may outlive its original parent summary.
      // Only ignore that unchanged seed, not a fresh loss/retraction of published geometry.
      if (next.publishedDesign === lastSeed.publishedDesign && next.designVersion === lastSeed.designVersion
        && next.designStatus === lastSeed.designStatus && next.approvalStatus === lastSeed.approvalStatus) return;
      lastSeed = next;
      const design = checkedDesign(next);
      if (version === snapshot.designVersion && design?.sha256 === snapshot.publishedDesign?.sha256
        && (design ? 'ready' : 'error') === snapshot.status) return;
      publish({ designVersion: version, publishedDesign: design, designStatus: design ? 'ready' : next.designStatus ?? 'missing',
        status: design ? 'ready' : 'error', attempt: snapshot.attempt + 1 });
    },
    retry(): Promise<void> {
      if (pending) return pending;
      const previous = snapshot;
      const attempt = snapshot.attempt + 1;
      lastRefresh = Date.now();
      publish({ ...snapshot, publishedDesign: undefined, status: 'loading', attempt });
      pending = (async () => {
        try {
          const next = await load(pet.id);
          const design = checkedDesign(next);
          if (!design || (next.id && next.id !== pet.id) || design.designVersion < (previous.designVersion ?? 1)) throw new Error('DESIGN_UNAVAILABLE');
          if (snapshot.attempt !== attempt) return;
          publish({ ...next, publishedDesign: design, designVersion: design.designVersion, designStatus: 'ready', status: 'ready', attempt });
        } catch {
          if (snapshot.attempt === attempt) publish({ ...previous, publishedDesign: undefined, status: 'error', attempt });
        }
      })().finally(() => { pending = undefined; });
      return pending;
    },
    resume() {
      if (document.hidden || snapshot.status !== 'error' || Date.now() - lastRefresh < 5000) return;
      void resource.retry();
    },
  };
  return resource;
}

type Resource = ReturnType<typeof createPetDesignResource>;
const resources = new Map<string, Resource>();
const empty: DesignSnapshot = { status: 'ready', attempt: 0 };
const emptySnapshot = () => empty;
const emptySubscribe = () => () => {};

export function usePetDesign(pet?: PetSummary) {
  const key = usesPublishedDesign(pet) ? `${pet!.id}:${pet!.designVersion ?? pet!.publishedDesign?.designVersion ?? 1}` : '';
  const resource = useMemo(() => {
    if (!key || !pet) return undefined;
    let value = resources.get(key);
    if (!value) { value = createPetDesignResource(pet); resources.set(key, value); }
    if (resources.size > 128) {
      for (const [oldKey, old] of resources) {
        if (oldKey !== key && !old.inUse()) resources.delete(oldKey);
        if (resources.size <= 128) break;
      }
    }
    return value;
  }, [key]);
  const snapshot = useSyncExternalStore(resource?.subscribe ?? emptySubscribe, resource?.getSnapshot ?? emptySnapshot);
  useEffect(() => { if (pet) resource?.seed(pet); }, [resource, pet?.publishedDesign, pet?.designStatus, pet?.designVersion, pet?.approvalStatus]);
  useEffect(() => {
    if (!resource) return;
    const resume = () => resource.resume();
    window.addEventListener('focus', resume);
    window.addEventListener('pageshow', resume);
    window.addEventListener('online', resume);
    document.addEventListener('visibilitychange', resume);
    return () => {
      window.removeEventListener('focus', resume);
      window.removeEventListener('pageshow', resume);
      window.removeEventListener('online', resume);
      document.removeEventListener('visibilitychange', resume);
    };
  }, [resource]);
  return resource ? { resource, snapshot } : undefined;
}
