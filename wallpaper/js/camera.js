// Orbit camera + input (PLAN.md §2.4 input policy, §4.5 module map).
// Pointer Events with pointer capture (works in CEF), wheel = logarithmic zoom,
// shift+drag = pan. Matrices and the frustum are preallocated (zero allocation).
import { DEG } from './lib/kepler.js';

const SENSITIVITY = 0.0045;          // rad per px
const ZOOM_RATE = 0.0012;            // per wheel unit
const PAN_RATE = 1.0;

export function createCamera({ fovY = 50, near = 8, far = 400000, distance = 12000,
  minDistance = 700, maxDistance = 160000, yaw = 0.6, pitch = 15 * DEG, tau = 0.12 } = {}) {
  const state = {
    yaw, pitch, distance, targetX: 0, targetY: 0, targetZ: 0,
    yawT: yaw, pitchT: pitch, distanceT: distance, txT: 0, tyT: 0, tzT: 0,
  };
  const eye = new Float32Array(3);
  const target = new Float32Array(3);
  const up = new Float32Array([0, 1, 0]);
  const view = new Float32Array(16);
  const proj = new Float32Array(16);
  const viewProj = new Float32Array(16);
  const planes = new Float32Array(24);
  const right = new Float32Array(3);
  const camUp = new Float32Array(3);

  const cam = {
    eye, target, up, view, proj, viewProj, planes,
    fovY, near, far, aspect: 1,
    get distance() { return state.distance; },
    get yaw() { return state.yaw; },
    get pitch() { return state.pitch; },

    resetView() {
      cam.setTarget(0, 0, 0);
      cam.setState({ yaw, pitch, distance });
    },
    setAspect(a) { cam.aspect = a > 0 ? a : 1; },
    setTarget(x, y, z) { state.targetX = state.txT = x; state.targetY = state.tyT = y; state.targetZ = state.tzT = z; },
    zoomBy(factor) {
      state.distanceT = Math.min(maxDistance, Math.max(minDistance, state.distanceT * factor));
    },
    snap() {
      state.yaw = state.yawT; state.pitch = state.pitchT; state.distance = state.distanceT;
      state.targetX = state.txT; state.targetY = state.tyT; state.targetZ = state.tzT;
    },

    update(dt) {
      const k = 1 - Math.exp(-Math.max(0, dt) / tau);
      state.yaw += (state.yawT - state.yaw) * k;
      state.pitch += (state.pitchT - state.pitch) * k;
      state.distance += (state.distanceT - state.distance) * k;
      state.targetX += (state.txT - state.targetX) * k;
      state.targetY += (state.tyT - state.targetY) * k;
      state.targetZ += (state.tzT - state.targetZ) * k;

      const cp = Math.cos(state.pitch), sp = Math.sin(state.pitch);
      eye[0] = state.targetX + state.distance * cp * Math.cos(state.yaw);
      eye[1] = state.targetY + state.distance * sp;
      eye[2] = state.targetZ + state.distance * cp * Math.sin(state.yaw);
      target[0] = state.targetX; target[1] = state.targetY; target[2] = state.targetZ;

      perspective(proj, fovY * DEG, cam.aspect, near, far);
      lookAt(view, eye, target, up);
      multiply(viewProj, proj, view);
      extractPlanes(planes, viewProj);

      // camera basis (matches lookAt: x = normalize(up × z), y = z × x)
      const sy = Math.sin(state.yaw), cy = Math.cos(state.yaw);
      right[0] = sy; right[1] = 0; right[2] = -cy;
      camUp[0] = -sp * cy; camUp[1] = cp; camUp[2] = -sp * sy;
      return cam;
    },

    /** Drag-to-pan: the world follows the cursor (camera moves the opposite way). */
    pan(dxPx, dyPx) {
      const s = (state.distance * Math.tan(fovY * DEG / 2) * 2) / (cam.viewportHeight || 1080) * PAN_RATE;
      const sx = dxPx * s, sy2 = dyPx * s;
      state.txT += -right[0] * sx + camUp[0] * sy2;
      state.tyT += camUp[1] * sy2;
      state.tzT += -right[2] * sx + camUp[2] * sy2;
    },

    /** Frustum cull test used by the quantum-moon "not observed" rule. */
    visibleSphere(x, y, z, r) {
      for (let i = 0; i < 24; i += 4) {
        if (planes[i] * x + planes[i + 1] * y + planes[i + 2] * z + planes[i + 3] < -r) return false;
      }
      return true;
    },

    viewportHeight: 1080,

    attach(el) {
      let dragging = false, panning = false, lastX = 0, lastY = 0, pointerId = -1;
      const down = (e) => {
        if (e.button !== 0 && e.button !== 1) return;
        dragging = true; panning = e.shiftKey || e.button === 1;
        lastX = e.clientX; lastY = e.clientY; pointerId = e.pointerId;
        try { el.setPointerCapture(e.pointerId); } catch { /* capture is best-effort */ }
        el.style.cursor = panning ? 'move' : 'grabbing';
      };
      const move = (e) => {
        if (!dragging || e.pointerId !== pointerId) return;
        const dx = e.clientX - lastX, dy = e.clientY - lastY;
        lastX = e.clientX; lastY = e.clientY;
        if (panning) cam.pan(dx, dy);
        else {
          state.yawT -= dx * SENSITIVITY;
          state.pitchT = clamp(state.pitchT + dy * SENSITIVITY, -85 * DEG, 85 * DEG);
        }
      };
      const up = () => { dragging = false; panning = false; pointerId = -1; el.style.cursor = 'grab'; };
      const wheel = (e) => {
        e.preventDefault();
        const unit = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? cam.viewportHeight : 1;
        cam.zoomBy(Math.exp(e.deltaY * unit * ZOOM_RATE));
      };

      el.addEventListener('pointerdown', down);
      el.addEventListener('pointermove', move);
      el.addEventListener('pointerup', up);
      el.addEventListener('pointercancel', up);
      el.addEventListener('lostpointercapture', up);
      el.addEventListener('wheel', wheel, { passive: false });
      el.addEventListener('contextmenu', (e) => e.preventDefault());
      el.style.cursor = 'grab';
      return () => {
        el.removeEventListener('pointerdown', down);
        el.removeEventListener('pointermove', move);
        el.removeEventListener('pointerup', up);
        el.removeEventListener('pointercancel', up);
        el.removeEventListener('lostpointercapture', up);
        el.removeEventListener('wheel', wheel);
      };
    },

    /** Keyboard fallback — only usable if the wallpaper page holds focus (Spike A). */
    nudge(keys) {
      if (keys.has('+') || keys.has('=')) cam.zoomBy(0.9);
      if (keys.has('-') || keys.has('_')) cam.zoomBy(1.1);
      if (keys.has('ArrowLeft')) state.yawT += 0.1;
      if (keys.has('ArrowRight')) state.yawT -= 0.1;
      if (keys.has('ArrowUp')) state.pitchT = clamp(state.pitchT + 0.08, -85 * DEG, 85 * DEG);
      if (keys.has('ArrowDown')) state.pitchT = clamp(state.pitchT - 0.08, -85 * DEG, 85 * DEG);
    },

    setState(next) {
      if (next.yaw !== undefined) state.yawT = next.yaw;
      if (next.pitch !== undefined) state.pitchT = next.pitch;
      if (next.distance !== undefined) state.distanceT = Math.min(maxDistance, Math.max(minDistance, next.distance));
      if (next.tau !== undefined) tau = next.tau;
      if (next.fovY !== undefined) { fovY = next.fovY; cam.fovY = next.fovY; }
    },
    state,
  };
  return cam;
}

const clamp = (x, lo, hi) => (x < lo ? lo : x > hi ? hi : x);

function perspective(out, fovy, aspect, near, far) {
  const f = 1 / Math.tan(fovy / 2);
  const nf = 1 / (near - far);
  out.fill(0);
  out[0] = f / aspect; out[5] = f; out[10] = (far + near) * nf; out[11] = -1;
  out[14] = 2 * far * near * nf;
  return out;
}

const zTmp = new Float32Array(4);
function lookAt(out, eye, center, up) {
  let z0 = eye[0] - center[0], z1 = eye[1] - center[1], z2 = eye[2] - center[2];
  let len = Math.hypot(z0, z1, z2) || 1;
  z0 /= len; z1 /= len; z2 /= len;
  let x0 = up[1] * z2 - up[2] * z1, x1 = up[2] * z0 - up[0] * z2, x2 = up[0] * z1 - up[1] * z0;
  len = Math.hypot(x0, x1, x2);
  if (!len) { x0 = 1; x1 = 0; x2 = 0; } else { x0 /= len; x1 /= len; x2 /= len; }
  const y0 = z1 * x2 - z2 * x1, y1 = z2 * x0 - z0 * x2, y2 = z0 * x1 - z1 * x0;
  out[0] = x0; out[1] = y0; out[2] = z0; out[3] = 0;
  out[4] = x1; out[5] = y1; out[6] = z1; out[7] = 0;
  out[8] = x2; out[9] = y2; out[10] = z2; out[11] = 0;
  out[12] = -(x0 * eye[0] + x1 * eye[1] + x2 * eye[2]);
  out[13] = -(y0 * eye[0] + y1 * eye[1] + y2 * eye[2]);
  out[14] = -(z0 * eye[0] + z1 * eye[1] + z2 * eye[2]);
  out[15] = 1;
  return out;
}

function multiply(out, a, b) {
  for (let c = 0; c < 4; c++) {
    for (let r = 0; r < 4; r++) {
      zTmp[r] = a[r] * b[c * 4] + a[4 + r] * b[c * 4 + 1] + a[8 + r] * b[c * 4 + 2] + a[12 + r] * b[c * 4 + 3];
    }
    out[c * 4] = zTmp[0]; out[c * 4 + 1] = zTmp[1]; out[c * 4 + 2] = zTmp[2]; out[c * 4 + 3] = zTmp[3];
  }
  return out;
}

/** Gribb–Hartmann plane extraction; normals normalised so distance units are world units. */
function extractPlanes(planes, m) {
  const rows = [
    [m[3] + m[0], m[7] + m[4], m[11] + m[8], m[15] + m[12]],   // left
    [m[3] - m[0], m[7] - m[4], m[11] - m[8], m[15] - m[12]],   // right
    [m[3] + m[1], m[7] + m[5], m[11] + m[9], m[15] + m[13]],   // bottom
    [m[3] - m[1], m[7] - m[5], m[11] - m[9], m[15] - m[13]],   // top
    [m[3] + m[2], m[7] + m[6], m[11] + m[10], m[15] + m[14]],  // near
    [m[3] - m[2], m[7] - m[6], m[11] - m[10], m[15] - m[14]],  // far
  ];
  for (let i = 0; i < 6; i++) {
    const [a, b, c, d] = rows[i];
    const len = Math.hypot(a, b, c) || 1;
    planes[i * 4] = a / len; planes[i * 4 + 1] = b / len; planes[i * 4 + 2] = c / len; planes[i * 4 + 3] = d / len;
  }
  return planes;
}
