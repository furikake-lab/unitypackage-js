import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const packageJson = createRequire(import.meta.url)('../package.json');
const publicEntries = [
  packageJson.main,
  packageJson.module,
  packageJson.types,
  packageJson.exports['.'].require,
  packageJson.exports['.'].import,
  packageJson.exports['.'].types,
].map((entry) => entry.replace(/^\.\//, ''));

const packResult = JSON.parse(
  // npm 10 may run `prepare` despite `--ignore-scripts`; keep its output out of JSON.
  execFileSync(
    'npm',
    [
      'pack',
      '--dry-run',
      '--json',
      '--ignore-scripts',
      '--foreground-scripts=false',
    ],
    {
      cwd: root,
      encoding: 'utf8',
    },
  ),
)[0];
const packedFiles = new Set(packResult.files.map(({ path: file }) => file));

for (const entry of publicEntries) {
  assert(packedFiles.has(entry), `${entry} is missing from the npm package`);
}
assert(
  !packResult.files.some(({ path: file }) => /^(src|examples)\//.test(file)),
  'source or example files are included in the npm package',
);

const require = createRequire(path.join(root, 'package.json'));
require(root);
await import(pathToFileURL(path.join(root, packageJson.module)).href);

const temporaryDirectory = await mkdtemp(
  path.join(tmpdir(), 'unitypackage-js-package-'),
);
try {
  const consumer = path.join(temporaryDirectory, 'consumer.ts');
  await writeFile(
    consumer,
    `import * as unityPackage from ${JSON.stringify(root)};\nvoid unityPackage;\n`,
  );
  execFileSync(
    path.join(root, 'node_modules', '.bin', 'tsc'),
    [
      '--noEmit',
      '--strict',
      '--skipLibCheck',
      '--target',
      'ES2020',
      '--module',
      'Node16',
      '--moduleResolution',
      'Node16',
      consumer,
    ],
    { cwd: temporaryDirectory, stdio: 'inherit' },
  );
} finally {
  await rm(temporaryDirectory, { recursive: true, force: true });
}

process.stdout.write('npm package entries verified successfully\n');
