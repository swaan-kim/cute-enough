import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const sql = readFileSync(
  resolve(process.cwd(), 'supabase/migrations/20260904000300_approved_pet_pool_preflight.sql'),
  'utf8',
);

describe('approved pet pool operational preflight migration', () => {
  it('counts only approved pets backed by active private Storage objects', () => {
    expect(sql).toContain("pet.status = 'approved'");
    expect(sql).toContain('photo.is_active = true');
    expect(sql).toContain("object.bucket_id = 'pet-photos'");
    expect(sql).toContain('object.name = photo.storage_path');
    expect(sql).toContain('count(distinct photo.id)::integer');
  });

  it('is read-only and callable only by the service role', () => {
    expect(sql).toContain('language sql');
    expect(sql).toContain('stable');
    expect(sql).toContain('security invoker');
    expect(sql).toContain('from public, anon, authenticated');
    expect(sql).toContain('to service_role');
    expect(sql).not.toMatch(/\b(insert|update|delete|truncate)\b/i);
  });
});
