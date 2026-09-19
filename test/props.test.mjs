// Wallpaper Engine user-property bridge — PLAN.md §4.4.
// WE sends property keys lower-cased (`project.json`: `fpslimit`, `orbitlines`, …) while
// the scene stores camelCase fields. A case-sensitive lookup drops the setting silently:
// the wallpaper runs, the panel does nothing.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createProps } from '../wallpaper/js/lib/props.js';
import { ROOT } from './helpers.mjs';

import { DEFAULTS, PROPERTY_RULES } from '../wallpaper/js/lib/settings.js';

test('every WE property in project.json maps onto a scene field', () => {
  const project = JSON.parse(fs.readFileSync(path.join(ROOT, 'wallpaper/project.json'), 'utf8'));
  const declared = Object.keys(project.general.properties);
  assert.ok(declared.length >= 10, `only ${declared.length} WE properties declared`);
  const { fieldOf } = createProps(DEFAULTS);
  const unmapped = declared.filter((k) => !fieldOf(k));
  assert.deepEqual(unmapped, [], 'these WE properties would be silently ignored');
  // and nothing the scene reads is missing from the panel either
  const declaredLower = new Set(declared.map((k) => k.toLowerCase()));
  const missing = Object.keys(DEFAULTS).filter((k) => !declaredLower.has(k.toLowerCase()));
  assert.deepEqual(missing, [], 'scene fields with no WE control');
});

test('lower-cased WE keys update the matching camelCase field', () => {
  const { props, apply } = createProps(DEFAULTS);
  const changed = apply({
    fpslimit: { value: 45 }, orbitlines: { value: false },
    timescale: { value: 2.5 }, pausemode: { value: 'wall-clock' },
    starbrightness: { value: 0.5 }, showhud: { value: true },
  });
  assert.equal(props.fpsLimit, 45);
  assert.equal(props.orbitLines, false);
  assert.equal(props.timeScale, 2.5);
  assert.equal(props.pauseMode, 'wall-clock');
  assert.equal(props.starBrightness, 0.5);
  assert.equal(props.showHud, true);
  assert.deepEqual(changed.sort(), ['fpsLimit', 'orbitLines', 'pauseMode', 'showHud', 'starBrightness', 'timeScale']);
});

test('types are coerced: numbers stay finite, bools stay boolean, unknown keys ignored', () => {
  const { props, apply } = createProps(DEFAULTS);
  apply({ timescale: { value: '3.5' }, orbitlines: { value: 0 }, showhud: { value: 1 }, nosuchkey: { value: 7 } });
  assert.equal(props.timeScale, 3.5, 'a string slider value must become a number');
  assert.equal(props.orbitLines, false);
  assert.equal(props.showHud, true);
  assert.equal(props.fpsLimit, 30, 'unknown keys must not touch anything');
  assert.deepEqual(apply({ compression: { value: 'abc' } }), [], 'a non-numeric value is rejected, not stored as NaN');
  assert.equal(props.compression, 0.45);
  assert.deepEqual(apply({}), []);
  assert.deepEqual(apply(null), []);
});

test('unchanged values report no change (no needless world rebuild)', () => {
  const { apply } = createProps(DEFAULTS);
  assert.deepEqual(apply({ bodyscale: { value: 1.4 } }), []);
  assert.deepEqual(apply({ bodyscale: { value: 2 } }), ['bodyScale']);
  assert.deepEqual(apply({ bodyscale: { value: 2 } }), []);
});

test('host defaults match the published panel', () => {
  const project = JSON.parse(fs.readFileSync(path.join(ROOT, 'wallpaper/project.json'), 'utf8'));
  for (const [key, value] of Object.entries(DEFAULTS)) assert.equal(project.general.properties[key.toLowerCase()].value, value, key);
});
test('string booleans, invalid types and host ranges are handled safely', () => {
  const { props, apply } = createProps(DEFAULTS, PROPERTY_RULES);
  apply({ orbitlines: { value: 'false' }, showhud: { value: 'true' }, timescale: { value: 999 }, fpslimit: { value: -5 } });
  assert.equal(props.orbitLines, false); assert.equal(props.showHud, true);
  assert.equal(props.timeScale, 10); assert.equal(props.fpsLimit, 15);
  for (const value of [null, {}, [], true, '', Infinity, 'NaN']) assert.deepEqual(apply({ compression: { value } }), []);
  for (const value of [null, {}, 'unknown']) assert.deepEqual(apply({ pausemode: { value } }), []);
  assert.deepEqual(apply({ showhud: { value: 'perhaps' } }), []);
  assert.equal(props.pauseMode, 'paused-loop');
});
