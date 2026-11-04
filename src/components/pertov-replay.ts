import * as THREE from 'three';
import { buildStreet, type OsmMap } from './osm-world';
import { loadFortuna } from './concept-lab';

type Run = {
  id: string;
  fn: string;
  scale: number | null;
  paper: string | null;
  family: string | null;
  outcome: string;
  code: string | null;
  completion: number | null;
  meanCte: number | null;
  maxCte: number | null;
  duration: number;
  pts: [number, number, number, number][]; // t, x east, y north, steering
};

type ReplayElements = {
  root: HTMLElement;
  mapSvg: SVGSVGElement;
  canvas: HTMLCanvasElement;
  steeringSvg: SVGSVGElement;
  form: HTMLFormElement;
  playButton: HTMLButtonElement;
  card: HTMLElement;
  readout: HTMLElement;
};

const SVG = 'http://www.w3.org/2000/svg';
const FAMILIES = ['Noise', 'Blur and focus', 'Weather and illumination', 'Distortion', 'Affine', 'Graphic patterns', 'Colour and tone'];

const label = (fn: string) =>
  fn
    .replace(/_filter$|_mapping$/, '')
    .replace(/_/g, ' ')
    .replace(/^./, (c) => c.toUpperCase());

export async function startPertovReplay(el: ReplayElements) {
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
  const [{ runs }, drive] = await Promise.all([
    fetch('/pertov/runs.json').then((r) => r.json() as Promise<{ runs: Run[] }>),
    fetch('/cam2sim/drive.json').then((r) => r.json() as Promise<{ map: OsmMap }>),
  ]);
  const nominal = runs.find((r) => r.id === 'nominal')!;
  const perturbed = runs.filter((r) => r.id !== 'nominal');

  // --- Controls: perturbation (grouped by the paper's families) and the intensities driven ---

  const select = el.form.querySelector('select') as HTMLSelectElement;
  const byFn = new Map<string, Run[]>();
  for (const run of perturbed) byFn.set(run.fn, [...(byFn.get(run.fn) ?? []), run]);
  const families = new Map<string, string[]>();
  for (const [fn, list] of byFn) {
    const family = list[0].family ?? 'Weather and illumination';
    families.set(family, [...(families.get(family) ?? []), fn]);
  }
  for (const family of FAMILIES) {
    const fns = families.get(family);
    if (!fns) continue;
    const group = document.createElement('optgroup');
    group.label = family;
    for (const fn of fns) {
      const paper = byFn.get(fn)![0].paper;
      group.append(new Option(paper ? `${label(fn)} · ${paper}` : label(fn), fn));
    }
    select.append(group);
  }
  select.value = byFn.has('dynamic_sun_filter') ? 'dynamic_sun_filter' : perturbed[0].fn;
  const scaleInputs = [...el.form.querySelectorAll<HTMLInputElement>('input[name="scale"]')];

  // --- Map: OSM street, nominal run, the selected run coloured by its distance from nominal ---

  const project = ([x, y]: number[]) => `${x.toFixed(2)},${(-y).toFixed(2)}`;
  const xs = nominal.pts.map((p) => p[1]);
  const ys = nominal.pts.map((p) => p[2]);
  const pad = 22;
  const box = { x: Math.min(...xs) - pad, y: -Math.max(...ys) - pad, w: Math.max(...xs) - Math.min(...xs) + pad * 2, h: Math.max(...ys) - Math.min(...ys) + pad * 2 };
  el.mapSvg.setAttribute('viewBox', `${box.x} ${box.y} ${box.w} ${box.h}`);
  const node = (tag: string, attrs: Record<string, string | number>, parent: Element = el.mapSvg) => {
    const n = document.createElementNS(SVG, tag);
    for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, String(v));
    parent.append(n);
    return n;
  };
  const base = node('g', { class: 'pv-base' });
  for (const pts of drive.map.green) node('polygon', { points: pts.map(project).join(' '), class: 'pv-green' }, base);
  for (const road of drive.map.roads) node('polyline', { points: road.pts.map(project).join(' '), class: 'pv-road', 'stroke-width': road.w + 4 }, base);
  for (const road of drive.map.roads) node('polyline', { points: road.pts.map(project).join(' '), class: 'pv-asphalt', 'stroke-width': road.w }, base);
  for (const b of drive.map.buildings) node('polygon', { points: b.pts.map(project).join(' '), class: 'pv-building' }, base);
  node('polyline', { points: nominal.pts.map((p) => project([p[1], p[2]])).join(' '), class: 'pv-nominal' });
  const runLayer = node('g', {});
  const endMarker = node('g', { class: 'pv-end' });
  const carMarker = node('circle', { r: 1.6, class: 'pv-car' });

  const nominalXY = nominal.pts.map((p) => new THREE.Vector2(p[1], p[2]));
  const distanceToNominal = (x: number, y: number) => {
    let best = Infinity;
    const p = new THREE.Vector2(x, y);
    for (let i = 0; i < nominalXY.length - 1; i++) {
      const a = nominalXY[i];
      const ab = nominalXY[i + 1].clone().sub(a);
      const t = THREE.MathUtils.clamp(p.clone().sub(a).dot(ab) / Math.max(ab.lengthSq(), 1e-9), 0, 1);
      best = Math.min(best, p.distanceTo(a.clone().addScaledVector(ab, t)));
    }
    return best;
  };
  const deviationColour = (d: number) => (d < 0.5 ? '#2f6f4f' : d < 1.2 ? '#e0a800' : d < 2.5 ? '#ff6034' : '#b3001b');

  // The car a collision run hit: parked at the kerb on the side the run was drifting towards,
  // parallel to the street, just ahead of where the recording stops.
  const street = drive.map.roads.filter((r) => r.name === 'Guerickestraße');
  function collisionPose(r: Run) {
    if (r.pts.length < 2 || !street.length) return null;
    const end = r.pts[r.pts.length - 1];
    const p = new THREE.Vector2(end[1], end[2]);
    let best = { dist: Infinity, q: p, t: new THREE.Vector2(1, 0), w: 7 };
    for (const road of street) {
      for (let i = 0; i < road.pts.length - 1; i++) {
        const a = new THREE.Vector2(...(road.pts[i] as [number, number]));
        const ab = new THREE.Vector2(...(road.pts[i + 1] as [number, number])).sub(a);
        const f = THREE.MathUtils.clamp(p.clone().sub(a).dot(ab) / Math.max(ab.lengthSq(), 1e-9), 0, 1);
        const q = a.clone().addScaledVector(ab, f);
        if (q.distanceTo(p) < best.dist) best = { dist: q.distanceTo(p), q, t: ab.normalize(), w: road.w };
      }
    }
    const travel = smoothed(r);
    const last = travel[travel.length - 1];
    const dir = new THREE.Vector2(Math.cos(last[3]), Math.sin(last[3]));
    const t = best.t.dot(dir) < 0 ? best.t.clone().negate() : best.t.clone();
    const left = new THREE.Vector2(-t.y, t.x);
    // Which kerb: the way the run drifted from the nominal run where it stopped, or failing
    // that, the way it was turning relative to the nominal run's direction there.
    let near = { dist: Infinity, q: p, t: t };
    for (let i = 0; i < nominal.pts.length - 1; i++) {
      const a = new THREE.Vector2(nominal.pts[i][1], nominal.pts[i][2]);
      const ab = new THREE.Vector2(nominal.pts[i + 1][1], nominal.pts[i + 1][2]).sub(a);
      const f = THREE.MathUtils.clamp(p.clone().sub(a).dot(ab) / Math.max(ab.lengthSq(), 1e-9), 0, 1);
      const q = a.clone().addScaledVector(ab, f);
      if (q.distanceTo(p) < near.dist) near = { dist: q.distanceTo(p), q, t: ab.clone().normalize() };
    }
    const nominalLeft = new THREE.Vector2(-near.t.y, near.t.x);
    const drift = p.clone().sub(near.q).dot(nominalLeft);
    const turning = dir.dot(nominalLeft);
    const towardsLeft = Math.abs(drift) > 0.15 ? drift > 0 : turning > 0;
    const side = towardsLeft === nominalLeft.dot(left) > 0 ? 1 : -1;
    // Just ahead of where the recording stops, overlapping Fortuna's front corner on that side,
    // and never past the kerb.
    const egoOffset = p.clone().sub(best.q).dot(left);
    const kerb = best.w / 2 - 0.95;
    const offset = THREE.MathUtils.clamp(egoOffset + side * 1.1, -kerb, kerb);
    const spot = best.q.clone().addScaledVector(t, 4.1).addScaledVector(left, offset);
    return { x: spot.x, y: spot.y, heading: Math.atan2(t.y, t.x) };
  }

  function drawRun(run: Run) {
    runLayer.replaceChildren();
    endMarker.replaceChildren();
    for (let i = 0; i < run.pts.length - 1; i++) {
      const [, x0, y0] = run.pts[i];
      const [, x1, y1] = run.pts[i + 1];
      node('line', { x1: x0, y1: -y0, x2: x1, y2: -y1, stroke: deviationColour(distanceToNominal(x0, y0)), class: 'pv-run' }, runLayer);
    }
    const last = run.pts[run.pts.length - 1] ?? nominal.pts[0];
    if (run.code === 'cc' && run.pts.length > 1) {
      const c = collisionPose(run)!;
      node('rect', {
        x: c.x - 2.3, y: -c.y - 0.95, width: 4.6, height: 1.9, rx: 0.4, class: 'pv-other',
        transform: `rotate(${(-c.heading * 180) / Math.PI} ${c.x} ${-c.y})`,
      }, endMarker);
    }
    if (run.code && run.code !== 'n') {
      const [x, y] = [last[1], -last[2]];
      node('path', { d: `M${x - 2.2},${y - 2.2}L${x + 2.2},${y + 2.2}M${x + 2.2},${y - 2.2}L${x - 2.2},${y + 2.2}`, class: 'pv-cross' }, endMarker);
    }
  }

  // --- Steering: the recorded steering signal of the run against the nominal run ---

  const steerRange = 4; // recorded steering spans about ±4
  const fitSteering = (r: Run) => {
    const span = Math.max(r.duration, nominal.duration);
    el.steeringSvg.setAttribute('viewBox', `0 -${steerRange} ${span} ${steerRange * 2}`);
    axis.setAttribute('x2', String(span));
  };
  el.steeringSvg.setAttribute('preserveAspectRatio', 'none');
  const steerNode = (cls: string) => node('polyline', { class: cls, 'vector-effect': 'non-scaling-stroke' }, el.steeringSvg);
  const axis = node('line', { x1: 0, y1: 0, x2: 1, y2: 0, class: 'pv-axis', 'vector-effect': 'non-scaling-stroke' }, el.steeringSvg);
  const steerNominal = steerNode('pv-steer-nominal');
  const steerRun = steerNode('pv-steer-run');
  const playhead = node('line', { y1: -steerRange, y2: steerRange, class: 'pv-playhead', 'vector-effect': 'non-scaling-stroke' }, el.steeringSvg);
  const steerPoints = (run: Run) => run.pts.map((p) => `${p[0].toFixed(2)},${(-THREE.MathUtils.clamp(p[3], -steerRange, steerRange)).toFixed(3)}`).join(' ');
  steerNominal.setAttribute('points', steerPoints(nominal));

  // --- Bird's-eye replay in the simulator: Fortuna on the OSM street, camera following ---

  const renderer = new THREE.WebGLRenderer({ canvas: el.canvas, antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
  const scene = new THREE.Scene();
  scene.background = new THREE.Color('#c9d6dc');
  scene.add(new THREE.HemisphereLight('#eef3f5', '#5d6658', 1.5));
  const sun = new THREE.DirectionalLight('#fff4e2', 2);
  sun.position.set(40, 80, 20);
  scene.add(sun);
  scene.add(buildStreet(drive.map));
  const camera = new THREE.PerspectiveCamera(40, 16 / 10, 1, 800);
  const carMaterial = new THREE.MeshStandardMaterial({ color: '#f2f3f1', roughness: 0.4, metalness: 0.15 });
  const otherMaterial = new THREE.MeshStandardMaterial({ color: '#56606a', roughness: 0.5, metalness: 0.2 });
  const ego = new THREE.Group();
  const other = new THREE.Group();
  other.visible = false;
  scene.add(ego, other);
  loadFortuna().then((model) => {
    const box = new THREE.Box3().setFromObject(model);
    model.position.y = -box.min.y;
    const tinted = (m: THREE.Object3D, material: THREE.Material) => {
      m.traverse((child) => {
        if ((child as THREE.Mesh).isMesh) (child as THREE.Mesh).material = material;
      });
      return m;
    };
    ego.add(tinted(model, carMaterial));
    other.add(tinted(model.clone(), otherMaterial));
    requestDraw();
  });

  // The nominal run and the selected run, drawn on the road.
  const trail = (points: number[][], color: THREE.ColorRepresentation, colors?: number[]) => {
    const geometry = new THREE.BufferGeometry().setFromPoints(points.map(([x, y]) => new THREE.Vector3(x, 0.08, -y)));
    if (colors) geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
    return new THREE.Line(geometry, new THREE.LineBasicMaterial({ color, vertexColors: !!colors }));
  };
  scene.add(trail(nominal.pts.map((p) => [p[1], p[2]]), '#101311'));
  let runTrail: THREE.Line | null = null;
  const camPos = new THREE.Vector3();
  const camLook = new THREE.Vector3();
  let snapCamera = true;

  // --- Playback ---

  let run: Run = perturbed[0];
  let time = 0;
  let playing = !reduceMotion.matches;
  let visible = true;
  let frameId = 0;
  let last = performance.now();

  // GPS jitters while the car is slow, so replay a smoothed copy: positions averaged over
  // neighbouring samples, heading taken over a few metres and eased along the run.
  const smoothCache = new Map<Run, [number, number, number, number][]>();
  function smoothed(r: Run) {
    if (smoothCache.has(r)) return smoothCache.get(r)!;
    const raw = r.pts.length ? r.pts : nominal.pts.slice(0, 2);
    const win = 4;
    const pos = raw.map((p, i) => {
      let x = 0, y = 0, n = 0;
      for (let k = Math.max(0, i - win); k <= Math.min(raw.length - 1, i + win); k++) {
        x += raw[k][1];
        y += raw[k][2];
        n++;
      }
      return [p[0], x / n, y / n, p[3]] as [number, number, number, number];
    });
    let heading = 0;
    let unwrapped = 0;
    const out = pos.map((p, i) => {
      let j = i, k = i;
      while (j < pos.length - 1 && Math.hypot(pos[j][1] - p[1], pos[j][2] - p[2]) < 3) j++;
      while (k > 0 && Math.hypot(pos[j][1] - pos[k][1], pos[j][2] - pos[k][2]) < 4) k--;
      const raw = Math.atan2(pos[j][2] - pos[k][2], pos[j][1] - pos[k][1]);
      if (i === 0) unwrapped = heading = raw;
      unwrapped += Math.atan2(Math.sin(raw - unwrapped), Math.cos(raw - unwrapped));
      heading += (unwrapped - heading) * 0.25;
      return [p[0], p[1], p[2], heading] as [number, number, number, number];
    });
    smoothCache.set(r, out);
    return out;
  }

  function sample(r: Run, t: number) {
    const pts = smoothed(r);
    let i = 0;
    while (i < pts.length - 2 && pts[i + 1][0] < t) i++;
    const a = pts[i];
    const b = pts[Math.min(i + 1, pts.length - 1)];
    const f = b[0] > a[0] ? THREE.MathUtils.clamp((t - a[0]) / (b[0] - a[0]), 0, 1) : 0;
    return {
      x: THREE.MathUtils.lerp(a[1], b[1], f),
      y: THREE.MathUtils.lerp(a[2], b[2], f),
      heading: THREE.MathUtils.lerp(a[3], b[3], f),
    };
  }

  function draw(now: number) {
    frameId = 0;
    const dt = Math.min((now - last) / 1000, 0.05);
    last = now;
    const end = run.pts.length ? run.pts[run.pts.length - 1][0] : 0;
    if (playing && visible && !document.hidden) {
      time += dt;
      if (time > end + 2) time = 0;
    }
    const pose = sample(run, Math.min(time, end));
    ego.position.set(pose.x, 0, -pose.y);
    ego.rotation.y = pose.heading - Math.PI / 2;
    // Bird's-eye follow: high above and a little behind, rotating with the car.
    const back = new THREE.Vector3(-Math.cos(pose.heading), 0, Math.sin(pose.heading));
    const wantPos = ego.position.clone().addScaledVector(back, 9).setY(32);
    const wantLook = ego.position.clone().addScaledVector(back, -6);
    const ease = snapCamera ? 1 : 1 - Math.exp(-dt * 2);
    camPos.lerp(wantPos, ease);
    camLook.lerp(wantLook, ease);
    snapCamera = false;
    camera.position.copy(camPos);
    camera.lookAt(camLook);
    renderer.render(scene, camera);

    carMarker.setAttribute('cx', String(pose.x));
    carMarker.setAttribute('cy', String(-pose.y));
    playhead.setAttribute('x1', String(time));
    playhead.setAttribute('x2', String(time));
    el.readout.textContent = `${run.fn}(scale=${run.scale}) · ${Math.min(time, end).toFixed(1)} s`;

    if (playing && visible && !document.hidden) frameId = requestAnimationFrame(draw);
  }
  const requestDraw = () => {
    if (!frameId) {
      last = performance.now();
      frameId = requestAnimationFrame(draw);
    }
  };

  function showCard(r: Run) {
    // A run missing from the failure table that completed the whole route was a success.
    if (!r.code && r.completion != null && r.completion >= 99.9) {
      r.code = 'n';
      r.outcome = 'Completed the route';
    }
    const failed = r.code && r.code !== 'n';
    const rows: [string, string][] = [
      ['Perturbation', `${r.fn}${r.paper ? ` (${r.paper})` : ''}`],
      ['Intensity', String(r.scale)],
      ['Outcome', r.outcome],
      ['Route completed', r.completion == null ? '—' : `${Math.round(r.completion)}%`],
      ['Cross-track error', r.meanCte == null ? '—' : `${r.meanCte.toFixed(2)} m mean · ${r.maxCte!.toFixed(2)} m max`],
      ['Recorded', r.pts.length ? `${r.duration.toFixed(1)} s` : 'No trajectory: the vehicle did not get under way'],
    ];
    el.card.replaceChildren(
      ...rows.flatMap(([k, v]) => {
        const dt = document.createElement('dt');
        dt.textContent = k;
        const dd = document.createElement('dd');
        dd.textContent = v;
        if (k === 'Outcome') dd.className = failed ? 'pv-fail' : 'pv-ok';
        return [dt, dd];
      }),
    );
  }

  function selectRun() {
    const list = byFn.get(select.value)!;
    const scales = new Set(list.map((r) => r.scale));
    for (const input of scaleInputs) input.disabled = !scales.has(Number(input.value));
    let chosen = scaleInputs.find((i) => i.checked && !i.disabled);
    if (!chosen) {
      chosen = [...scaleInputs].reverse().find((i) => !i.disabled)!;
      chosen.checked = true;
    }
    run = list.find((r) => r.scale === Number(chosen!.value))!;
    time = 0;
    snapCamera = true;
    drawRun(run);
    if (runTrail) scene.remove(runTrail);
    if (run.pts.length > 1) {
      const colors = run.pts.flatMap((p) => new THREE.Color(deviationColour(distanceToNominal(p[1], p[2]))).toArray());
      runTrail = trail(run.pts.map((p) => [p[1], p[2]]), '#ffffff', colors);
      scene.add(runTrail);
    }
    const hit = run.code === 'cc' ? collisionPose(run) : null;
    other.visible = !!hit;
    if (hit) {
      other.position.set(hit.x, 0, -hit.y);
      other.rotation.y = hit.heading - Math.PI / 2;
    }
    steerRun.setAttribute('points', steerPoints(run));
    fitSteering(run);
    showCard(run);
    requestDraw();
  }

  function setPlaying(on: boolean) {
    playing = on;
    el.playButton.textContent = on ? 'Pause' : 'Replay';
    el.playButton.setAttribute('aria-pressed', String(on));
    requestDraw();
  }

  el.form.addEventListener('input', selectRun);
  el.form.addEventListener('submit', (e) => e.preventDefault());
  el.playButton.addEventListener('click', () => setPlaying(!playing));

  function resize() {
    const w = el.canvas.clientWidth;
    const h = el.canvas.clientHeight;
    if (!w || !h) return;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    requestDraw();
  }
  new ResizeObserver(resize).observe(el.canvas);
  new IntersectionObserver(([entry]) => {
    visible = entry.isIntersecting;
    if (visible) requestDraw();
  }).observe(el.root);
  document.addEventListener('visibilitychange', requestDraw);

  selectRun();
  setPlaying(playing);
  resize();
}
