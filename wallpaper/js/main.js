// Wallpaper entry point — PLAN.md §4.2/§4.4/§4.5.
// Boots WebGL2, the world sampler, the clock, the camera, the HUD and the WE
// user-property bridge. Runs as one classic script (see tools/build-bundle.mjs)
// so that WE can load it from a plain folder (no fetch, no ESM/CORS risk).
import bodiesDoc from '../data/bodies.js';
import eventsDoc from '../data/events.js';
import { createWorld } from './lib/world.js';
import { createClock } from './lib/time.js';
import { drawDue } from './lib/framerate.js';
import { createPlayback } from './lib/playback.js';
import { DEFAULTS, PROPERTY_RULES } from './lib/settings.js';
import { createProps } from './lib/props.js';
import { createCamera } from './camera.js';
import { createControls } from './controls.js';
import { createHud } from './hud.js';
import { createScene } from './render/scene.js';
import { createTextureSet, bakeAll } from './render/textures.js';


// Seconds the white mask lingers over a loop seam / wall-clock resume (PLAN.md §4.4).
const SEAM_FLASH_S = 0.9;

export function start() {
  try { return boot(); }
  catch (error) {
    const fallback = document.getElementById('fallback');
    fallback.style.display = 'flex';
    fallback.textContent = '启动失败，请检查 WebGL2 硬件加速或重新加载壁纸。';
    console.error('Wallpaper startup failed', error);
    return { ok: false, error: String(error) };
  }
}
function boot() {
  const canvas = document.getElementById('view');
  const fallback = document.getElementById('fallback');
  const hudMount = document.getElementById('hud');

  // MSAA smooths the 1 px orbit lines and planet limbs; the scene is tiny, so the
  // resolve cost is negligible next to the idle frame cap (PLAN.md §4.2).
  const gl = canvas.getContext('webgl2', {
    alpha: false, antialias: true, depth: true, stencil: false,
    powerPreference: 'high-performance', preserveDrawingBuffer: false,
  });
  if (!gl) {
    fallback.style.display = 'flex';
    fallback.textContent = 'WebGL2 不可用 —— 该壁纸需要硬件加速的 WebGL2（Wallpaper Engine 的 CEF）。';
    return { ok: false };
  }

  // --- capability report (PLAN.md §1.2 / R9) ---
  const dbg = gl.getExtension('WEBGL_debug_renderer_info');
  const renderer = dbg ? gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) : '(unavailable)';
  const software = /swiftshader|software|llvmpipe|basic render/i.test(String(renderer));
  const aniso = gl.getExtension('EXT_texture_filter_anisotropic');
  const capability = { renderer, software, anisotropic: !!aniso, maxTextureSize: gl.getParameter(gl.MAX_TEXTURE_SIZE) };
  window.OW = window.OW || {};
  window.OW.capability = capability;

  // --- user properties (must be assigned globally and synchronously) ---
  const properties = createProps(DEFAULTS, PROPERTY_RULES);
  const props = properties.props;
  window.wallpaperPropertyListener = {
    applyUserProperties(updates) {
      if (properties.apply(updates).length) applyProps(true);
    },
    applyGeneralProperties(updates) {
      const fps = Number(updates?.fps);
      if (Number.isFinite(fps) && fps > 0) hostFps = Math.min(240, fps);
    },
    setPaused(value) { playback.setSuspended('host', value === true); },
  };
  let hostFps = 60;

  // --- world / clock / camera / scene ---
  let scaleOptions = scaleFromProps(props);
  let world = createWorld({ bodies: bodiesDoc, events: eventsDoc, options: { scale: scaleOptions } });
  const clock = createClock({ cycleS: world.cycleS, mode: props.pauseMode });
  const playback = createPlayback({ clock, now: () => performance.now() / 1000, rate: () => paused ? 0 : props.timeScale });
  const camera = createCamera({ distance: 12000 });
  let scene = createScene(gl, { starCount: 12000, orbitSegments: 256, maxParticles: 256 });
  // 26 layers are needed for all declared variants; 32 keeps headroom without
  // reserving the 64-layer storage the driver would otherwise allocate (~2× VRAM).
  let textures = createTextureSet(gl, bodiesDoc.bodies, { size: 512, maxLayers: 32 });
  bakeAll(textures, bodiesDoc.bodies);
  scene.setTextures(textures);

  const hud = createHud({ mount: hudMount, world });
  scene.setStarBrightness(props.starBrightness);
  hud.setGpuInfo(`${software ? 'SOFTWARE!' : 'hw'} · ${String(renderer).slice(0, 48)}${aniso ? ' · aniso' : ''}`);
  hud.setVisible(props.showHud);

  const observer = { visible: (x, y, z, r) => camera.visibleSphere(x, y, z, r) };
  const layers = new Int32Array(world.ids.length).fill(-1);
  const variantCache = new Array(world.ids.length).fill('');

  function resolveLayers(frame) {
    for (let i = 0; i < frame.bodies.length; i++) {
      const b = frame.bodies[i];
      // Virtual/bare nodes (the Hourglass Twins barycentre) declare no texture:
      // asking for a layer would bake one that is never drawn.
      if (!b.textureKey) { b.layer = 0; continue; }
      if (variantCache[i] === b.variant && layers[i] >= 0) { b.layer = layers[i]; continue; }
      variantCache[i] = b.variant;
      layers[i] = textures.layerOf(b.textureKey, b.variant);
      b.layer = layers[i];
    }
  }

  function scaleFromProps(p) {
    return p.realScale ? { p: 1, kSun: 2001.75, rSun0: 2001.75, kLocal: 1, kBody: 1 }
      : { p: p.compression, kLocal: p.localScale, kBody: p.bodyScale };
  }

  function applyProps(rebuild) {
    clock.setMode(props.pauseMode);
    hud.setVisible(props.showHud);
    controls.setVisible(props.showControls);
    scene.setStarBrightness(props.starBrightness);
    const next = scaleFromProps(props);
    const changed = rebuild && (next.p !== scaleOptions.p || next.kLocal !== scaleOptions.kLocal
      || next.kBody !== scaleOptions.kBody || next.kSun !== scaleOptions.kSun);
    if (changed) {
      scaleOptions = next;
      world = createWorld({ bodies: bodiesDoc, events: eventsDoc, options: { scale: scaleOptions } });
      layers.fill(-1); variantCache.fill('');
      hud.setWorld(world);
      publishDebug();
    }
    const qm = world.nodeById.get('quantum_moon');
    if (qm && props.qmDwell > 0) qm.dwellS = props.qmDwell;
  }

  // --- canvas / input plumbing ---
  let lastInputAt = -Infinity;
  let paused = false;
  const keys = new Set();
  function markInput() { lastInputAt = performance.now() / 1000; }

  const controls = createControls({ mount: document.getElementById('controls'), camera, onInput: markInput });
  camera.attach(canvas);
  canvas.addEventListener('pointermove', markInput);
  canvas.addEventListener('pointerdown', markInput);
  canvas.addEventListener('wheel', markInput, { passive: true });
  window.addEventListener('keydown', (e) => {
    keys.add(e.key);
    markInput();
    if (!e.repeat && (e.key === 'h' || e.key === 'H')) hud.setVisible(!hud.visible);
    if ((e.key === 'p' || e.key === 'P') && !e.repeat) { paused = !paused; }
    if (e.key === 'r' || e.key === 'R') { clock.reset(); world.reset(); seamFlashAt = performance.now() / 1000; }
  });
  window.addEventListener('keyup', (e) => keys.delete(e.key));
  window.addEventListener('blur', () => keys.clear());

  function resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 1.5);
    const w = Math.max(1, Math.floor(canvas.clientWidth * dpr));
    const h = Math.max(1, Math.floor(canvas.clientHeight * dpr));
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w; canvas.height = h;
    }
    camera.setAspect(w / h);
    camera.viewportHeight = Math.max(1, canvas.clientHeight);
    scene.resize(w, h, dpr);
  }
  window.addEventListener('resize', resize);
  resize();

  // --- context loss (PLAN.md §4.2): rebuild once, otherwise show the fallback ---
  let contextLost = false;
  canvas.addEventListener('webglcontextlost', (e) => {
    e.preventDefault();
    contextLost = true;
    playback.setSuspended('context', true);
    // Release CPU ownership while the old context is lost; never delete stale
    // handles against the restored context (that produces INVALID_OPERATION).
    try { scene.dispose(); textures.dispose(); } catch { /* lost context */ }
    fallback.style.display = 'flex';
    fallback.textContent = 'WebGL 上下文丢失，正在尝试恢复…';
  });
  canvas.addEventListener('webglcontextrestored', () => {
    try {
      // ALL programs, VAOs, buffers and textures are invalid after a context loss.
      scene = createScene(gl, { starCount: 12000, orbitSegments: 256, maxParticles: 256 });
      textures = createTextureSet(gl, bodiesDoc.bodies, { size: 512, maxLayers: 32 });
      bakeAll(textures, bodiesDoc.bodies);
      scene.setTextures(textures);
      scene.setStarBrightness(props.starBrightness);
      layers.fill(-1); variantCache.fill('');
      resize(); publishDebug();
      contextLost = false;
      fallback.style.display = 'none';
      playback.setSuspended('context', false);
    } catch (error) {
      contextLost = true;
      fallback.style.display = 'flex';
      fallback.textContent = '图形资源恢复失败，请重新加载壁纸。';
      console.error('Wallpaper context recovery failed', error);
    }
  });

  const syncVisibility = () => playback.setSuspended('visibility', document.hidden);
  document.addEventListener('visibilitychange', syncVisibility);
  syncVisibility();

  applyProps(false);

  // --- main loop ---
  let lastDrawAt = 0;
  let sampledWraps = clock.wraps;
  let seamFlashAt = -1;

  function frameLoop() {
    requestAnimationFrame(frameLoop);
    const now = performance.now() / 1000;
    const wrapped = playback.advance(now);
    const dt = playback.dt;
    if (contextLost || playback.suspended) return;
    // Resume may skip whole cycles yet land AFTER the last sampled time.
    // The sampler cannot detect that from t alone; reset its state explicitly.
    if (clock.wraps !== sampledWraps) { world.reset(); sampledWraps = clock.wraps; }
    const f = world.sample(clock.t, observer);
    resolveLayers(f);
    camera.update(dt);
    camera.nudge(keys);

    // The scene snaps whenever the loop restarts (t 1360 -> 0: the sky comes back from
    // extinction and the sun from its remnant) and whenever a wall-clock resume jumps.
    // Both are hidden behind a white flash instead of a silent cut (PLAN.md §4.4).
    if (wrapped) { seamFlashAt = now; clock.clearResync(); }
    if (clock.pendingResync) { seamFlashAt = now; clock.clearResync(); }
    let seam = 0;
    if (seamFlashAt >= 0) {
      seam = 1 - (now - seamFlashAt) / SEAM_FLASH_S;
      if (seam <= 0) { seam = 0; seamFlashAt = -1; }
      else seam *= seam;                     // ease out so the cut stays hidden
    }
    scene.setFlashOverlay(seam);

    // idle = no recent input and no active visual event (PLAN.md §1.2): the loop
    // never truly stands still, so we lower the frame rate instead of skipping.
    const recentInput = now - lastInputAt < 3;
    const busy = seam > 0 || recentInput || f.particleCount > 0 || f.sun.flash > 0 || f.flags.endgame
      || (f.flags.starExtinction > 0 && f.flags.starExtinction < 1);
    if (drawDue(now, lastDrawAt, busy, Math.min(props.fpsLimit, hostFps), Math.min(props.idleFps, hostFps))) {
      lastDrawAt = now;
      scene.setStarExtinction(f.flags.starExtinction);
      scene.draw(f, camera, { orbitLines: props.orbitLines, stars: true, quality: 'high' });
    }
    hud.tick(f, camera, scene.stats);
    for (let i = 0; i < f.eventCount; i++) hud.pushEvent(f.events[i], f.t);
  }
  requestAnimationFrame(frameLoop);

  // Debug surface (browser console + automated checks). It must point at the *live*
  // world, so a user-property rebuild re-publishes it.
  function publishDebug() {
    Object.assign(window.OW, { world, clock, camera, scene, hud, textures, props, capability, playback, sample: (t) => world.sample(t, observer) });
  }
  publishDebug();
  return { ok: true, capability };
}
