// Bundles the ESM sources in wallpaper/js/** (plus the generated data modules)
// into ONE classic script: wallpaper/bundle.js.
//
// Why: Wallpaper Engine loads a web wallpaper from a plain folder. ES modules and
// fetch() both depend on how CEF is launched (file:// module CORS), so a single
// classic script removes that whole failure class — and it keeps the runtime
// network-free (PLAN.md §1.2).
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const WP = path.join(ROOT, 'wallpaper');
export const ENTRY = 'js/main.js';

const idOf = (rel) => rel.replace(/\\/g, '/').replace(/\.js$/, '');
const resolveSpec = (fromRel, spec) => idOf(path.normalize(path.join(path.dirname(fromRel), spec)));

function readModule(dir, rel) {
  const abs = path.join(dir, rel);
  if (!fs.existsSync(abs)) throw new Error(`missing module: ${rel}`);
  return fs.readFileSync(abs, 'utf8');
}

// Four shapes: `import d from`, `import d, {…} from`, `import {…} from`, `import * as ns from`.
// The bare-identifier group (4) is the DEFAULT import (`.`-less form), never a namespace import.
const IMPORT_RE = /^[ \t]*import\s+(?:([A-Za-z_$][\w$]*)\s*,\s*)?(?:\{([^}]*)\}|\*\s+as\s+([A-Za-z_$][\w$]*)|([A-Za-z_$][\w$]*))?\s*from\s*['"]([^'"]+)['"];?[ \t]*$/gm;
const BARE_IMPORT_RE = /^[ \t]*import\s+['"]([^'"]+)['"];?[ \t]*$/gm;

function transform(rel, src, deps) {
  let out = src;

  out = out.replace(BARE_IMPORT_RE, (m, spec) => {
    deps.add(resolveSpec(rel, spec));
    return '';
  });

  out = out.replace(IMPORT_RE, (m, dfltComma, named, ns, dfltBare, spec) => {
    const id = resolveSpec(rel, spec);
    deps.add(id);
    const parts = [];
    // Both default forms (`,`-less and `d, {…}`) read `.default`; a namespace
    // import reads the module exports object itself.
    for (const dflt of [dfltComma, dfltBare]) {
      if (dflt) parts.push(`const ${dflt} = __require(${JSON.stringify(id)}).default;`);
    }
    if (ns) parts.push(`const ${ns} = __require(${JSON.stringify(id)});`);
    if (named) {
      const bindings = named.split(',').map((s) => s.trim()).filter(Boolean).map((s) => {
        const [orig, alias] = s.split(/\s+as\s+/).map((x) => x.trim());
        return alias ? `${orig}: ${alias}` : orig;
      });
      parts.push(`const { ${bindings.join(', ')} } = __require(${JSON.stringify(id)});`);
    }
    return parts.join(' ');
  });

  // collect exported bindings
  const exported = [];
  out = out.replace(/^[ \t]*export\s+(function|const|let|class)\s+([A-Za-z_$][\w$]*)/gm, (m, kw, name) => {
    exported.push(name);
    return m.replace(/export\s+/, '');
  });
  out = out.replace(/^[ \t]*export\s+default\s+/gm, () => '__exports.default = ');

  const leftovers = /\b(import|export)\b/.exec(out.replace(/\/\/[^\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, ''));
  if (leftovers) throw new Error(`module ${rel} still contains a bare "${leftovers[0]}" statement after transform`);

  return `__def(${JSON.stringify(idOf(rel))}, function (__exports, __require) {\n${out}${exported.length ? `\n${exported.map((n) => `__exports.${n} = ${n};`).join('\n')}\n` : ''}});\n`;
}

// `dir` is the project root that module specifiers resolve against; `entry` is
// relative to it and must `export function start()`. The defaults bundle the
// shipped wallpaper; the options exist so tests can bundle a fixture project.
export function buildBundle({ dir = WP, entry = ENTRY } = {}) {
  const order = [];
  const seen = new Set();
  const visit = (rel) => {
    if (seen.has(rel)) return;
    seen.add(rel);
    const src = readModule(dir, rel);
    const localDeps = new Set();
    const body = transform(rel, src, localDeps);
    for (const dep of [...localDeps].sort()) visit(`${dep}.js`);
    order.push({ rel, body });
  };
  visit(entry);

  const runtime = [
    '(function () {',
    "  'use strict';",
    '  const __modules = Object.create(null);',
    '  const __cache = Object.create(null);',
    '  function __def(id, factory) { __modules[id] = factory; }',
    '  function __require(id) {',
    '    let m = __cache[id];',
    '    if (!m) {',
    '      m = { exports: {} };',
    '      __cache[id] = m;',
    '      const f = __modules[id];',
    '      if (!f) throw new Error("module not bundled: " + id);',
    '      f(m.exports, __require);',
    '    }',
    '    return __cache[id].exports;',
    '  }',
  ].join('\n');

  const body = order.map((m) => `\n// ---- ${m.rel} ----\n${m.body}`).join('\n');
  const footer = `\n__require(${JSON.stringify(idOf(entry))}).start();\n})();\n`;

  const core = `${runtime}${body}${footer}`;
  const hash = crypto.createHash('sha256').update(core).digest('hex');
  const header = '// GENERATED FILE — do not edit. Source: wallpaper/js/** + wallpaper/data/*.js\n' +
    `// Rebuild: npm run build:bundle\n// content hash: ${hash}\n`;
  return { content: header + core, hash, modules: order.map((m) => m.rel) };
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  const { content, hash, modules } = buildBundle();
  fs.writeFileSync(path.join(WP, 'bundle.js'), content, 'utf8');
  console.log(`bundled ${modules.length} modules -> wallpaper/bundle.js (${(content.length / 1024).toFixed(1)} KiB, ${hash.slice(0, 12)})`);
  for (const m of modules) console.log(`  · ${m}`);
}
