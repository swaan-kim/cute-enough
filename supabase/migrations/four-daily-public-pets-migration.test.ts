import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const sql = readFileSync(
  'supabase/migrations/20260905000200_four_daily_public_pets.sql',
  'utf8',
);

describe('four daily public pets migration', () => {
  it('removes only the obsolete fifth assignment slot and preserves pet records', () => {
    expect(sql).toContain('delete from public.daily_house_assignments');
    expect(sql).toContain('where slot = 5');
    expect(sql).toContain('check (slot between 1 and 4)');
    expect(sql).not.toMatch(/delete\s+from\s+public\.(pets|pet_photos|pet_review_audit)/i);
  });

  it('creates four stable public slots for each viewer and date', () => {
    expect(sql).toContain('generate_series(1, 4)');
    expect(sql).not.toContain('generate_series(1, 5)');
  });

  it('excludes every owned upload from public selection and stale-slot validation', () => {
    expect(sql.match(/and pet\.owner_hash <> p_owner_hash/g)).toHaveLength(2);
    expect(sql).not.toContain('v_owner_bonus_pet_id is null or pet.id <> v_owner_bonus_pet_id');
    expect(sql).toContain('where pet.owner_hash = p_owner_hash');
  });

  it('returns and records progress on a four-friend scale', () => {
    expect(sql.match(/'totalCount', 4/g)).toHaveLength(2);
    expect(sql.match(/'completed', v_met_count >= 4/g)).toHaveLength(2);
  });
});
