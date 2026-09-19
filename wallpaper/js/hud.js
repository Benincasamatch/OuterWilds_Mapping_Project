// Debug HUD — PLAN.md §1.2 verification surface: per-body measured angle vs the
// expected t/T, sun radius, active flags, event log, GPU/renderer info, fps.
// Plain DOM, updated at ~4 Hz (never per frame), zero allocation in the loop.

const VALUE_COLOR = '#7ee787';
const WARN_COLOR = '#ff7b72';

export function createHud({ mount, world }) {
  const root = document.createElement('div');
  root.id = 'ow-hud';
  mount.appendChild(root);

  const head = document.createElement('div');
  head.className = 'ow-hud-head';
  root.appendChild(head);

  const table = document.createElement('table');
  table.className = 'ow-hud-table';
  const tbody = document.createElement('tbody');
  table.appendChild(tbody);
  root.appendChild(table);

  const foot = document.createElement('div');
  foot.className = 'ow-hud-foot';
  root.appendChild(foot);

  // Preallocated rows: id, θmeasured, θexpected, Δ, period, variant
  const tracked = world.nodes.filter((n) => n.kind === 'circle' && n.parent && !n.virtual);
  const rows = tracked.map((n) => {
    const tr = document.createElement('tr');
    const cells = [];
    for (let i = 0; i < 5; i++) {
      const td = document.createElement('td');
      tr.appendChild(td);
      cells.push(td);
    }
    cells[0].textContent = n.id;
    tbody.appendChild(tr);
    return { node: n, cells };
  });

  const log = [];
  let lastUpdate = -1;
  // Two different rates matter: how often the loop ticks, and how often a frame is
  // actually drawn (the loop deliberately skips draws when idle — PLAN.md §1.2).
  let loopFps = 0, drawFps = 0, ticks = 0, draws0 = 0, t0 = -1;
  let gpuInfo = 'pending';
  let visible = true;

  const norm = (a) => { let d = a; while (d > Math.PI) d -= 2 * Math.PI; while (d < -Math.PI) d += 2 * Math.PI; return d; };

  const hud = {
    root,
    setVisible(v) { visible = v; root.style.display = v ? '' : 'none'; },
    setWorld(next) {
      world = next;
      for (const row of rows) row.node = next.nodeById.get(row.node.id);
      log.length = 0;
      lastUpdate = -1;
    },
    get visible() { return visible; },
    setGpuInfo(s) { gpuInfo = s; },
    tick(frame, camera, stats) {
      // rates over real time (a paused or resyncing clock must not fake them)
      const now = performance.now() / 1000;
      if (t0 < 0) { t0 = now; draws0 = stats?.draws ?? 0; }
      ticks++;
      const elapsed = now - t0;
      if (elapsed >= 1) {
        loopFps = ticks / elapsed;
        drawFps = ((stats?.draws ?? 0) - draws0) / elapsed;
        ticks = 0; draws0 = stats?.draws ?? 0; t0 = now;
      }
      if (!visible || now - lastUpdate < 0.25) return;
      lastUpdate = now;

      const scale = frame.scaleParams;
      head.textContent =
        `t = ${frame.t.toFixed(2)}s / ${frame.cycleS}s  ·  loop ${loopFps.toFixed(0)}/s  ·  draw ${drawFps.toFixed(0)}/s` +
        `  (${stats?.drawCalls ?? '-'} calls, ${(stats?.lastMs ?? 0).toFixed(2)} ms)` +
        `  ·  map p=${scale.p.toFixed(2)} kLocal=${scale.kLocal} kBody=${scale.kBody}${scale.realScale ? ' REAL SCALE' : ''}`;

      for (const r of rows) {
        const n = r.node;
        const p = n.parent ? world.nodeById.get(n.parent) : null;
        const i = world.ids.indexOf(n.id);
        const b = frame.bodies[i];
        const measured = Math.atan2(b.z - (p ? p.z : 0), b.x - (p ? p.x : 0));
        const expected = n.phaseRad + (Number.isFinite(n.periodS) ? (2 * Math.PI * frame.t) / n.periodS : 0);
        const d = norm(measured - expected);
        r.cells[1].textContent = ((measured * 180) / Math.PI).toFixed(1) + '°';
        r.cells[2].textContent = (((expected * 180) / Math.PI) % 360).toFixed(1) + '°';
        r.cells[3].textContent = (d * 1e6).toFixed(1) + 'e-6';
        r.cells[3].style.color = Math.abs(d) < 1e-6 ? VALUE_COLOR : WARN_COLOR;
        r.cells[4].textContent = `${n.periodS.toFixed(2)}s · ${b.variant}${b.visible ? '' : ' · hidden'}`;
      }

      const f = frame.flags;
      foot.innerHTML = [
        `sun R ${frame.sun.realRadius.toFixed(0)} m → ${frame.sun.visualRadius.toFixed(0)} vis (mix ${frame.sun.mix.toFixed(2)}, flash ${frame.sun.flash.toFixed(2)})`,
        `station opacity ${frame.sunStation.opacity.toFixed(2)}`,
        `sand ${f.sandFlowing ? 'on' : 'off'} · ice ${f.iceOpen ? 'open' : 'closed'} · crater ${f.craterLevel}/5`,
        `stranger ${f.strangerSails ? 'sails' : 'cloaked'} · probe ${f.probeLaunched ? 'launched' : 'docked'} · star extinction ${(f.starExtinction * 100).toFixed(0)}%`,
        `particles ${frame.particleCount}`,
        `event  ${log.length ? log[log.length - 1] : '—'}`,
        `gpu    ${gpuInfo}`,
        `keys   drag=rotate · wheel=zoom · middle drag=pan（H/P/R 仅浏览器内可用：WE 不转发键盘）`,
      ].join('<br>');
    },
    pushEvent(e, t) {
      log.push(`[${t.toFixed(1)}s] ${e.label} (${e.tolerance}/${e.source})`);
      if (log.length > 6) log.shift();
    },
  };
  return hud;
}
