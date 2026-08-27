import { readdir, readFile } from 'node:fs/promises';
import { extname, join, relative } from 'node:path';

const BUILD_DIR = 'dist';
const TEXT_EXTENSIONS = new Set(['.css', '.html', '.js', '.json', '.map', '.mjs']);
const DEVTOOLS_SENTINELS = [
  '@apps-in-toss/devtools',
  '__AIT_DEVTOOLS_MCP_ENABLED__',
  '__ait_locale',
  '__ait_viewport',
  '__ait_storage:',
  'ait-co-devtools',
];

async function listFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await listFiles(path)));
    } else if (entry.isFile() && TEXT_EXTENSIONS.has(extname(entry.name))) {
      files.push(path);
    }
  }

  return files;
}

const matches = [];

for (const file of await listFiles(BUILD_DIR)) {
  const contents = await readFile(file, 'utf8');
  for (const sentinel of DEVTOOLS_SENTINELS) {
    if (contents.includes(sentinel)) {
      matches.push(`${relative(BUILD_DIR, file)}: ${sentinel}`);
    }
  }
}

if (matches.length > 0) {
  console.error('AIT 로컬 개발 도구가 제출용 웹 번들에서 발견됐습니다.');
  console.error(matches.join('\n'));
  process.exit(1);
}

console.log('AIT 로컬 개발 도구 미포함 확인 완료');
