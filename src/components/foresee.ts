import * as THREE from 'three';

// A toy version of Foresee's pipeline: monitor a lane-keeping car with a short-horizon
// forecast, keep the near misses, rank them, then fuzz around the best ones.

type State = { s: number; d: number; psi: number; v: number; delta: number };
type NearMiss = { id: number; score: number; s: number; snapshot: State; seed: number };
type Ghost = { pts: [number, number][]; failed: boolean };

type ForeseeElements = {
  canvas: HTMLCanvasElement;
  scoreBar: HTMLElement;
  scoreValue: HTMLElement;
  list: HTMLOListElement;
  result: HTMLElement;
  runButton: HTMLButtonElement;
  randomButton: HTMLButtonElement;
  status: HTMLElement;
};

const HALF_WIDTH = 3.2;
const WHEELBASE = 2.8;
const HORIZON = 1.6;
const NEAR_MISS = 0.78;
const VARIANTS = 24;

const COLOURS = { road: '#4a4c4b', edge: '#e9e7df', grass: '#9aa58c', car: '#faf8f1', forecast: '#ffd23f', fail: '#b3001b', ok: '#2f6f4f', ink: '#101311' };

function rng(seed: number) {
  let s = seed % 2147483647 || 1;
  return () => (s = (s * 16807) % 2147483647) / 2147483647;
}

export function startForesee(el: ForeseeElements) {
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)');

  // --- Track: a closed loop with bends of different tightness ---
  const curve = new THREE.CatmullRomCurve3(
    [
      [0, 0], [34, -4], [52, -26], [38, -52], [6, -46], [-10, -30], [-34, -42], [-52, -20], [-36, 6],
    ].map(([x, z]) => new THREE.Vector3(x, 0, z)),
    true,
    'centripetal',
  );
  const length = curve.getLength();
  const N = 1200;
  const samples = Array.from({ length: N }, (_, i) => {
    const u = i / N;
    const p = curve.getPointAt(u);
    const t = curve.getTangentAt(u);
    return { x: p.x, y: p.z, hx: t.x, hy: t.z };
  });
  const kappa = samples.map((_, i) => {
    const a = samples[(i - 2 + N) % N];
    const b = samples[(i + 2) % N];
    const ha = Math.atan2(a.hy, a.hx);
    const hb = Math.atan2(b.hy, b.hx);
    return Math.atan2(Math.sin(hb - ha), Math.cos(hb - ha)) / ((4 * length) / N);
  });
  const at = (s: number) => {
    const i = Math.floor((((s / length) % 1) + 1) % 1 * N) % N;
    return { ...samples[i], k: kappa[i] };
  };
  const world = (s: number, d: number) => {
    const p = at(s);
    return [p.x - p.hy * d, p.y + p.hx * d] as [number, number];
  };

  // --- Vehicle: kinematic bicycle in road coordinates, with a slightly over-eager speed
  // profile and a steering lag, so tight bends produce near misses and the odd failure ---
  function step(st: State, dt: number, noise: number) {
    const k = at(st.s).k;
    const kAhead = Math.max(Math.abs(at(st.s + 8).k), Math.abs(at(st.s + 14).k));
    const target = Math.min(15, Math.sqrt(8 / Math.max(kAhead, 1e-3)));
    st.v += THREE.MathUtils.clamp(target - st.v, -3 * dt, 1.6 * dt);
    const command = Math.atan(WHEELBASE * k * 0.85) - 0.07 * st.d - 0.6 * st.psi + noise;
    st.delta += (THREE.MathUtils.clamp(command, -0.5, 0.5) - st.delta) * Math.min(1, dt / 0.5);
    const ds = (st.v * Math.cos(st.psi)) / (1 - st.d * k);
    st.s += ds * dt;
    st.d += st.v * Math.sin(st.psi) * dt;
    st.psi += ((st.v * Math.tan(st.delta)) / WHEELBASE - k * ds) * dt;
  }

  function forecast(st: State) {
    const f = { ...st };
    const pts: [number, number][] = [];
    let peak = 0;
    for (let t = 0; t < HORIZON; t += 0.1) {
      step(f, 0.1, 0);
      peak = Math.max(peak, Math.abs(f.d) / HALF_WIDTH);
      pts.push(world(f.s, f.d));
    }
    return { pts, score: peak };
  }

  function simulate(start: State, seed: number, seconds: number): Ghost {
    const r = rng(seed);
    const st = { ...start };
    const pts: [number, number][] = [world(st.s, st.d)];
    for (let t = 0; t < seconds; t += 0.05) {
      step(st, 0.05, (r() - 0.5) * 0.06);
      if (Math.round(t * 20) % 3 === 0) pts.push(world(st.s, st.d));
      if (Math.abs(st.d) > HALF_WIDTH) return { pts, failed: true };
    }
    return { pts, failed: false };
  }

  const fuzz = (base: State, seed: number) => {
    const r = rng(seed);
    return {
      ...base,
      v: base.v * (1 + (r() - 0.35) * 0.3),
      d: base.d + (r() - 0.5) * 0.9,
      psi: base.psi + (r() - 0.5) * 0.08,
    };
  };

  // --- Live state ---
  let car: State = { s: 0, d: 0, psi: 0, v: 8, delta: 0 };
  const history: State[] = [];
  let nearMisses: NearMiss[] = [];
  let active: NearMiss | null = null;
  let ghosts: Ghost[] = [];
  let ghostProgress = 0;
  let failures = 0;
  let nextId = 1;
  let running = !reduceMotion.matches;
  let visible = true;
  let frameId = 0;
  let last = performance.now();
  let current = forecast(car);
  const noise = rng(7);

  // --- Rendering ---
  const ctx = el.canvas.getContext('2d')!;
  const bounds = samples.reduce(
    (b, p) => ({ minX: Math.min(b.minX, p.x), maxX: Math.max(b.maxX, p.x), minY: Math.min(b.minY, p.y), maxY: Math.max(b.maxY, p.y) }),
    { minX: Infinity, maxX: -Infinity, minY: Infinity, maxY: -Infinity },
  );
  let scale = 1;
  let ox = 0;
  let oy = 0;
  function resize() {
    const pr = Math.min(window.devicePixelRatio || 1, 2);
    const w = el.canvas.clientWidth;
    const h = el.canvas.clientHeight;
    el.canvas.width = Math.round(w * pr);
    el.canvas.height = Math.round(h * pr);
    ctx.setTransform(pr, 0, 0, pr, 0, 0);
    const pad = 14;
    scale = Math.min((w - pad * 2) / (bounds.maxX - bounds.minX), (h - pad * 2) / (bounds.maxY - bounds.minY));
    ox = (w - (bounds.maxX - bounds.minX) * scale) / 2 - bounds.minX * scale;
    oy = (h - (bounds.maxY - bounds.minY) * scale) / 2 - bounds.minY * scale;
    requestDraw();
  }
  const X = (p: [number, number]) => [ox + p[0] * scale, oy + p[1] * scale] as const;

  function strokePath(points: [number, number][], closed = false) {
    ctx.beginPath();
    points.forEach((p, i) => (i ? ctx.lineTo(...X(p)) : ctx.moveTo(...X(p))));
    if (closed) ctx.closePath();
    ctx.stroke();
  }

  const centre = samples.map((p) => [p.x, p.y] as [number, number]);
  function render() {
    const w = el.canvas.clientWidth;
    const h = el.canvas.clientHeight;
    ctx.fillStyle = COLOURS.grass;
    ctx.fillRect(0, 0, w, h);
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    ctx.strokeStyle = COLOURS.edge;
    ctx.lineWidth = (HALF_WIDTH * 2 + 0.6) * scale;
    strokePath(centre, true);
    ctx.strokeStyle = COLOURS.road;
    ctx.lineWidth = HALF_WIDTH * 2 * scale;
    strokePath(centre, true);
    ctx.setLineDash([4, 6]);
    ctx.strokeStyle = 'rgba(233, 231, 223, 0.6)';
    ctx.lineWidth = 1;
    strokePath(centre, true);
    ctx.setLineDash([]);

    // Ranked near misses on the track.
    nearMisses.forEach((nm, i) => {
      const [x, y] = X(world(nm.s, nm.snapshot.d));
      ctx.fillStyle = nm === active ? COLOURS.forecast : 'rgba(250, 248, 241, 0.9)';
      ctx.beginPath();
      ctx.arc(x, y, 9, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = COLOURS.ink;
      ctx.font = '600 11px ui-monospace, monospace';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(String(i + 1), x, y + 0.5);
    });

    // Fuzzed variants, drawn out progressively.
    for (const g of ghosts) {
      const n = Math.max(2, Math.floor(g.pts.length * ghostProgress));
      ctx.strokeStyle = g.failed ? COLOURS.fail : COLOURS.ok;
      ctx.globalAlpha = 0.55;
      ctx.lineWidth = 1.5;
      strokePath(g.pts.slice(0, n));
      ctx.globalAlpha = 1;
    }

    // The forecast ahead of the car, warmer as it nears the edge.
    current.pts.forEach((p, i) => {
      const [x, y] = X(p);
      ctx.fillStyle = current.score > NEAR_MISS ? '#ff6034' : COLOURS.forecast;
      ctx.globalAlpha = 1 - i / current.pts.length;
      ctx.beginPath();
      ctx.arc(x, y, 2.4, 0, Math.PI * 2);
      ctx.fill();
    });
    ctx.globalAlpha = 1;

    const [cx, cy] = X(world(car.s, car.d));
    const p = at(car.s);
    const heading = Math.atan2(p.hy, p.hx) + car.psi;
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(heading);
    ctx.fillStyle = COLOURS.car;
    ctx.strokeStyle = COLOURS.ink;
    ctx.lineWidth = 1;
    const L = Math.max(8, 4.6 * scale);
    const W = Math.max(4, 1.9 * scale);
    ctx.fillRect(-L / 2, -W / 2, L, W);
    ctx.strokeRect(-L / 2, -W / 2, L, W);
    ctx.restore();
  }

  // --- The pipeline UI ---
  function renderList() {
    el.list.replaceChildren(
      ...nearMisses.map((nm, i) => {
        const li = document.createElement('li');
        const button = document.createElement('button');
        button.type = 'button';
        button.className = nm === active ? 'is-active' : '';
        button.innerHTML = `<span>${i + 1}</span> Near miss, forecast ${Math.round(nm.score * 100)}% of the way to the edge <span class="fz-action">Fuzz</span>`;
        button.addEventListener('click', () => fuzzNearMiss(nm));
        li.append(button);
        return li;
      }),
    );
    el.randomButton.disabled = false;
  }

  function fuzzNearMiss(nm: NearMiss) {
    active = nm;
    ghosts = Array.from({ length: VARIANTS }, (_, i) => simulate(fuzz(nm.snapshot, nm.seed + i * 31), nm.seed + i, 4.5));
    ghostProgress = 0;
    const failed = ghosts.filter((g) => g.failed).length;
    el.result.innerHTML = `<strong>${failed} of ${VARIANTS}</strong> variants around near miss ${nearMisses.indexOf(nm) + 1} left the road.`;
    el.status.textContent = `${failed} of ${VARIANTS} fuzzed variants around this near miss failed.`;
    renderList();
    requestDraw(true);
  }

  function fuzzRandom() {
    active = null;
    const r = rng(nextId * 977 + 13);
    ghosts = Array.from({ length: VARIANTS }, (_, i) => {
      const s = r() * length;
      return simulate(fuzz({ s, d: 0, psi: 0, v: 9, delta: Math.atan(WHEELBASE * at(s).k) }, i * 53 + 5), i * 17 + 3, 4.5);
    });
    ghostProgress = 0;
    const failed = ghosts.filter((g) => g.failed).length;
    el.result.innerHTML = `<strong>${failed} of ${VARIANTS}</strong> variants started at random points left the road.`;
    el.status.textContent = `${failed} of ${VARIANTS} random variants failed.`;
    renderList();
    requestDraw(true);
  }

  // --- Loop ---
  let tracking: NearMiss | null = null;
  function tick(now: number) {
    frameId = 0;
    const dt = Math.min((now - last) / 1000, 0.05);
    last = now;
    if (running && visible && !document.hidden) {
      for (let i = 0; i < 2; i++) step(car, dt / 2, (noise() - 0.5) * 0.1);
      history.push({ ...car });
      if (history.length > 120) history.shift();
      current = forecast(car);

      // Monitor and classify: a forecast that nears the edge while the car stays on the road.
      if (current.score > NEAR_MISS && current.score < 1.6) {
        if (!tracking) {
          tracking = { id: nextId++, score: current.score, s: car.s, snapshot: { ...(history[Math.max(0, history.length - 40)] ?? car) }, seed: Math.floor(car.s * 10) };
        } else if (current.score > tracking.score) {
          tracking.score = current.score;
          tracking.s = car.s;
        }
      } else if (tracking) {
        // Rank: keep the five closest calls.
        if (!nearMisses.some((nm) => Math.abs(((nm.s - tracking!.s) % length + length) % length) < 15)) {
          nearMisses = [...nearMisses, tracking].sort((a, b) => b.score - a.score).slice(0, 5);
          renderList();
          el.status.textContent = `Near miss recorded, ranked ${nearMisses.indexOf(tracking) + 1} of ${nearMisses.length}.`;
        }
        tracking = null;
      }
      if (Math.abs(car.d) > HALF_WIDTH) {
        failures++;
        car = { ...car, d: 0, psi: 0, v: 6, delta: 0 };
      }
      const pct = Math.min(100, Math.round(current.score * 100));
      el.scoreBar.style.setProperty('--score', `${pct}%`);
      el.scoreBar.classList.toggle('is-near', current.score > NEAR_MISS);
      el.scoreValue.textContent = `${pct}%`;
    }
    if (ghosts.length && ghostProgress < 1) ghostProgress = Math.min(1, ghostProgress + dt / 1.2);
    render();
    if ((running && visible && !document.hidden) || (ghosts.length && ghostProgress < 1)) frameId = requestAnimationFrame(tick);
  }
  function requestDraw(force = false) {
    if (reduceMotion.matches && force) ghostProgress = 1;
    if (!frameId) {
      last = performance.now();
      frameId = requestAnimationFrame(tick);
    }
  }

  el.runButton.addEventListener('click', () => {
    running = !running;
    el.runButton.textContent = running ? 'Pause' : 'Drive';
    el.runButton.setAttribute('aria-pressed', String(running));
    requestDraw();
  });
  el.randomButton.addEventListener('click', fuzzRandom);
  el.runButton.textContent = running ? 'Pause' : 'Drive';
  el.runButton.setAttribute('aria-pressed', String(running));

  new ResizeObserver(resize).observe(el.canvas);
  new IntersectionObserver(([entry]) => {
    visible = entry.isIntersecting;
    if (visible) requestDraw();
  }).observe(el.canvas);
  document.addEventListener('visibilitychange', () => requestDraw());
  resize();
}
