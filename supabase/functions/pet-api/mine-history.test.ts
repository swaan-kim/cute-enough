import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const source = readFileSync(resolve(process.cwd(), 'supabase/functions/pet-api/index.ts'), 'utf8');
const mineBlock = source.split("if (action === 'mine')")[1]?.split("if (action === 'ownerPhoto')")[0] ?? '';

describe('owner submission history', () => {
  it('does not hide soft-deleted or older submissions from the owner list', () => {
    expect(mineBlock).toContain(".eq('owner_hash', ownerHash)");
    expect(mineBlock).not.toContain(".neq('status', 'deleted')");
    expect(mineBlock).not.toContain('.limit(50)');
  });
});
