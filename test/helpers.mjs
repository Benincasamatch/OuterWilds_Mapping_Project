import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const readJson = (p) => JSON.parse(fs.readFileSync(path.join(ROOT, p), 'utf8'));

export const bodiesDoc = readJson('wallpaper/data/bodies.json');
export const eventsDoc = readJson('wallpaper/data/events.json');
export const clockDoc = readJson('data/sources/ow-clock-events.json');

export const bodyById = (id) => bodiesDoc.bodies.find((b) => b.id === id);
export const eventById = (id) => eventsDoc.events.find((e) => e.id === id);

/** Angular position of a sampled body around its primary (for period checks). */
export function angleOf(world, id, t) {
  const f = world.sample(t);
  const i = world.ids.indexOf(id);
  const n = world.nodeById.get(id);
  const p = n.parent ? world.nodeById.get(n.parent) : null;
  const dx = f.bodies[i].x - (p ? p.x : 0);
  const dz = f.bodies[i].z - (p ? p.z : 0);
  return Math.atan2(dz, dx);
}

export const normalizedDelta = (a, b) => {
  let d = a - b;
  while (d > Math.PI) d -= 2 * Math.PI;
  while (d < -Math.PI) d += 2 * Math.PI;
  return d;
};
