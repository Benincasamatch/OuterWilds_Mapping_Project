// Kepler solver + datamine consistency (PLAN.md §3.1, §3.3, §3.4 rule 3).
import test from 'node:test';
import assert from 'node:assert/strict';
import { makeEllipse, TWO_PI } from '../wallpaper/js/lib/kepler.js';
import { bodiesDoc, bodyById } from './helpers.mjs';

const MU = bodiesDoc.meta.muSun;

test('circular period matches the community Kepler fit for sun-orbiting bodies', () => {
  for (const id of ['timber_hearth', 'brittle_hollow', 'dark_bramble']) {
    const b = bodyById(id);
    if (!Number.isFinite(b.orbit.periodS)) continue;
    const predicted = TWO_PI * Math.sqrt(b.orbit.distanceM ** 3 / MU);
    const dev = Math.abs(predicted - b.orbit.periodS) / b.orbit.periodS;
    assert.ok(dev < 0.02, `${id}: Kepler ${predicted.toFixed(1)}s vs table ${b.orbit.periodS}s (${(dev * 100).toFixed(2)}%)`);
  }
});

test('satellite periods are measured, not Kepler-derived (rule 3)', () => {
  const lantern = bodyById('hollows_lantern');
  assert.equal(lantern.orbit.periodSource, 'measured');
  assert.ok(lantern.orbit.periodS < 200, 'scripted satellite period stays short');
  assert.equal(bodyById('opc').orbit.distanceSource, 'design', 'OPC radius is a design value, not a μ_sun reverse solve');
  assert.equal(bodyById('skyshutter').orbit.distanceSource, 'design');
});

test('ellipse round-trips radius <-> time from perihelion', () => {
  const b = bodyById('interloper');
  const el = makeEllipse({ a: b.orbit.aM, e: b.orbit.eM, periodS: b.orbit.periodS, perihelionEpochS: 0 });
  for (const r of [2500, 3000, 5000, 12000, 24000]) {
    const dt = el.timeFromPerihelion(r);
    assert.ok(dt > 0 && dt < el.periodS / 2 + 1e-6, `dt range for r=${r}`);
    assert.ok(Math.abs(el.radiusAt(dt) - r) < 1e-6, `round trip r=${r}`);
    assert.ok(Math.abs(el.radiusAt(el.periodS - dt) - r) < 1e-6, `outbound leg r=${r}`);
  }
  assert.ok(Math.abs(el.radiusAt(0) - b.orbit.perihelionM) < 1e-6);
  assert.ok(Math.abs(el.radiusAt(el.periodS / 2) - b.orbit.aphelionM) < 1e-3);
});

test('interloper agrees with the hand-measured period (tolerance B)', () => {
  const b = bodyById('interloper');
  const dev = Math.abs(b.orbit.periodS - 480) / 480;
  assert.ok(dev < 0.02, `Kepler ${b.orbit.periodS.toFixed(2)}s vs measured 480s = ${(dev * 100).toFixed(2)}%`);
});
