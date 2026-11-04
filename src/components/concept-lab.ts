import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js';
import { MODE, RANDOM_PER_IMAGE, perturbationFragment, perturbationVertex } from './perturbations';

type LabElements = { stage: HTMLElement; canvas: HTMLCanvasElement; form: HTMLFormElement; autoplay?: boolean };

const ROAD_WIDTH = 7;
const SPEED = 9; // m/s, about 32 km/h

export function loadFortuna() {
  const draco = new DRACOLoader();
  draco.setDecoderPath('/draco/');
  const loader = new GLTFLoader();
  loader.setDRACOLoader(draco);
  return loader.loadAsync('/models/fortuna.glb').then((gltf) => gltf.scene);
}

// --- A small closed test track ---

function ribbon(curve: THREE.Curve<THREE.Vector3>, from: number, to: number, y: number, segments: number) {
  const positions: number[] = [];
  const indices: number[] = [];
  const up = new THREE.Vector3(0, 1, 0);
  for (let i = 0; i <= segments; i++) {
    const u = i / segments;
    const p = curve.getPointAt(u);
    const side = curve.getTangentAt(u).cross(up).normalize();
    const a = p.clone().addScaledVector(side, from);
    const b = p.clone().addScaledVector(side, to);
    positions.push(a.x, y, a.z, b.x, y, b.z);
    if (i < segments) {
      const k = i * 2;
      indices.push(k, k + 1, k + 2, k + 1, k + 3, k + 2);
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
}

function buildTrack() {
  const world = new THREE.Group();
  const flat = (color: string) => new THREE.MeshStandardMaterial({ color, roughness: 0.95, side: THREE.DoubleSide });

  const curve = new THREE.CatmullRomCurve3(
    [
      [0, 0],
      [34, -4],
      [52, -26],
      [38, -52],
      [6, -46],
      [-10, -30],
      [-34, -42],
      [-52, -20],
      [-36, 6],
    ].map(([x, z]) => new THREE.Vector3(x, 0, z)),
    true,
    'centripetal',
  );
  const length = curve.getLength();
  const segments = Math.round(length * 1.5);

  const grass = new THREE.Mesh(new THREE.PlaneGeometry(600, 600), flat('#71885c'));
  grass.rotation.x = -Math.PI / 2;
  world.add(grass);
  world.add(new THREE.Mesh(ribbon(curve, -ROAD_WIDTH / 2, ROAD_WIDTH / 2, 0.01, segments), flat('#3b3d3c')));

  // Road paint sits just above the asphalt; offset in depth so it never fights it at range.
  const paint = new THREE.MeshStandardMaterial({
    color: '#e9e7df',
    roughness: 0.9,
    side: THREE.DoubleSide,
    polygonOffset: true,
    polygonOffsetFactor: -2,
    polygonOffsetUnits: -2,
  });
  world.add(new THREE.Mesh(ribbon(curve, ROAD_WIDTH / 2 - 0.3, ROAD_WIDTH / 2 - 0.15, 0.02, segments), paint));
  world.add(new THREE.Mesh(ribbon(curve, -ROAD_WIDTH / 2 + 0.15, -ROAD_WIDTH / 2 + 0.3, 0.02, segments), paint));

  // Dashed centre line, drawn as short ribbons.
  const dashes = new THREE.Group();
  for (let s = 0; s < length; s += 9) {
    const sub = new THREE.CurvePath<THREE.Vector3>();
    const u0 = s / length;
    const u1 = Math.min((s + 3) / length, 1);
    sub.add(new THREE.LineCurve3(curve.getPointAt(u0), curve.getPointAt(u1)));
    dashes.add(new THREE.Mesh(ribbon(sub, -0.07, 0.07, 0.02, 1), paint));
  }
  world.add(dashes);

  // Cones along the outside of each bend; trees and buildings beyond the track.
  const up = new THREE.Vector3(0, 1, 0);
  const coneMaterial = flat('#f05a28');
  const coneGeometry = new THREE.ConeGeometry(0.18, 0.55, 16);
  for (let s = 0; s < length; s += 12) {
    const u = s / length;
    const p = curve.getPointAt(u);
    const side = curve.getTangentAt(u).cross(up).normalize();
    for (const sign of [-1, 1]) {
      const cone = new THREE.Mesh(coneGeometry, coneMaterial);
      cone.position.copy(p).addScaledVector(side, sign * (ROAD_WIDTH / 2 + 0.9)).setY(0.275);
      world.add(cone);
    }
  }

  const samples = curve.getSpacedPoints(200);
  const clearOfTrack = (x: number, z: number, margin: number) =>
    samples.every((p) => Math.hypot(p.x - x, p.z - z) > margin);
  let seed = 11;
  const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  const leaves = flat('#3f5a35');
  const trunk = flat('#4a3b2c');
  for (let placed = 0, tries = 0; placed < 90 && tries < 2000; tries++) {
    const x = (rand() * 2 - 1) * 110;
    const z = 20 - rand() * 150;
    if (!clearOfTrack(x, z, 9)) continue;
    const h = 4 + rand() * 5;
    const crown = new THREE.Mesh(new THREE.ConeGeometry(1.5 + rand(), h, 7), leaves);
    crown.position.set(x, 1.5 + h / 2, z);
    const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.2, 1.6, 6), trunk);
    stem.position.set(x, 0.8, z);
    world.add(crown, stem);
    placed++;
  }
  const concrete = flat('#a9aba6');
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * Math.PI * 2;
    const w = 14 + rand() * 16;
    const h = 10 + rand() * 22;
    const block = new THREE.Mesh(new THREE.BoxGeometry(w, h, 12 + rand() * 10), concrete);
    block.position.set(Math.cos(a) * 140, h / 2, -25 + Math.sin(a) * 120);
    block.rotation.y = a;
    world.add(block);
  }

  world.add(new THREE.HemisphereLight('#e6eef0', '#4c5e41', 1.4));
  const sun = new THREE.DirectionalLight('#fff3df', 2.2);
  sun.position.set(40, 60, 30);
  world.add(sun);

  return { world, curve, length };
}

// The library's object overlay pastes the TUM logo; drawn here as a wordmark in TUM blue.
function logoTexture() {
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 256;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = '#3070b3';
  ctx.font = '700 200px "Helvetica Neue", Helvetica, Arial, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('TUM', 256, 140);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.NoColorSpace;
  return texture;
}

// --- The lab ---

export async function startPerturbationLab({ stage, canvas, form, autoplay }: LabElements) {
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
  const readout = stage.querySelector('#lab-readout') as HTMLElement;
  const hud = stage.querySelector('#lab-hud') as HTMLElement;
  const meter = stage.querySelector('#lab-meter') as HTMLElement;
  const rec = stage.querySelector('#lab-rec') as HTMLElement;
  const timecode = stage.querySelector('#lab-tc') as HTMLElement;
  const loading = stage.querySelector('#lab-loading') as HTMLElement;
  const status = form.querySelector('#lab-status') as HTMLElement;
  const select = form.querySelector('#lab-perturbation') as HTMLSelectElement;
  const playButton = form.querySelector('#lab-play') as HTMLButtonElement;

  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  const pixelRatio = Math.min(window.devicePixelRatio || 1, 1.5);
  renderer.setPixelRatio(pixelRatio);

  const scene = new THREE.Scene();
  scene.background = new THREE.Color('#bdd3dc');
  const { world, curve, length } = buildTrack();
  scene.add(world);

  const camera = new THREE.PerspectiveCamera(55, 16 / 10, 0.5, 500);
  const target = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType });
  const small = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType });
  target.depthTexture = new THREE.DepthTexture(1, 1);

  const post = new THREE.ShaderMaterial({
    vertexShader: perturbationVertex,
    fragmentShader: perturbationFragment,
    uniforms: {
      tColor: { value: target.texture },
      tLogo: { value: logoTexture() },
      tDepth: { value: target.depthTexture },
      tSmall: { value: small.texture },
      uNear: { value: camera.near },
      uFar: { value: camera.far },
      uMode: { value: 0 },
      uScale: { value: 2 },
      uTime: { value: 0 },
      uSeed: { value: 0 },
      uRes: { value: new THREE.Vector2(1, 1) },
    },
    depthTest: false,
    depthWrite: false,
  });
  // 8x box downsample of the frame, feeding the wide blurs.
  const downsample = new THREE.ShaderMaterial({
    vertexShader: perturbationVertex,
    fragmentShader: /* glsl */ `
      uniform sampler2D tColor;
      uniform vec2 uTexel;
      varying vec2 vUv;
      void main() {
        vec3 s = vec3(0.0);
        for (int i = 0; i < 4; i++) for (int j = 0; j < 4; j++)
          s += texture2D(tColor, vUv + (vec2(i, j) - 1.5) * 2.0 * uTexel).rgb;
        gl_FragColor = vec4(s / 16.0, 1.0);
      }
    `,
    uniforms: { tColor: { value: target.texture }, uTexel: { value: new THREE.Vector2() } },
    depthTest: false,
    depthWrite: false,
  });
  const downsampleScene = new THREE.Scene();
  downsampleScene.add(new THREE.Mesh(new THREE.PlaneGeometry(2, 2), downsample));

  const postScene = new THREE.Scene();
  postScene.add(new THREE.Mesh(new THREE.PlaneGeometry(2, 2), post));
  const postCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);

  const state = { id: select.value, scale: 2, playing: autoplay || !reduceMotion.matches };
  let car: THREE.Object3D | null = null;
  let progress = 0.02; // fraction of the lap
  let visible = true;
  let frameId = 0;
  let last = performance.now();
  let clock = 0;
  let frames = 0;

  // Chase camera, eased behind the car.
  const camPos = new THREE.Vector3();
  const camLook = new THREE.Vector3();
  const up = new THREE.Vector3(0, 1, 0);

  function placeCar(snap: boolean, dt: number) {
    const u = ((progress % 1) + 1) % 1;
    const p = curve.getPointAt(u);
    const dir = curve.getTangentAt(u);
    const right = dir.clone().cross(up).normalize();
    // Keep to the right-hand lane.
    p.addScaledVector(right, ROAD_WIDTH / 4);
    if (car) {
      car.position.set(p.x, car.position.y, p.z);
      car.rotation.y = Math.atan2(-dir.x, -dir.z);
    }
    const wantPos = p.clone().addScaledVector(dir, -7.5).setY(2.9);
    const wantLook = p.clone().addScaledVector(dir, 6).setY(1.1);
    const ease = snap ? 1 : 1 - Math.exp(-dt * 3.5);
    camPos.lerp(wantPos, ease);
    camLook.lerp(wantLook, ease);
    camera.position.copy(camPos);
    camera.lookAt(camLook);
  }

  placeCar(true, 0);

  function running() {
    return state.playing && visible && !document.hidden && !!car;
  }

  function draw(now: number) {
    frameId = 0;
    const dt = Math.min((now - last) / 1000, 0.05);
    last = now;
    if (running()) {
      progress += (SPEED * dt) / length;
      clock += dt;
      frames++;
      placeCar(false, dt);
    }
    post.uniforms.uMode.value = MODE[state.id] ?? 0;
    post.uniforms.uScale.value = state.scale;
    post.uniforms.uTime.value = clock;
    // Random-per-image perturbations re-roll a few times a second, like a fresh camera frame.
    post.uniforms.uSeed.value = RANDOM_PER_IMAGE.has(state.id) ? Math.floor(frames / 6) % 997 : 0;

    renderer.setRenderTarget(target);
    renderer.render(scene, camera);
    renderer.setRenderTarget(small);
    renderer.render(downsampleScene, postCamera);
    renderer.setRenderTarget(null);
    renderer.render(postScene, postCamera);

    // Timecode of the drive at 30 frames a second, and the frames rendered through the pass.
    const f = Math.floor(clock * 30);
    const pad = (n: number, w = 2) => String(n).padStart(w, '0');
    timecode.textContent = `${pad(Math.floor(f / 1800))}:${pad(Math.floor(f / 30) % 60)}:${pad(f % 30)} · F ${pad(frames % 100000, 5)}`;

    if (running()) frameId = requestAnimationFrame(draw);
  }

  function requestDraw() {
    if (!frameId) {
      last = performance.now();
      frameId = requestAnimationFrame(draw);
    }
  }

  function resize() {
    const w = stage.clientWidth;
    const h = stage.clientHeight;
    if (!w || !h) return;
    renderer.setSize(w, h, false);
    target.setSize(Math.round(w * pixelRatio), Math.round(h * pixelRatio));
    small.setSize(Math.max(1, Math.round((w * pixelRatio) / 8)), Math.max(1, Math.round((h * pixelRatio) / 8)));
    downsample.uniforms.uTexel.value.set(1 / (w * pixelRatio), 1 / (h * pixelRatio));
    post.uniforms.uRes.value.set(w * pixelRatio, h * pixelRatio);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    requestDraw();
  }

  let statusTimer = 0;
  function readForm() {
    const data = new FormData(form);
    state.id = select.value;
    state.scale = Number(data.get('scale'));
    const label = select.selectedOptions[0]?.textContent ?? state.id;
    readout.textContent = `${state.id}(scale=${state.scale})`;
    meter.dataset.scale = String(state.scale);
    clearTimeout(statusTimer);
    statusTimer = window.setTimeout(() => (status.textContent = `${label}, scale ${state.scale}`), 500);
    requestDraw();
  }

  function setPlaying(playing: boolean) {
    state.playing = playing;
    playButton.textContent = playing ? 'Pause' : 'Drive';
    playButton.setAttribute('aria-pressed', String(playing));
    hud.dataset.playing = String(playing);
    rec.textContent = playing ? 'REC' : 'HOLD';
    requestDraw();
  }

  form.addEventListener('input', readForm);
  form.addEventListener('submit', (event) => event.preventDefault());
  form.querySelectorAll<HTMLButtonElement>('[data-step]').forEach((button) =>
    button.addEventListener('click', () => {
      const count = select.options.length;
      select.selectedIndex = (select.selectedIndex + Number(button.dataset.step) + count) % count;
      readForm();
    }),
  );
  playButton.addEventListener('click', () => setPlaying(!state.playing));
  setPlaying(state.playing);
  readForm();

  new ResizeObserver(resize).observe(stage);
  new IntersectionObserver(([entry]) => {
    visible = entry.isIntersecting;
    if (visible) requestDraw();
  }).observe(stage);
  document.addEventListener('visibilitychange', requestDraw);

  const model = await loadFortuna();
  car = model;
  const box = new THREE.Box3().setFromObject(car);
  car.position.y = -box.min.y;
  car.traverse((child) => {
    const mesh = child as THREE.Mesh;
    if (mesh.isMesh) mesh.material = new THREE.MeshStandardMaterial({ color: '#e2e4e3', roughness: 0.4, metalness: 0.15 });
  });
  scene.add(car);
  placeCar(true, 0);

  loading.hidden = true;
  resize();
}
