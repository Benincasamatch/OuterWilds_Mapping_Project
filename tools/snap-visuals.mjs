// Dev-only: screenshot the wallpaper at a few loop moments / camera poses so a
// visual change can be compared before/after. Not shipped (tools/ is outside
// the package allowlist). Usage:
//   PLAYWRIGHT_MODULE=<path> node tools/snap-visuals.mjs [--page /wallpaper/] [--out .browser-test/snaps]
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { createServer, ROOT } from './serve.mjs';
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
// Accept "wallpaper/" as well as "/wallpaper/" (Git Bash rewrites a leading "/" into a
// Windows path, so callers pass the relative form).
let pagePath = arg('--page', '/wallpaper/').replace(/\\/g, '/');
if (!pagePath.startsWith('/')) pagePath = '/' + pagePath;
const out = path.resolve(ROOT, arg('--out', '.browser-test/snaps'));
fs.mkdirSync(out, { recursive: true });

// [name, t seconds, camera state, optional body id to target]
const SHOTS = [
  ['overview-t45', 45, { distance: 12000, yaw: 0.6, pitch: 0.26 }],
  ['cover-t45', 45, { distance: 36000, yaw: 0.6, pitch: 0.85 }],
  ['timber-close-t60', 60, { distance: 1400, yaw: 1.1, pitch: 0.2 }, 'timber_hearth'],
  ['giants-close-t300', 300, { distance: 2600, yaw: 2.3, pitch: 0.3 }, 'giants_deep'],
  ['twins-sand-t230', 230, { distance: 1800, yaw: 0.4, pitch: 0.5 }, 'hourglass_barycentre'],
  ['red-sun-t1250', 1250, { distance: 12000, yaw: 0.6, pitch: 0.26 }],
  ['supernova-t1321', 1321.2, { distance: 12000, yaw: 0.6, pitch: 0.26 }],
  ['remnant-t1340', 1340, { distance: 12000, yaw: 0.6, pitch: 0.26 }],
];

const server = createServer();
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const url = `http://127.0.0.1:${server.address().port}${pagePath}`;
const browser = await chromium.launch({ headless: true, executablePath: process.env.BROWSER_EXECUTABLE || undefined });
try {
  const context = await browser.newContext({ viewport: { width: 1600, height: 900 }, deviceScaleFactor: 1 });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  await page.goto(url);
  await page.waitForFunction(() => window.OW?.scene?.stats.draws > 2);
  await page.evaluate(() => wallpaperPropertyListener.applyUserProperties({ showcontrols: { value: false }, showhud: { value: false } }));
  const stats = {};
  for (const [name, t, cam, target] of SHOTS) {
    await page.evaluate(([t, cam, target]) => {
      OW.clock.seek(t);
      const f = OW.sample(t);
      if (target) {
        const b = f.bodies.find((x) => x.id === target);
        OW.camera.setTarget(b.x, b.y, b.z);
      } else OW.camera.setTarget(0, 0, 0);
      OW.camera.setState(cam); OW.camera.snap();
    }, [t, cam, target]);
    await page.waitForTimeout(450);
    await page.screenshot({ path: path.join(out, name + '.png') });
    stats[name] = await page.evaluate(() => ({ t: OW.clock.t, drawCalls: OW.scene.stats.drawCalls, lastMs: OW.scene.stats.lastMs, triangles: OW.scene.stats.triangles }));
  }
  const glError = await page.evaluate(() => document.querySelector('canvas').getContext('webgl2').getError());
  fs.writeFileSync(path.join(out, 'stats.json'), JSON.stringify({ url, glError, errors, stats }, null, 2));
  console.log(JSON.stringify({ out, glError, errors, stats }, null, 2));
} finally {
  await browser.close();
  await new Promise((r) => server.close(r));
}
