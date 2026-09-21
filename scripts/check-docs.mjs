import { readdir, readFile, access } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Check only public documentation. Private campaign material stays local.
export async function checkDocs(root) {
  const files = ['README.md'];
  async function walk(directory) {
    for (const entry of await readdir(path.join(root, directory), { withFileTypes: true })) {
      const relative = `${directory}/${entry.name}`;
      if (relative === 'docs/marketing') continue;
      if (entry.isDirectory()) await walk(relative);
      else if (entry.name.endsWith('.md')) files.push(relative);
    }
  }
  await walk('docs');
  const failures = [];
  for (const file of files) {
    const source = (await readFile(path.join(root, file), 'utf8')).replace(/```[^]*?```/g, '');
    const links = [...source.matchAll(/!?\[[^\]]*\]\(([^)]+)\)|<(?:img|a)\b[^>]*?(?:src|href)="([^"]+)"/g)];
    for (const match of links) {
      const target = (match[1] ?? match[2]).trim().replace(/^<|>$/g, '');
      if (/^(https?:|mailto:|intoss(?:-private)?:|data:|#)/i.test(target)) continue;
      if (/^(?:[a-z]:[\\/]|file:)/i.test(target)) {
        failures.push(`${file}: local-machine link must be repository-relative`);
        continue;
      }
      const localPath = decodeURIComponent(target.split('#')[0]).replace(/:\d+$/, '');
      if (!localPath) continue;
      const resolved = path.resolve(root, path.dirname(file), localPath);
      const relative = path.relative(root, resolved).replaceAll('\\', '/');
      if (relative.startsWith('../') || path.isAbsolute(relative)) {
        failures.push(`${file}: link leaves repository (${localPath})`);
        continue;
      }
      if (/^(docs\/marketing|src\/review\/designs|AIT|\.tmp)(\/|$)/.test(relative)) {
        failures.push(`${file}: link targets private local material (${localPath})`);
        continue;
      }
      try { await access(resolved); }
      catch { failures.push(`${file}: missing ${localPath}`); }
    }
  }
  return { checked: files.length, failures };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const result = await checkDocs(fileURLToPath(new URL('..', import.meta.url)));
  for (const failure of result.failures) console.error(failure);
  console.log(`Documentation: ${result.checked} files, ${result.failures.length} broken/private links.`);
  if (result.failures.length) process.exitCode = 1;
}
