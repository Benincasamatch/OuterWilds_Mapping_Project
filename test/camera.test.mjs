// Camera / matrix / frustum maths (drives culling and the quantum-moon rule).
import test from 'node:test';
import assert from 'node:assert/strict';
import { createCamera } from '../wallpaper/js/camera.js';

const DEG = Math.PI / 180;

test('eye position follows yaw/pitch/distance around the target', () => {
  const cam = createCamera({ distance: 1000, yaw: 0, pitch: 0, tau: 1e-9 });
  cam.setAspect(16 / 9);
  cam.update(1);
  cam.snap();
  cam.update(1);
  assert.ok(Math.abs(cam.eye[0] - 1000) < 1e-3, `eye.x=${cam.eye[0]}`);
  assert.ok(Math.abs(cam.eye[1]) < 1e-3);
  assert.ok(Math.abs(cam.eye[2]) < 1e-3);
  cam.setState({ yaw: Math.PI / 2 });
  cam.update(1); cam.snap(); cam.update(1);
  assert.ok(Math.abs(cam.eye[2] - 1000) < 1e-3, `after yaw 90°: eye.z=${cam.eye[2]}`);
});

test('frustum accepts the target and rejects what is behind or far aside', () => {
  const cam = createCamera({ distance: 1000, yaw: 0, pitch: 0 });
  cam.setAspect(16 / 9);
  cam.snap();
  cam.update(0);
  assert.equal(cam.visibleSphere(0, 0, 0, 10), true, 'target is visible');
  assert.equal(cam.visibleSphere(4000, 0, 0, 10), false, 'behind the camera');
  assert.equal(cam.visibleSphere(0, 0, 5000, 10), false, 'far outside the horizontal fov');
  assert.equal(cam.visibleSphere(0, 0, 200, 50), true, 'large sphere straddling the view');
  assert.equal(cam.visibleSphere(0, 4000, 0, 10), false, 'above the view');
});

test('visibleSphere is scale-aware (the Eye at 47k units still tests correctly)', () => {
  const cam = createCamera({ distance: 12000 });
  cam.setAspect(2);
  cam.snap();
  cam.update(0);
  assert.equal(cam.visibleSphere(47470, 0, 0, 201), false, 'outside a 12000-unit orbit view');
  cam.setState({ distance: 90000 });
  cam.snap();
  cam.update(0);
  assert.equal(cam.visibleSphere(47470, 0, 0, 201), true, 'visible once zoomed out');
});

test('zoom is logarithmic and clamped to the configured range', () => {
  const cam = createCamera({ distance: 12000, minDistance: 700, maxDistance: 160000 });
  cam.zoomBy(0.5); cam.snap(); cam.update(0);
  assert.ok(Math.abs(cam.distance - 6000) < 1, `zoom in: ${cam.distance}`);
  for (let i = 0; i < 80; i++) cam.zoomBy(0.5);
  cam.snap(); cam.update(0);
  assert.equal(Math.round(cam.distance), 700, 'clamped at minDistance');
  for (let i = 0; i < 200; i++) cam.zoomBy(2);
  cam.snap(); cam.update(0);
  assert.equal(Math.round(cam.distance), 160000, 'clamped at maxDistance');
});

test('damping converges toward the requested state', () => {
  const cam = createCamera({ distance: 12000, tau: 0.12 });
  cam.setState({ yaw: 1, pitch: 0.5, distance: 5000 });
  cam.update(0.06);
  assert.ok(cam.yaw > 0 && cam.yaw < 1, `partial step: ${cam.yaw}`);
  for (let i = 0; i < 60; i++) cam.update(0.06);
  assert.ok(Math.abs(cam.yaw - 1) < 1e-3 && Math.abs(cam.pitch - 0.5) < 1e-3 && Math.abs(cam.distance - 5000) < 1);
});

test('panning shifts the target along the camera basis', () => {
  const cam = createCamera({ distance: 1000, yaw: 0, pitch: 0 });
  cam.setAspect(1);
  cam.viewportHeight = 1000;
  cam.snap();
  cam.update(0);
  cam.pan(100, 0);            // at yaw 0 the camera's right axis is -Z
  cam.snap();
  cam.update(0);
  assert.ok(Math.abs(cam.target[2]) > 1, `target moved along Z: ${cam.target[2]}`);
  assert.ok(Math.abs(cam.target[0]) < 1e-6, 'no shift along the view axis');

  const cam2 = createCamera({ distance: 1000, yaw: Math.PI / 2, pitch: 0 });
  cam2.setAspect(1);
  cam2.viewportHeight = 1000;
  cam2.snap();
  cam2.update(0);
  cam2.pan(100, 0);           // at yaw 90° the right axis is +X
  cam2.snap();
  cam2.update(0);
  assert.ok(Math.abs(cam2.target[0]) > 1, `target moved along X: ${cam2.target[0]}`);

  const cam3 = createCamera({ distance: 1000, yaw: 0, pitch: 0 });
  cam3.setAspect(1);
  cam3.viewportHeight = 1000;
  cam3.snap();
  cam3.update(0);
  cam3.pan(0, 100);           // dragging down raises the target (content follows the cursor)
  cam3.snap();
  cam3.update(0);
  assert.ok(cam3.target[1] > 1, `target rose: ${cam3.target[1]}`);
});

test('view-projection maps the target to the centre of the screen', () => {
  const cam = createCamera({ distance: 5000, yaw: 0.3, pitch: 0.2 });
  cam.setAspect(16 / 9);
  cam.snap();
  cam.update(0);
  const m = cam.viewProj;
  const x = 0, y = 0, z = 0, w = 1;
  const cx = m[0] * x + m[4] * y + m[8] * z + m[12] * w;
  const cy = m[1] * x + m[5] * y + m[9] * z + m[13] * w;
  const cw = m[3] * x + m[7] * y + m[11] * z + m[15] * w;
  assert.ok(Math.abs(cx / cw) < 1e-5 && Math.abs(cy / cw) < 1e-5, `ndc=(${cx / cw}, ${cy / cw})`);
});

test('pointer capture loss ends dragging and unrelated pointers cannot move the camera', () => {
  const cam=createCamera();
  const handlers=new Map();
  const el={style:{},setPointerCapture(){},addEventListener(k,v){handlers.set(k,v);},removeEventListener(k){handlers.delete(k);}};
  const detach=cam.attach(el);
  handlers.get('pointerdown')({button:0,pointerId:1,clientX:0,clientY:0});
  const yaw=cam.state.yawT;
  handlers.get('pointermove')({pointerId:2,clientX:200,clientY:0}); assert.equal(cam.state.yawT,yaw);
  handlers.get('lostpointercapture')();
  handlers.get('pointermove')({pointerId:1,clientX:200,clientY:0}); assert.equal(cam.state.yawT,yaw);
  detach();assert.equal(handlers.has('lostpointercapture'),false);
});
test('wheel delta modes use pixel-equivalent zoom', () => {
  function zoom(deltaY,deltaMode) {
    const cam=createCamera();const handlers=new Map();
    cam.attach({style:{},addEventListener(k,v){handlers.set(k,v);},removeEventListener(){}});
    let prevented=false;handlers.get('wheel')({deltaY,deltaMode,preventDefault(){prevented=true;}});
    assert.equal(prevented,true);cam.snap();return cam.distance;
  }
  assert.equal(zoom(16,0),zoom(1,1));assert.equal(zoom(1080,0),zoom(1,2));
});
