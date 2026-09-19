// Event schedule contract — PLAN.md §3.5, §3.5.1, §9.1.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createEvents, mulberry32 } from '../wallpaper/js/lib/events.js';
import { createWorld } from '../wallpaper/js/lib/world.js';
import { eventsDoc, bodiesDoc, clockDoc, eventById } from './helpers.mjs';

const ev = createEvents(eventsDoc);
const clockBy = new Map(clockDoc.eventList.map((e) => [`${e.Timestamp}|${e.Name}`, e]));
const TOLERANCE = { A: 1, B: 5 };

test('class A anchors match OWClock exactly', () => {
  for (const e of eventsDoc.events.filter((x) => x.tolerance === 'A' && x.source === 'OWClock')) {
    const src = clockBy.get(`${e.atS}|${e.name}`);
    assert.ok(src, `${e.id} (${e.atS}s) missing from OWClock`);
    assert.ok(Math.abs(src.Timestamp - e.atS) <= TOLERANCE.A, `${e.id} drift`);
  }
  assert.equal(eventById('sand_start').atS, 120);
  assert.equal(eventById('supernova').atS, 1320);
  assert.equal(eventById('loop_ends').atS, 1360);
});

test('every OWClock entry is either implemented or explicitly dropped', () => {
  const implemented = new Set(eventsDoc.events.filter((e) => e.source === 'OWClock').map((e) => `${e.atS}|${e.name}`));
  const dropped = new Set(eventsDoc.dropped.map((d) => `${d.atS}|${d.name}`));
  assert.equal(implemented.size + dropped.size, clockDoc.eventList.length, 'mapping must cover all 87 entries');
  for (const k of implemented) assert.ok(!dropped.has(k), `double-booked ${k}`);
  for (const d of eventsDoc.dropped) assert.ok(d.reason && d.reason.length > 5, `dropped entry without reason: ${d.name}`);
  for (const e of clockDoc.eventList) {
    const k = `${e.Timestamp}|${e.Name}`;
    assert.ok(implemented.has(k) || dropped.has(k), `unmapped OWClock entry ${k}`);
  }
});

test('interloper ice-shell windows stay inside tolerance B', () => {
  const world = createWorld({ bodies: bodiesDoc, events: eventsDoc });
  const opens = world.interloper.openTimes;
  assert.equal(opens.length, 3);
  const observed = [220, 695, 1175];
  opens.forEach((t, i) => {
    assert.ok(Math.abs(t - observed[i]) <= TOLERANCE.B, `pass ${i + 1}: ${t.toFixed(2)}s vs ${observed[i]}s`);
  });
  assert.ok(eventsDoc.interloper.ice.maxResidualS <= TOLERANCE.B);
});

test('sun station beat is emergent from the sun-radius curve, not a scripted timer', () => {
  const { contactAtS, centreAtS } = eventsDoc.sunStation;
  assert.equal(Math.round(centreAtS), 690, 'the station centre is reached exactly at the OWClock destroy time');
  assert.ok(contactAtS > 400 && contactAtS < 600, `contact at ${contactAtS}s (progressive engulfment)`);
});

test('satellite phase anchor: 200 s is an exact multiple of the 40 s period', () => {
  const sat = bodiesDoc.bodies.find((b) => b.id === 'skyshutter');
  assert.equal(sat.orbit.periodS, 40);
  assert.equal(sat.orbit.phaseDeg, 40);
  assert.equal(200 % sat.orbit.periodS, 0, 'Satellite Reaches 40° @200s pins the initial phase');
});

test('decorative rates stay inside ±25% (tolerance C) and are deterministic', () => {
  const meteorWindow = [45, 1160];
  const inWindow = ev.meteorTimes.filter((t) => t >= meteorWindow[0] && t < meteorWindow[1]).length;
  const expected = ((meteorWindow[1] - meteorWindow[0]) / 60) * 1;
  assert.ok(Math.abs(inWindow - expected) / expected <= 0.25, `meteors ${inWindow} vs ~${expected.toFixed(1)}`);

  const late = ev.meteorTimes.filter((t) => t >= 1160 && t < 1320).length;
  const expectedLate = ((1320 - 1160) / 60) * 3;
  assert.ok(Math.abs(late - expectedLate) / expectedLate <= 0.25, `late meteors ${late} vs ~${expectedLate.toFixed(1)}`);

  const perMin = ev.lightningTimes.length / (eventsDoc.meta.cycleS / 60);
  assert.ok(Math.abs(perMin - 8) / 8 <= 0.25, `lightning ${perMin.toFixed(2)}/min`);

  const again = createEvents(eventsDoc);
  assert.deepEqual(again.meteorTimes, ev.meteorTimes, 'seeded schedule must be reproducible');
  assert.deepEqual(again.lightningTimes, ev.lightningTimes);
});

test('PRNG is deterministic and uniform-ish', () => {
  const a = mulberry32(221026), b = mulberry32(221026);
  const xs = Array.from({ length: 1000 }, () => a());
  assert.deepEqual(xs, Array.from({ length: 1000 }, () => b()));
  const mean = xs.reduce((s, x) => s + x, 0) / xs.length;
  assert.ok(Math.abs(mean - 0.5) < 0.05, `mean ${mean}`);
  assert.ok(Math.min(...xs) >= 0 && Math.max(...xs) < 1);
});

test('continuous flags follow the event table', () => {
  assert.equal(ev.flagsAt(119).sandFlowing, false);
  assert.equal(ev.flagsAt(121).sandFlowing, true);
  assert.equal(ev.flagsAt(1219).sandFlowing, true);
  assert.equal(ev.flagsAt(1221).sandFlowing, false);
  assert.equal(ev.flagsAt(1319).supernova, false);
  assert.equal(ev.flagsAt(1321).supernova, true);
  assert.equal(ev.flagsAt(1329).blackHole, false);
  assert.equal(ev.flagsAt(1331).blackHole, true);
  assert.equal(ev.flagsAt(100).craterLevel, 1);
  assert.equal(ev.flagsAt(1359).craterLevel, 5, 'crater level caps at 5');
});
