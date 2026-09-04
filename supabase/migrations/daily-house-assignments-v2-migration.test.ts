import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const sql = readFileSync(
  'supabase/migrations/20260904000100_daily_house_assignments_v2.sql',
  'utf8',
);

describe('fixed daily house v2 migration', () => {
  it('stores exactly five stable viewer/date slots without client access', () => {
    expect(sql).toContain('create table if not exists public.daily_house_assignments');
    expect(sql).toContain('slot smallint not null check (slot between 1 and 5)');
    expect(sql).toContain('met_pet_id uuid');
    expect(sql).toContain('primary key (owner_hash, assignment_date, slot)');
    expect(sql).toContain('generate_series(1, 5)');
    expect(sql).toContain('alter table public.daily_house_assignments enable row level security');
    expect(sql).toContain('revoke all on table public.daily_house_assignments from public, anon, authenticated');
  });

  it('creates once, prioritizes active revisits, and repairs only vacated slots', () => {
    expect(sql).toContain("hashtextextended('daily-house-v2:' || p_owner_hash");
    expect(sql).toContain('and (v_created or assignment.replacement_pending or assignment.was_assigned)');
    expect(sql).toContain('and reveal.revisit_until > v_now');
    expect(sql).toContain("md5('daily-house-v2:' || p_owner_hash");
    expect(sql).toContain('select pet.id into v_owner_bonus_pet_id');
    expect(sql).toContain('pet.id <> v_owner_bonus_pet_id');
    expect(sql).not.toContain('pet.owner_hash <> p_owner_hash');
    expect(sql).toContain("pet.status = 'approved'");
    expect(sql).toContain("coalesce(pet.reviewed_at, pet.created_at) < v_day_start");
  });

  it('keeps the latest owner pet separate and derives progress from fixed slots', () => {
    expect(sql).toContain("'dailyPets', v_daily_pets");
    expect(sql).toContain("'ownerBonusPet', v_owner_bonus_pet");
    expect(sql).toContain("pet.status in ('pending', 'approved')");
    expect(sql).toContain("'metPetIds', v_met_pet_ids");
    expect(sql).toContain('jsonb_agg(assignment.met_pet_id order by assignment.slot)');
    expect(sql).toContain('when assignment.met_pet_id = assignment.pet_id then assignment.met_at');
    expect(sql).toContain("'totalCount', 5");
    expect(sql).toContain("'completed', v_met_count = 5");
  });

  it('marks progress through a service-role-only RPC after ensuring assignments exist', () => {
    expect(sql).toContain('function public.mark_daily_house_pet_met');
    expect(sql).toContain('if not exists (');
    expect(sql).toContain('from public.get_pet_house_snapshot_v2(p_owner_hash, p_date)');
    expect(sql).toContain('when assignment.met_at is null then p_pet_id');
    expect(sql).toContain('met_at = coalesce(assignment.met_at, clock_timestamp())');
    expect(sql).toContain('grant execute on function public.mark_daily_house_pet_met(text,date,uuid)');
  });

  it('protects owner-selected accessories for old and new review clients', () => {
    expect(sql).toContain('trigger enforce_owner_accessory_immutability_on_pets');
    expect(sql).toContain("raise exception 'OWNER_ACCESSORY_IMMUTABLE'");
    expect(sql).toContain('function public.review_pet_submission_v5');
    expect(sql).toContain('final_accessory := current_pet.requested_accessory');
    expect(sql).toContain('review_pet_submission_v4(');
    expect(sql).toContain('to service_role');
  });
});
