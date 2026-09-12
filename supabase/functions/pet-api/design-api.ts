import type { SupabaseClient } from 'npm:@supabase/supabase-js@2.57.4';
import { ApiError } from '../_shared/api-error.ts';
import { withPublishedDesign } from '../_shared/published-design.ts';

/** Character refresh does not grant photo access or change allowance/album ownership. */
export async function refreshDesign(client: SupabaseClient, petId: string) {
  const { data: pet, error } = await client.from('pets').select('id,status,design_version')
    .eq('id', petId).eq('status', 'approved').maybeSingle();
  if (error) throw new ApiError('PET_DESIGN_UNAVAILABLE', 503, '캐릭터를 다시 불러오지 못했어요.');
  if (!pet) throw new ApiError('PET_NOT_AVAILABLE', 404, '이 친구는 지금 만날 수 없어요.');
  return withPublishedDesign(client, { pet: { id: pet.id, designVersion: pet.design_version ?? 1 } });
}
