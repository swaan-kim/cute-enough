import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const sql = readFileSync(
  'supabase/migrations/20260828000500_revisit_windows.sql',
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
});
