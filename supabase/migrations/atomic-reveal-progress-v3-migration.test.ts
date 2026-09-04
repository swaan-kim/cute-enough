import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const sql = readFileSync(
  'supabase/migrations/20260904000200_atomic_reveal_progress_v3.sql',
  'utf8',
);

describe('atomic v2 reveal and fixed-house progress migration', () => {
  it('keeps the legacy RPC and adds a service-role-only v3 wrapper', () => {
    expect(sql).toContain('function public.record_pet_reveal_v3');
    expect(sql).toContain('public.record_pet_reveal_v2(');
    expect(sql).toContain('revoke all on function public.record_pet_reveal_v3');
    expect(sql).toContain('to service_role');
    expect(sql).not.toContain('create or replace function public.record_pet_reveal_v2');
  });

  it('uses a deadlock-safe lock order and records reveal plus progress atomically', () => {
    const revealLock = sql.indexOf("hashtextextended('pet-reveal:'");
    const houseLock = sql.indexOf("'daily-house-v2:' || p_owner_hash");
    const freeAllowance = sql.indexOf('get_pet_free_allowance(p_owner_hash)');
    const recordReveal = sql.indexOf('v_revisit_until := public.record_pet_reveal_v2');
    const markProgress = sql.indexOf('v_daily_progress := public.mark_daily_house_pet_met');

    expect(revealLock).toBeGreaterThan(-1);
    expect(houseLock).toBeGreaterThan(revealLock);
    expect(freeAllowance).toBeGreaterThan(houseLock);
    expect(recordReveal).toBeGreaterThan(freeAllowance);
    expect(markProgress).toBeGreaterThan(recordReveal);
  });

  it('allows rewarded unlocks only while the authoritative free bucket is empty', () => {
    expect(sql).toContain("p_unlock_method = 'REWARDED' and v_free_remaining > 0");
    expect(sql).toContain("raise exception 'FREE_ALLOWANCE_AVAILABLE'");
  });

  it('returns the recorded revisit boundary and progress from the same transaction', () => {
    expect(sql).toContain("'revisitUntil', v_revisit_until");
    expect(sql).toContain("'dailyProgress', v_daily_progress");
  });
});
