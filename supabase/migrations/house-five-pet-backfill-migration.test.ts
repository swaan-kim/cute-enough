import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const sql = readFileSync(
  'supabase/migrations/20260903000100_house_five_pet_backfill.sql',
  'utf8',
);

describe('five-pet house backfill migration', () => {
  it('keeps stable approvals separate from same-day fallback candidates', () => {
    expect(sql).toContain("coalesce(pet.reviewed_at,pet.created_at)<v_day_start");
    expect(sql).toContain("coalesce(pet.reviewed_at,pet.created_at)>=v_day_start");
    expect(sql).toContain("'sameDayApprovedPets',v_same_day_approved_pets");
  });

  it('tracks owner photo views without exposing the table to clients', () => {
    expect(sql).toContain('create table if not exists public.daily_pet_views');
    expect(sql).toContain('alter table public.daily_pet_views enable row level security');
    expect(sql).toContain('revoke all on table public.daily_pet_views from public, anon, authenticated');
    expect(sql).toContain("'todayMetPetIds',v_today_met_pet_ids");
  });
});
