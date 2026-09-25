// Each case copies the passing fixture, breaks one thing, and asserts that the
// checker reports exactly the criterion that thing belongs to (X1 in
// docs/HARDENING.md: every criterion demonstrated failing on a broken fixture).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { checkPackage, CRITERIA } from '../../scripts/check-hardening.mjs';

const FIXTURE = join(dirname(fileURLToPath(import.meta.url)), 'fixture');

function withFixture(mutate, { update = false } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'molgpu-fixture-'));
  try {
    cpSync(FIXTURE, dir, { recursive: true });
    mutate({
      dir,
      edit: (file, fn) => writeFileSync(join(dir, file), fn(readFileSync(join(dir, file), 'utf8'))),
      write: (file, text) => { mkdirSync(dirname(join(dir, file)), { recursive: true }); writeFileSync(join(dir, file), text); },
      manifest: fn => {
        const path = join(dir, 'package.json');
        const m = JSON.parse(readFileSync(path, 'utf8'));
        fn(m);
        writeFileSync(path, JSON.stringify(m, null, 2));
      },
    });
    if (update) checkPackage(dir, { update: true }); // refresh api.txt so only the target criterion trips
    const { fails } = checkPackage(dir);
    return Object.fromEntries(CRITERIA.map(c => [c, fails[c] ?? []]));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

const failing = fails => CRITERIA.filter(c => fails[c].length);

function expectOnly(criterion, pattern, mutate) {
  const fails = withFixture(mutate, { update: criterion !== 'H5' });
  assert.deepEqual(failing(fails), [criterion], JSON.stringify(fails, null, 2));
  assert.ok(fails[criterion].some(m => pattern.test(m)), fails[criterion].join('\n'));
}

test('the fixture passes every criterion', () => {
  assert.deepEqual(failing(withFixture(() => {})), []);
});

test('H1: private manifest', () =>
  expectOnly('H1', /"private": true/, ({ manifest }) => manifest(m => { m.private = true; })));
test('H1: undeclared import', () =>
  expectOnly('H1', /undeclared import typescript/, ({ edit }) =>
    edit('src/index.mjs', s => `import 'typescript';\n${s}`)));
test('H1: unpinned use.gpu', () =>
  expectOnly('H1', /pinned exactly/, ({ manifest }) => manifest(m => { m.dependencies['@use-gpu/core'] = '^0.20.0'; })));

test('H2: runtime export missing from types', () =>
  expectOnly('H2', /runtime export "extra" is not declared/, ({ edit }) =>
    edit('src/index.mjs', s => `${s}export const extra = 1;\n`)));
test('H2: declared value missing at runtime', () =>
  expectOnly('H2', /declared export "ghost" does not exist/, ({ edit }) => {
    edit('src/index.d.ts', s => `${s}export function ghost(): void;\n`);
    edit('README.md', s => `${s}| \`ghost\` | stable |\n`);
  }));
test('H2: unexplained any', () =>
  expectOnly('H2', /uses `any`/, ({ edit }) =>
    edit('src/index.d.ts', s => s.replace('a: number, b', 'a: any, b'))));

test('H3: use.gpu type in a lower package declaration', () =>
  expectOnly('H3', /references "@use-gpu\/core"/, ({ edit }) =>
    edit('src/index.d.ts', s => `import type { TypedArray } from '@use-gpu/core';\n${s}`)));
test('H3: leak through a relative declaration file', () =>
  expectOnly('H3', /types\.d\.ts references "molstar/, ({ edit, write }) => {
    write('src/types.d.ts', `export type S = import('molstar/lib/mol-model/structure').Structure;\n`);
    edit('src/index.d.ts', s => `export type { S } from './types.js';\n${s}`);
    edit('README.md', s => `${s}| \`S\` | stable |\n`);
  }));

test('H4: Mol* runtime import outside io', () =>
  expectOnly('H4', /only @molgpu\/io may/, ({ edit, manifest }) => {
    manifest(m => { m.peerDependencies = { molstar: '^5.11.0' }; });
    edit('src/internal/core.mjs', s => `${s}export const load = () => import('molstar/lib/mol-io/reader/cif.js');\n`);
  }));
test('H4: use.gpu component layer outside viewer', () =>
  expectOnly('H4', /"@use-gpu\/live"; only @molgpu\/viewer may/, ({ edit, manifest }) => {
    manifest(m => { m.dependencies['@use-gpu/live'] = '0.20.0'; });
    edit('src/internal/core.mjs', s => `import '@use-gpu/live';\n${s}`);
  }));
test('H4: use.gpu core outside src/internal', () =>
  expectOnly('H4', /outside src\/internal/, ({ edit }) =>
    edit('src/index.mjs', s => `import { clamp } from '@use-gpu/core/mjs/ease.mjs';\n${s}`)));

test('H5: stale api.txt', () =>
  expectOnly('H5', /api\.txt is stale/, ({ edit }) =>
    edit('src/index.d.ts', s => s.replace('exact?: boolean', 'exact?: boolean; readonly loose?: boolean'))));
test('H5: export not classified in README', () =>
  expectOnly('H5', /"Options" is not classified/, ({ edit }) =>
    edit('README.md', s => s.replace(/^\| `Options`.*\n/m, ''))));

test('H6: tarball includes non-shipping files', () =>
  expectOnly('H6', /tarball would include test\/x\.test\.mjs/, ({ manifest, write }) => {
    manifest(m => { m.files = ['src', 'test']; });
    write('test/x.test.mjs', '');
  }));
test('H6: packed entry fails to import in isolation', () =>
  expectOnly('H6', /importing "@molgpu\/fixture-good" from the packed tree/, ({ edit }) =>
    edit('src/index.mjs', s => `${s}throw new Error('boom at import');\n`)));
