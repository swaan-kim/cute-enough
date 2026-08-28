import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const sql = readFileSync(
  'supabase/migrations/20260828000400_fix_free_allowance_timestamp.sql',
  'utf8',
);

describe('three-hour allowance timestamp hotfix', () => {
  it('uses an unambiguous timestamptz variable in both allowance functions', () => {
    expect(sql).not.toMatch(/\bcurrent_time\s+timestamptz/i);
    expect(sql.match(/\bv_now\s+timestamptz\s*:=\s*clock_timestamp\(\)/g)).toHaveLength(2);
    expect(sql).toContain('v_now - refill_anchor');
    expect(sql).toContain('set used_at = v_now');
  });
});
