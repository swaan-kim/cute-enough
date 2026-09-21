import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { checkDocs } from './check-docs.mjs';

async function fixture(run) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'cute-docs-'));
  try {
    await mkdir(path.join(root, 'docs/marketing'), { recursive: true });
    await writeFile(path.join(root, 'docs/guide.md'), '# Guide\n');
    await writeFile(path.join(root, 'docs/marketing/private.md'), '[not scanned](missing.png)');
    await run(root);
  } finally { await rm(root, { recursive: true, force: true }); }
}

test('public links, image sources, fragments and fenced examples are checked correctly', async () => {
  await fixture(async root => {
    await writeFile(path.join(root, 'README.md'), '[guide](docs/guide.md#test) <img src="docs/guide.md"> [web](https://example.invalid)\n```md\n[example](missing.md)\n```');
    assert.deepEqual(await checkDocs(root), { checked: 2, failures: [] });
  });
});

test('missing links and machine/private paths fail without reading private files', async () => {
  await fixture(async root => {
    await writeFile(path.join(root, 'README.md'), '[missing](docs/missing.md) [local](C:/private/photo.png) [campaign](docs/marketing/private.md) [escape](../outside.md)');
    const result = await checkDocs(root);
    assert.equal(result.failures.length, 4);
    assert.equal(result.checked, 2);
  });
});
