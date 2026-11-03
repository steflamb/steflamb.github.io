import * as THREE from 'three';
import { loadFortuna } from './concept-lab';
import { buildStreet, type OsmMap } from './osm-world';

type DriveElements = {
  root: HTMLElement;
  simCanvas: HTMLCanvasElement;
  splatCanvas: HTMLCanvasElement;
  recorded: HTMLImageElement;
  status: HTMLElement;
  autopilot: HTMLButtonElement;
};

type Split = {
  scale: number;
  R: number[][];
  t: number[];
  mount: number[][];
  from: number;
  to: number;
  url: string;
  fy: number;
  width: number;
  height: number;
};
type Drive = { path: [number, number, number, number][]; splits: Split[]; map: OsmMap };
type Cameras = { poses: number[][]; frames: [number, string][] };

// The splats only cover views near the recorded drive, so the car stays in this corridor.
const MAX_OFFSET = 1.3; // metres either side of the recorded path
const MAX_HEADING = THREE.MathUtils.degToRad(28);
const MAX_SPEED = 9;

const mat3 = (m: number[][]) => new THREE.Matrix4().set(...m[0], 0, ...m[1], 0, ...m[2], 0, 0, 0, 0, 1);

export async function startCam2SimDrive({ root, simCanvas, splatCanvas, recorded, status, autopilot }: DriveElements) {
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
  const drive: Drive = await (await fetch('/cam2sim/drive.json')).json();
  const path = drive.path.map(([x, y, yaw, frame]) => ({ x, y, yaw, frame }));

  // Cumulative distance along the path, and the constant offset between odometry yaw and heading.
  const along: number[] = [0];
  for (let i = 1; i < path.length; i++) along.push(along[i - 1] + Math.hypot(path[i].x - path[i - 1].x, path[i].y - path[i - 1].y));
  const headingAt = (i: number) => {
    const a = path[Math.max(0, i - 1)];
    const b = path[Math.min(path.length - 1, i + 1)];
    return Math.atan2(b.y - a.y, b.x - a.x);
  };
  let yawOffset = 0;
  for (let i = 0; i < path.length; i++) yawOffset += Math.atan2(Math.sin(path[i].yaw - headingAt(i)), Math.cos(path[i].yaw - headingAt(i)));
  yawOffset /= path.length;

  // --- The simple simulator: the same road, a flat-shaded world, the scanned car ---

  const simRenderer = new THREE.WebGLRenderer({ canvas: simCanvas, antialias: true });
  simRenderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
  const sim = new THREE.Scene();
  sim.background = new THREE.Color('#c9d6dc');
  sim.add(new THREE.HemisphereLight('#eef3f5', '#5d6658', 1.5));
  const sun = new THREE.DirectionalLight('#fff4e2', 2);
  sun.position.set(40, 80, 20);
  sim.add(sun);
  const toWorld = (x: number, y: number) => new THREE.Vector3(x, 0, -y);

  function strip(offsetA: number, offsetB: number, height: number, color: string) {
    const positions: number[] = [];
    const indices: number[] = [];
    path.forEach((p, i) => {
      const h = headingAt(i);
      const nx = -Math.sin(h);
      const ny = Math.cos(h);
      const a = toWorld(p.x + nx * offsetA, p.y + ny * offsetA);
      const b = toWorld(p.x + nx * offsetB, p.y + ny * offsetB);
      positions.push(a.x, height, a.z, b.x, height, b.z);
      if (i < path.length - 1) indices.push(i * 2, i * 2 + 1, i * 2 + 2, i * 2 + 1, i * 2 + 3, i * 2 + 2);
    });
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geometry.setIndex(indices);
    geometry.computeVertexNormals();
    const material = new THREE.MeshStandardMaterial({ color, roughness: 0.95, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -height * 40 });
    return new THREE.Mesh(geometry, material);
  }
  sim.add(buildStreet(drive.map));

  // The corridor the generated view can follow, drawn as a faint guide on the street.
  sim.add(strip(-MAX_OFFSET, MAX_OFFSET, 0.04, '#5d605e'));

  const simCamera = new THREE.PerspectiveCamera(50, 16 / 10, 0.3, 800);
  let car: THREE.Object3D | null = null;
  loadFortuna().then((model) => {
    const box = new THREE.Box3().setFromObject(model);
    model.position.y = -box.min.y;
    model.traverse((child) => {
      const mesh = child as THREE.Mesh;
      if (mesh.isMesh) mesh.material = new THREE.MeshStandardMaterial({ color: '#e2e4e3', roughness: 0.4, metalness: 0.15 });
    });
    car = new THREE.Group().add(model);
    sim.add(car);
    requestDraw();
  });

  // The generated camera's footprint, drawn in the simulator.
  const frustum = new THREE.Mesh(
    new THREE.ConeGeometry(2.6, 7, 4, 1, true).rotateX(-Math.PI / 2).rotateZ(Math.PI / 4).translate(0, 0, -3.5),
    new THREE.MeshBasicMaterial({ color: '#ffd23f', transparent: true, opacity: 0.22, depthWrite: false, side: THREE.DoubleSide }),
  );
  frustum.scale.set(1, 0.3, 1);
  sim.add(frustum);

  // --- The generated view: Cam2Sim's Gaussian splats, rendered from the car's camera ---

  const { SparkRenderer, SplatMesh } = await import('@sparkjsdev/spark');
  const splatRenderer = new THREE.WebGLRenderer({ canvas: splatCanvas });
  splatRenderer.setPixelRatio(1);
  const splatScene = new THREE.Scene();
  // Static scenes of a few hundred thousand splats: no level-of-detail tree and no paged
  // splat pool, whose default reservation is large enough to take down Safari's GPU process.
  splatScene.add(
    new SparkRenderer({ renderer: splatRenderer, enableLod: false, enableLodFetching: false, maxPagedSplats: 65536 }),
  );
  // Safari and phones get the lighter cut of each segment.
  const ua = navigator.userAgent;
  const lite = (/Safari/.test(ua) && !/Chrome|Chromium|Edg\//.test(ua)) || window.matchMedia('(pointer: coarse)').matches;
  const sceneUrl = (split: Split) => (lite ? split.url.replace('scene.splat', 'scene-lite.splat') : split.url);
  const split0 = drive.splits[0];
  const splatCamera = new THREE.PerspectiveCamera(
    THREE.MathUtils.radToDeg(2 * Math.atan(split0.height / (2 * split0.fy))),
    split0.width / split0.height,
    0.0005,
    50,
  );

  const meshes: (InstanceType<typeof SplatMesh> | null)[] = drive.splits.map(() => null);
  const cameras: (Cameras | null)[] = drive.splits.map(() => null);
  const loading: Promise<void>[] = [];
  // One segment in memory at a time (plus the next, just before it is needed), to stay
  // within what phones and integrated GPUs can hold.
  function releaseSplit(k: number) {
    const mesh = meshes[k];
    if (!mesh) return;
    splatScene.remove(mesh);
    mesh.dispose();
    meshes[k] = null;
    delete loading[k];
  }

  function loadSplit(k: number) {
    if (loading[k]) return loading[k];
    const base = drive.splits[k].url.replace('scene.splat', '');
    loading[k] = Promise.all([
      fetch(`${base}cameras.json`).then((r) => r.json()),
      new Promise<InstanceType<typeof SplatMesh>>((resolve) => {
        const mesh = new SplatMesh({ url: sceneUrl(drive.splits[k]), lod: false });
        mesh.initialized.then(() => resolve(mesh));
      }),
    ]).then(([cams, mesh]) => {
      if (!loading[k]) {
        mesh.dispose();
        return;
      }
      cameras[k] = cams;
      mesh.visible = false;
      splatScene.add(mesh);
      meshes[k] = mesh;
      requestDraw();
    });
    return loading[k];
  }

  // --- Driving ---

  const state = { s: 2, offset: 0, heading: 0, speed: 0, split: 0 };
  const input = { forward: false, back: false, left: false, right: false };
  let auto = false;

  function nearestIndex(s: number) {
    let lo = 0;
    let hi = along.length - 1;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (along[mid] < s) lo = mid;
      else hi = mid;
    }
    return s - along[lo] < along[hi] - s ? lo : hi;
  }

  function carPose() {
    const i = nearestIndex(state.s);
    const j = Math.min(i + 1, path.length - 1);
    const f = along[j] > along[i] ? THREE.MathUtils.clamp((state.s - along[i]) / (along[j] - along[i]), 0, 1) : 0;
    const roadHeading = headingAt(i);
    const x = THREE.MathUtils.lerp(path[i].x, path[j].x, f) - Math.sin(roadHeading) * state.offset;
    const y = THREE.MathUtils.lerp(path[i].y, path[j].y, f) + Math.cos(roadHeading) * state.offset;
    return { i, x, y, heading: roadHeading + state.heading };
  }

  // Metric car pose to the split's camera: the fitted transform, corrected so that on the
  // recorded path it reproduces the recorded camera exactly.
  const fitted = (split: Split, x: number, y: number, heading: number) => {
    const m = mat3(split.R).multiply(new THREE.Matrix4().makeRotationZ(heading + yawOffset)).multiply(mat3(split.mount));
    const p = new THREE.Vector3(x, y, 0).applyMatrix4(mat3(split.R)).multiplyScalar(split.scale).add(new THREE.Vector3(...split.t));
    return m.setPosition(p);
  };

  function cameraPose(k: number, pose: ReturnType<typeof carPose>) {
    const split = drive.splits[k];
    const cams = cameras[k]!;
    const frame = THREE.MathUtils.clamp(path[pose.i].frame, split.from, split.to);
    const poseIndex = THREE.MathUtils.clamp(Math.round((frame - split.from) / 2), 0, cams.poses.length - 1);
    const r = cams.poses[poseIndex];
    const recordedPose = new THREE.Matrix4().set(...r.slice(0, 4), ...r.slice(4, 8), ...r.slice(8, 12), 0, 0, 0, 1);
    const p = path[pose.i];
    const correction = recordedPose.multiply(fitted(split, p.x, p.y, headingAt(pose.i)).invert());
    return correction.multiply(fitted(split, pose.x, pose.y, pose.heading));
  }

  function chooseSplit(frame: number) {
    const current = drive.splits[state.split];
    if (frame >= current.from + 20 && frame <= current.to - 20) return state.split;
    const k = drive.splits.findIndex((s) => frame >= s.from + 20 && frame <= s.to - 20);
    return k === -1 ? state.split : k;
  }

  let lastFrameName = '';
  function draw() {
    frameId = 0;
    const now = performance.now();
    const dt = Math.min((now - last) / 1000, 0.05);
    last = now;

    // Kinematics, relative to the road: speed, heading off the road direction, lateral offset.
    if (auto) {
      state.speed += (6 - state.speed) * Math.min(1, dt * 1.5);
      state.heading += (-state.offset * 0.25 - state.heading) * Math.min(1, dt * 2);
    } else {
      if (input.forward) state.speed += 4 * dt;
      else if (input.back) state.speed -= 6 * dt;
      else state.speed -= Math.sign(state.speed) * Math.min(Math.abs(state.speed), 2 * dt);
      const steer = (input.left ? 1 : 0) - (input.right ? 1 : 0);
      state.heading += steer * 0.9 * dt * Math.min(1, Math.abs(state.speed) / 3 + 0.2);
    }
    state.speed = THREE.MathUtils.clamp(state.speed, 0, MAX_SPEED);
    state.heading = THREE.MathUtils.clamp(state.heading, -MAX_HEADING, MAX_HEADING);
    state.s += Math.cos(state.heading) * state.speed * dt;
    state.offset += Math.sin(state.heading) * state.speed * dt;
    if (Math.abs(state.offset) > MAX_OFFSET) {
      state.offset = Math.sign(state.offset) * MAX_OFFSET;
      state.heading *= 0.5;
    }
    const end = along[along.length - 1] - 2;
    if (state.s >= end) {
      if (auto) state.s = 2;
      else {
        state.s = end;
        state.speed = 0;
      }
    }

    const pose = carPose();
    const pos = toWorld(pose.x, pose.y);
    const dir = new THREE.Vector3(Math.cos(pose.heading), 0, -Math.sin(pose.heading));
    if (car) {
      car.position.copy(pos);
      car.rotation.y = pose.heading - Math.PI / 2;
    }
    frustum.position.copy(pos).addScaledVector(dir, 0.8).setY(1.4);
    frustum.rotation.y = pose.heading - Math.PI / 2;
    simCamera.position.copy(pos).addScaledVector(dir, -9).setY(4.2);
    simCamera.lookAt(pos.clone().addScaledVector(dir, 8).setY(0.8));
    simRenderer.render(sim, simCamera);

    const k = chooseSplit(path[pose.i].frame);
    state.split = k;
    loadSplit(k);
    const nextSplit = drive.splits[k + 1];
    const nearEnd = nextSplit && path[pose.i].frame > nextSplit.from + 10;
    drive.splits.forEach((_, n) => {
      if (n === k) return;
      if (n === k + 1 && nearEnd) loadSplit(n);
      else releaseSplit(n);
    });
    if (meshes[k] && cameras[k]) {
      meshes.forEach((m, n) => m && (m.visible = n === k));
      cameraPose(k, pose).decompose(splatCamera.position, splatCamera.quaternion, new THREE.Vector3());
      splatRenderer.render(splatScene, splatCamera);
      status.textContent = `Segment ${k + 1} of 3 · ${Math.round(state.s)} m along Guerickestraße`;

      // Nearest recorded frame, for comparison.
      const frames = cameras[k]!.frames;
      const target = (path[pose.i].frame - drive.splits[k].from) / 2;
      let best = frames[0];
      for (const f of frames) if (Math.abs(f[0] - target) < Math.abs(best[0] - target)) best = f;
      if (best[1] !== lastFrameName) {
        lastFrameName = best[1];
        recorded.src = drive.splits[k].url.replace('scene.splat', `frames/${best[1]}`);
      }
    } else {
      status.textContent = `Loading segment ${k + 1} of 3…`;
    }

    if (running()) frameId = requestAnimationFrame(draw);
  }

  let frameId = 0;
  let last = performance.now();
  let visible = true;
  const running = () => visible && !document.hidden && (auto || state.speed > 0.01 || Object.values(input).some(Boolean));
  function requestDraw() {
    if (!frameId) {
      last = performance.now();
      frameId = requestAnimationFrame(draw);
    }
  }

  function resize() {
    for (const [renderer, canvas] of [
      [simRenderer, simCanvas],
      [splatRenderer, splatCanvas],
    ] as const) {
      const w = canvas.clientWidth;
      const h = canvas.clientHeight;
      if (w && h) renderer.setSize(w, h, false);
    }
    simCamera.aspect = simCanvas.clientWidth / Math.max(1, simCanvas.clientHeight);
    simCamera.updateProjectionMatrix();
    requestDraw();
  }
  new ResizeObserver(resize).observe(root);
  new IntersectionObserver(([entry]) => {
    visible = entry.isIntersecting;
    if (visible) requestDraw();
  }).observe(root);
  document.addEventListener('visibilitychange', requestDraw);

  // Keys only while the demo has focus, so the page still scrolls normally.
  const keyMap: Record<string, keyof typeof input> = {
    ArrowUp: 'forward',
    KeyW: 'forward',
    ArrowDown: 'back',
    KeyS: 'back',
    ArrowLeft: 'left',
    KeyA: 'left',
    ArrowRight: 'right',
    KeyD: 'right',
  };
  const setInput = (key: keyof typeof input, on: boolean) => {
    input[key] = on;
    if (on) setAuto(false);
    requestDraw();
  };
  root.addEventListener('keydown', (event) => {
    const key = keyMap[event.code];
    if (!key) return;
    event.preventDefault();
    setInput(key, true);
  });
  root.addEventListener('keyup', (event) => {
    const key = keyMap[event.code];
    if (key) setInput(key, false);
  });
  root.addEventListener('focusout', () => (Object.keys(input) as (keyof typeof input)[]).forEach((k) => (input[k] = false)));
  root.querySelectorAll<HTMLButtonElement>('[data-control]').forEach((button) => {
    const key = button.dataset.control as keyof typeof input;
    button.addEventListener('pointerdown', (event) => {
      event.preventDefault();
      button.setPointerCapture(event.pointerId);
      setInput(key, true);
    });
    const release = () => setInput(key, false);
    button.addEventListener('pointerup', release);
    button.addEventListener('pointercancel', release);
  });

  function setAuto(on: boolean) {
    auto = on;
    autopilot.setAttribute('aria-pressed', String(on));
    autopilot.textContent = on ? 'Take over' : 'Autopilot';
    requestDraw();
  }
  autopilot.addEventListener('click', () => setAuto(!auto));

  for (const [canvas, name] of [
    [simCanvas, 'simulator'],
    [splatCanvas, 'generated view'],
  ] as const) {
    canvas.addEventListener('webglcontextlost', (event) => {
      event.preventDefault();
      setAuto(false);
      status.textContent = `The graphics card dropped the ${name}. Reload the page to drive again.`;
    });
  }

  await loadSplit(0);
  resize();
  if (!reduceMotion.matches) setAuto(true);
}
