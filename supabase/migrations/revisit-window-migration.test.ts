import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const sql = readFileSync(
  'supabase/migrations/20260828000500_revisit_windows.sql',
  'utf8',
);
const alignedBoundarySql = readFileSync(
  'supabase/migrations/20260828000700_align_all_revisit_boundaries.sql',
  'utf8',
);

describe('revisit window migration', () => {
  it('expires revisits on a timestamp and permits a new same-day visit afterward', () => {
    expect(sql).toContain('revisit_until timestamptz');
    expect(sql).toContain("drop index if exists public.reveals_one_pet_per_day_idx");
    expect(sql).toContain('reveal.revisit_until > v_now');
    expect(sql).toContain("v_revisit_until := refill_anchor + interval '3 hours'");
    expect(sql).toContain('returns timestamptz');
  });

  it('aligns every unlock method to the next free recharge with a full-bucket fallback', () => {
    expect(alignedBoundarySql).toContain("hashtextextended('pet-free:' || p_owner_hash, 0)");
    expect(alignedBoundarySql).toContain("when current_balance < 2 then refill_anchor + interval '3 hours'");
    expect(alignedBoundarySql).toContain("else v_now + interval '3 hours'");
    expect(alignedBoundarySql.indexOf("if p_unlock_method = 'UPLOAD'")).toBeLessThan(
      alignedBoundarySql.indexOf('v_revisit_until := case'),
    );
    expect(alignedBoundarySql.indexOf("elsif p_unlock_method = 'REWARDED'")).toBeLessThan(
      alignedBoundarySql.indexOf('v_revisit_until := case'),
    );
    expect(alignedBoundarySql).toContain('returns timestamptz');
  });
});
