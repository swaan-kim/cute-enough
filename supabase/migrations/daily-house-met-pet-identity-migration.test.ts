import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const sql = readFileSync(
  'supabase/migrations/20260904000400_daily_house_met_pet_identity.sql',
  'utf8',
);

describe('daily house met pet identity migration', () => {
  it('backfills the identity of the pet that actually earned each slot', () => {
    expect(sql).toContain('add column if not exists met_pet_id uuid');
    expect(sql).toContain('set met_pet_id = pet_id');
    expect(sql).toContain('where met_at is not null');
    expect(sql).not.toContain('met_pet_id uuid references');
  });

  it('preserves progress without marking a replacement pet as met', () => {
    expect(sql).toContain('when assignment.met_pet_id = assignment.pet_id then assignment.met_at');
    expect(sql).toContain('jsonb_agg(assignment.met_pet_id order by assignment.slot)');
    expect(sql).toContain("count(*) filter (where assignment.met_at is not null)");
  });

  it('records met_pet_id only when the slot is first met', () => {
    expect(sql).toContain('set met_pet_id = case');
    expect(sql).toContain('when assignment.met_at is null then p_pet_id');
    expect(sql).toContain('else assignment.met_pet_id');
    expect(sql).toContain('met_at = coalesce(assignment.met_at, clock_timestamp())');
  });
});
