// Guards against a stale committed bundle: the file in wallpaper/ must match
// what the sources produce right now (PLAN.md §4.5).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import { buildBundle } from '../tools/build-bundle.mjs';
import { ROOT } from './helpers.mjs';

test('wallpaper/bundle.js is up to date with the ESM sources', () => {
  const file = path.join(ROOT, 'wallpaper/bundle.js');
  assert.ok(fs.existsSync(file), 'wallpaper/bundle.js is missing — run npm run build:bundle');
  const { content, hash, modules } = buildBundle();
  const onDisk = fs.readFileSync(file, 'utf8');
  assert.ok(modules.length >= 8, `only ${modules.length} modules bundled`);
  assert.equal(onDisk, content, 'bundle is stale — run npm run build:bundle');
  assert.ok(onDisk.includes(hash), 'content hash missing from the committed bundle');
});

test('the bundle is a classic script (no ESM, no network access)', () => {
  const onDisk = fs.readFileSync(path.join(ROOT, 'wallpaper/bundle.js'), 'utf8');
  assert.ok(!/^\s*(import|export)\s/m.test(onDisk), 'bundle must not contain ESM statements');
  for (const forbidden of ['fetch(', 'XMLHttpRequest', 'new Worker', 'importScripts']) {
    assert.ok(!onDisk.includes(forbidden), `bundle must not use ${forbidden}`);
  }
});

test('index.html loads only the bundle and declares no external resources', () => {
  const html = fs.readFileSync(path.join(ROOT, 'wallpaper/index.html'), 'utf8');
  assert.ok(html.includes('<script src="bundle.js"></script>'));
  const externals = html.match(/https?:\/\/[^\s"']+/g) || [];
  assert.deepEqual(externals.filter((u) => !u.includes('mobiusdigitalgames.com')), [], 'no remote resources');
});

// Execution-level guard on the bundler itself: every ESM import form the
// wallpaper uses must bind the same value the specifier means in real ESM.
// (A default import rewritten as a namespace import silently yields an object
// whose fields are undefined — exactly the `data/bodies.js` shape — so assert
// on observed values, not on generated text.)
test('bundler preserves default / named / namespace import semantics', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ow-bundle-'));
  try {
    fs.mkdirSync(path.join(dir, 'js'));
    fs.writeFileSync(path.join(dir, 'js', 'data.js'), [
      'export const table = { cycleS: 1360 };',
      'export function double(x) { return x * 2; }',
      'export default { bodies: [1, 2, 3] };',
    ].join('\n'));
    fs.writeFileSync(path.join(dir, 'js', 'entry.js'), [
      "import doc from './data.js';",                       // bare default import
      "import def2, { table, double } from './data.js';",   // default + named
      "import * as ns from './data.js';",                   // namespace
      'export function start() {',
      '  globalThis.__seen = JSON.stringify({',
      '    hasBodies: Array.isArray(doc.bodies),',
      '    def2IsDoc: def2 === doc,',
      '    cycleS: table.cycleS,',
      '    doubled: double(21),',
      '    nsKeys: Object.keys(ns).sort().join(","),',
      '  });',
      '}',
    ].join('\n'));

    const { content } = buildBundle({ dir, entry: 'js/entry.js' });
    const sandbox = {};
    vm.createContext(sandbox);
    vm.runInContext(content, sandbox);
    assert.deepEqual(JSON.parse(sandbox.__seen), {
      hasBodies: true, def2IsDoc: true, cycleS: 1360, doubled: 42,
      nsKeys: 'default,double,table',
    });
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
