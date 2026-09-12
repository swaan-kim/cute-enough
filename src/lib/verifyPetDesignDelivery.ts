import { hashPetDesign, validatePetDesign } from '../../supabase/functions/_shared/pet-design';

type RecordValue = Record<string, unknown>;
const record = (value: unknown): value is RecordValue => !!value && typeof value === 'object' && !Array.isArray(value);

/** Verify at the network boundary, before documents enter any screen or memory cache. */
export async function verifyPetDesignDelivery<T>(payload: T): Promise<T> {
  if (!record(payload)) return payload;
  const checked = new Map<object, Promise<unknown>>();
  const verify = (pet: unknown): Promise<unknown> => {
    if (!record(pet)) return Promise.resolve(pet);
    const existing = checked.get(pet);
    if (existing) return existing;
    const task = (async () => {
      const { publishedDesign: raw, ...summary } = pet;
      if (['pending', 'rejected', 'paused', 'deleted'].includes(String(pet.approvalStatus))) {
        return { ...summary, publishedDesign: undefined };
      }
      if (!raw) return pet;
      try {
        if (!record(raw) || typeof raw.id !== 'string' || !raw.id
          || !Number.isSafeInteger(raw.designVersion) || Number(raw.designVersion) < 1
          || (pet.designVersion !== undefined && pet.designVersion !== raw.designVersion)
          || pet.designStatus === 'missing' || pet.designStatus === 'unavailable'
          || typeof raw.sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(raw.sha256)) throw new Error('DESIGN_IDENTITY');
        const document = validatePetDesign(raw.document);
        if (await hashPetDesign(document) !== raw.sha256) throw new Error('DESIGN_HASH_MISMATCH');
        // Do not carry any unrecognized/private editor fields out of the API response.
        return { ...summary, designStatus: 'ready', designVersion: raw.designVersion,
          publishedDesign: { id: raw.id, designVersion: raw.designVersion, sha256: raw.sha256, document } };
      } catch {
        // A corrupt character must not discard a successful photo/ticket/upload response.
        return { ...summary, publishedDesign: undefined, designStatus: 'unavailable' };
      }
    })();
    checked.set(pet, task);
    return task;
  };
  const output: RecordValue = { ...payload };
  for (const key of ['pet', 'ownerBonusPet']) if (output[key]) output[key] = await verify(output[key]);
  for (const key of ['pets', 'dailyPets']) if (Array.isArray(output[key])) output[key] = await Promise.all(output[key].map(verify));
  if (output.found === true && record(output.result)) output.result = await verifyPetDesignDelivery(output.result);
  return output as T;
}
