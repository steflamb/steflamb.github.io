import * as THREE from 'three';
import { createPerturbationPass } from './perturbation-pass';

// A single recorded camera frame run through PerturbationDrive's shader. The frame is flat,
// so only perturbations that don't need scene depth are offered (no fog, rain, snow).
export async function startPerturbStill(root: HTMLElement) {
  const canvas = root.querySelector('canvas') as HTMLCanvasElement;
  const select = root.querySelector('select') as HTMLSelectElement;
  const range = root.querySelector('input[type="range"]') as HTMLInputElement;
  const readout = root.querySelector('[data-readout]') as HTMLElement;
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)');

  const texture = await new THREE.TextureLoader().loadAsync(root.dataset.src!);
  // Keep the raw sRGB values end to end: the passes neither decode nor re-encode them.
  texture.colorSpace = THREE.NoColorSpace;
  const aspect = texture.image.width / texture.image.height;

  const renderer = new THREE.WebGLRenderer({ canvas, antialias: false });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
  const camera = new THREE.PerspectiveCamera(50, aspect, 0.5, 100);
  const height = 2 * Math.tan(THREE.MathUtils.degToRad(25));
  const plane = new THREE.Mesh(
    new THREE.PlaneGeometry(height * aspect, height),
    new THREE.MeshBasicMaterial({ map: texture, toneMapped: false }),
  );
  plane.position.z = -1;
  const scene = new THREE.Scene().add(plane);
  const pass = createPerturbationPass(renderer, camera);

  const state = { id: select.value, scale: Number(range.value) };
  let visible = false;
  let frameId = 0;
  const start = performance.now();

  function draw() {
    frameId = 0;
    pass.render(scene, state.id, state.scale, (performance.now() - start) / 1000);
    if (visible && !reduceMotion.matches && state.id !== 'none') frameId = requestAnimationFrame(draw);
  }
  const request = () => {
    if (!frameId) frameId = requestAnimationFrame(draw);
  };

  function resize() {
    const w = canvas.clientWidth;
    if (!w) return;
    const h = Math.round(w / aspect);
    renderer.setSize(w, h, false);
    pass.setSize(w, h);
    request();
  }

  function update() {
    state.id = select.value;
    state.scale = Number(range.value);
    range.disabled = state.id === 'none';
    readout.textContent = state.id === 'none' ? 'original frame' : `${state.id}(scale=${state.scale})`;
    request();
  }

  select.addEventListener('change', update);
  range.addEventListener('input', update);
  new IntersectionObserver(([entry]) => {
    visible = entry.isIntersecting;
    if (visible) request();
  }).observe(root);
  new ResizeObserver(resize).observe(canvas);
  update();
  resize();
  root.dataset.ready = 'true';
}
