// "Build your own" track: a top-down editor on a 2D canvas. The road is a closed loop through
// the points, in order (the same centripetal Catmull-Rom curve the garage drives on), and cones
// stand wherever they are placed. Positions are world metres: x to the right, z down the screen,
// as the garage's ground.
import * as THREE from 'three';

export type Point = [number, number];
export type BuiltTrack = { road: Point[]; cones: Point[] };
export type BuilderMode = 'road' | 'cones';

const STORAGE_KEY = 'garage-built-track';
/** The editable ground, in metres: points and cones stay inside it. */
export const EXTENT = { w: 220, h: 150 };
const ROAD_WIDTH = 9;

/** A first track to change: a loop with a slalom after the start and two gates. */
const EXAMPLE_ROAD: Point[] = [
  [-55, -25], [-5, -32], [45, -25], [70, 0], [50, 30], [15, 22], [-15, 40], [-50, 32], [-72, 5],
];
export const EXAMPLE_TRACK: BuiltTrack = { road: EXAMPLE_ROAD, cones: exampleCones(EXAMPLE_ROAD) };

// Placed from the road's own centreline, so they sit on it however the curve bends.
function exampleCones(road: Point[]): Point[] {
  const line = builtCenterline(road);
  const at = (i: number, side: number): Point => {
    const p = line[i % line.length];
    const q = line[(i + 1) % line.length];
    const len = Math.hypot(q.x - p.x, q.z - p.z) || 1;
    const nx = -(q.z - p.z) / len;
    const nz = (q.x - p.x) / len;
    return [Math.round((p.x + nx * side) * 10) / 10, Math.round((p.z + nz * side) * 10) / 10];
  };
  const cones: Point[] = [];
  for (let k = 0; k < 6; k++) cones.push(at(18 + k * 9, k % 2 ? 2.2 : -2.2));
  for (const i of [Math.round(line.length * 0.33), Math.round(line.length * 0.7)]) cones.push(at(i, 3.4), at(i, -3.4));
  return cones;
}

export function loadBuiltTrack(): BuiltTrack | null {
  try {
    const t = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? 'null');
    if (t && Array.isArray(t.road) && Array.isArray(t.cones) && t.road.length >= 3) return t as BuiltTrack;
  } catch {
    // Nothing saved, or storage blocked.
  }
  return null;
}

export function saveBuiltTrack(track: BuiltTrack) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(track));
  } catch {
    // Storage unavailable: the track lasts this visit.
  }
}

/** A short id for a layout, so each one keeps its own best lap and ghost. */
export function builtTrackId(track: BuiltTrack) {
  const text = JSON.stringify(track);
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 16777619);
  return (h >>> 0).toString(36);
}

/** The road's centreline, about a point a metre, closed. */
export function builtCenterline(road: Point[]): { x: number; z: number }[] {
  if (road.length < 3) return road.map(([x, z]) => ({ x, z }));
  const curve = new THREE.CatmullRomCurve3(road.map(([x, z]) => new THREE.Vector3(x, 0, z)), true, 'centripetal');
  return curve
    .getSpacedPoints(Math.max(12, Math.round(curve.getLength())))
    .slice(0, -1)
    .map((v) => ({ x: v.x, z: v.z }));
}

export function createTrackBuilder(canvas: HTMLCanvasElement, onChange: (track: BuiltTrack) => void) {
  const ctx = canvas.getContext('2d')!;
  let track: BuiltTrack = { road: [], cones: [] };
  let mode: BuilderMode = 'road';
  const history: string[] = [];
  // screen = o + world * scale. The view fits the track when it opens; wheel, pinch and the
  // zoom buttons change it, and dragging empty ground pans it.
  let view = { scale: 1, ox: 0, oy: 0 };
  let size = { w: 1, h: 1 };

  const snapshot = () => history.push(JSON.stringify(track));
  const changed = () => {
    draw();
    onChange(track);
  };

  function resizeCanvas() {
    const r = canvas.getBoundingClientRect();
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.max(1, Math.round(r.width * dpr));
    canvas.height = Math.max(1, Math.round(r.height * dpr));
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    // Keep the same world point in the middle when the canvas changes size.
    view.ox += (r.width - size.w) / 2;
    view.oy += (r.height - size.h) / 2;
    size = { w: Math.max(1, r.width), h: Math.max(1, r.height) };
  }

  /** Zoom to the track, with some ground around it (at least 70 x 45 m in view). */
  function fitView() {
    resizeCanvas();
    const pts = [...track.road, ...track.cones];
    let [minX, maxX, minZ, maxZ] = [-35, 35, -22, 22];
    if (pts.length) {
      minX = Math.min(...pts.map((p) => p[0])) - 14;
      maxX = Math.max(...pts.map((p) => p[0])) + 14;
      minZ = Math.min(...pts.map((p) => p[1])) - 14;
      maxZ = Math.max(...pts.map((p) => p[1])) + 14;
      const cx = (minX + maxX) / 2;
      const cz = (minZ + maxZ) / 2;
      const hw = Math.max(35, (maxX - minX) / 2);
      const hh = Math.max(22, (maxZ - minZ) / 2);
      [minX, maxX, minZ, maxZ] = [cx - hw, cx + hw, cz - hh, cz + hh];
    }
    const scale = Math.min(size.w / (maxX - minX), size.h / (maxZ - minZ));
    view = { scale, ox: size.w / 2 - ((minX + maxX) / 2) * scale, oy: size.h / 2 - ((minZ + maxZ) / 2) * scale };
    draw();
  }

  function zoomAt(factor: number, sx = size.w / 2, sy = size.h / 2) {
    const min = Math.min(size.w / EXTENT.w, size.h / EXTENT.h) * 0.9;
    const next = THREE.MathUtils.clamp(view.scale * factor, min, 40);
    const k = next / view.scale;
    view = { scale: next, ox: sx - (sx - view.ox) * k, oy: sy - (sy - view.oy) * k };
    draw();
  }

  const toScreen = ([x, z]: Point): Point => [view.ox + x * view.scale, view.oy + z * view.scale];
  const toWorld = (sx: number, sy: number): Point => {
    const x = THREE.MathUtils.clamp((sx - view.ox) / view.scale, -EXTENT.w / 2, EXTENT.w / 2);
    const z = THREE.MathUtils.clamp((sy - view.oy) / view.scale, -EXTENT.h / 2, EXTENT.h / 2);
    return [Math.round(x * 10) / 10, Math.round(z * 10) / 10];
  };

  function draw() {
    const r = size;
    ctx.clearRect(0, 0, r.w, r.h);
    // Grass, and a 10 m grid inside the buildable ground.
    ctx.fillStyle = '#6d9067';
    ctx.fillRect(0, 0, r.w, r.h);
    const [x0, y0] = toScreen([-EXTENT.w / 2, -EXTENT.h / 2]);
    const [x1, y1] = toScreen([EXTENT.w / 2, EXTENT.h / 2]);
    ctx.fillStyle = '#8fb889';
    ctx.fillRect(x0, y0, x1 - x0, y1 - y0);
    ctx.strokeStyle = 'rgba(255,255,255,0.18)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let x = -EXTENT.w / 2; x <= EXTENT.w / 2; x += 10) {
      const [sx] = toScreen([x, 0]);
      ctx.moveTo(sx, y0);
      ctx.lineTo(sx, y1);
    }
    for (let z = -EXTENT.h / 2; z <= EXTENT.h / 2; z += 10) {
      const [, sy] = toScreen([0, z]);
      ctx.moveTo(x0, sy);
      ctx.lineTo(x1, sy);
    }
    ctx.stroke();
    if (view.scale > 14) {
      ctx.strokeStyle = 'rgba(255,255,255,0.07)';
      ctx.beginPath();
      for (let x = -EXTENT.w / 2; x <= EXTENT.w / 2; x += 1) {
        const [sx] = toScreen([x, 0]);
        if (sx < 0 || sx > r.w) continue;
        ctx.moveTo(sx, y0);
        ctx.lineTo(sx, y1);
      }
      for (let z = -EXTENT.h / 2; z <= EXTENT.h / 2; z += 1) {
        const [, sy] = toScreen([0, z]);
        if (sy < 0 || sy > r.h) continue;
        ctx.moveTo(x0, sy);
        ctx.lineTo(x1, sy);
      }
      ctx.stroke();
    }

    // The road: kerb, asphalt, dashed centreline, at true width.
    const line = builtCenterline(track.road).map((p) => toScreen([p.x, p.z]));
    if (track.road.length >= 3) {
      const path = () => {
        ctx.beginPath();
        line.forEach(([sx, sy], i) => (i ? ctx.lineTo(sx, sy) : ctx.moveTo(sx, sy)));
        ctx.closePath();
      };
      ctx.lineJoin = 'round';
      ctx.lineCap = 'round';
      path();
      ctx.strokeStyle = '#d6cdbd';
      ctx.lineWidth = (ROAD_WIDTH + 1.2) * view.scale;
      ctx.stroke();
      path();
      ctx.strokeStyle = '#45434b';
      ctx.lineWidth = ROAD_WIDTH * view.scale;
      ctx.stroke();
      path();
      ctx.setLineDash([2.5 * view.scale, 2.5 * view.scale]);
      ctx.strokeStyle = 'rgba(255,255,255,0.75)';
      ctx.lineWidth = Math.max(1, 0.25 * view.scale);
      ctx.stroke();
      ctx.setLineDash([]);
      // The start line at the first point, and an arrow for the direction of travel.
      const [a, b] = [line[0], line[Math.min(3, line.length - 1)]];
      const ang = Math.atan2(b[1] - a[1], b[0] - a[0]);
      ctx.save();
      ctx.translate(a[0], a[1]);
      ctx.rotate(ang);
      const half = (ROAD_WIDTH / 2) * view.scale;
      const cell = half / 3;
      for (let i = 0; i < 6; i++) {
        for (let j = 0; j < 2; j++) {
          ctx.fillStyle = (i + j) % 2 ? '#111' : '#fff';
          ctx.fillRect(j * cell - cell, -half + i * cell, cell, cell);
        }
      }
      ctx.translate(Math.max(14, 5 * view.scale), 0);
      ctx.fillStyle = '#fff';
      ctx.beginPath();
      ctx.moveTo(8, 0);
      ctx.lineTo(-4, -6);
      ctx.lineTo(-4, 6);
      ctx.closePath();
      ctx.fill();
      ctx.restore();
    } else if (track.road.length === 2) {
      ctx.strokeStyle = 'rgba(69,67,75,0.6)';
      ctx.lineWidth = ROAD_WIDTH * view.scale;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(...toScreen(track.road[0]));
      ctx.lineTo(...toScreen(track.road[1]));
      ctx.stroke();
    }

    // Points: numbered, the first one marked as the start.
    track.road.forEach((p, i) => {
      const [sx, sy] = toScreen(p);
      ctx.beginPath();
      ctx.arc(sx, sy, 9, 0, Math.PI * 2);
      ctx.fillStyle = mode === 'road' ? '#fafaf8' : 'rgba(250,250,248,0.7)';
      ctx.fill();
      ctx.lineWidth = 2;
      ctx.strokeStyle = '#0f1720';
      ctx.stroke();
      ctx.fillStyle = '#0f1720';
      ctx.font = '600 10px "IBM Plex Mono", ui-monospace, monospace';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(i === 0 ? 'S' : String(i + 1), sx, sy + 0.5);
    });

    // Cones: orange, drawn a little larger than life so they can be grabbed.
    const coneR = Math.max(8, 0.35 * view.scale);
    for (const c of track.cones) {
      const [sx, sy] = toScreen(c);
      ctx.beginPath();
      ctx.moveTo(sx, sy - coneR * 1.3);
      ctx.lineTo(sx + coneR, sy + coneR * 0.8);
      ctx.lineTo(sx - coneR, sy + coneR * 0.8);
      ctx.closePath();
      ctx.fillStyle = mode === 'cones' ? '#f05a28' : 'rgba(240,90,40,0.75)';
      ctx.fill();
      ctx.lineWidth = 1.5;
      ctx.strokeStyle = '#fff';
      ctx.stroke();
    }
  }

  // Tap empty ground to add, drag to move, tap without moving to remove.
  function hit(sx: number, sy: number): { list: 'road' | 'cones'; index: number } | null {
    const lists: ('road' | 'cones')[] = mode === 'road' ? ['road', 'cones'] : ['cones', 'road'];
    for (const list of lists) {
      let best = -1;
      let bestD = 20;
      track[list].forEach((p, i) => {
        const [px, py] = toScreen(p);
        const d = Math.hypot(px - sx, py - sy);
        if (d < bestD) {
          bestD = d;
          best = i;
        }
      });
      if (best >= 0) return { list, index: best };
    }
    return null;
  }

  // A new road point goes into the stretch of the loop it is nearest to, so the road can be
  // extended anywhere, not only at its end.
  function insertIndex(p: Point) {
    const r = track.road;
    if (r.length < 3) return r.length;
    let best = r.length;
    let bestCost = Infinity;
    for (let i = 0; i < r.length; i++) {
      const a = r[i];
      const b = r[(i + 1) % r.length];
      const cost = Math.hypot(p[0] - a[0], p[1] - a[1]) + Math.hypot(p[0] - b[0], p[1] - b[1]) - Math.hypot(a[0] - b[0], a[1] - b[1]);
      if (cost < bestCost) {
        bestCost = cost;
        best = i + 1;
      }
    }
    return best;
  }

  // One finger or the mouse: tap empty ground to add, drag empty ground to pan, drag a point
  // or cone to move it, tap it to remove it. Two fingers: pinch to zoom and pan.
  type Press = { id: number; x: number; y: number; moved: boolean; item: { list: 'road' | 'cones'; index: number } | null; snap: boolean };
  let press: Press | null = null;
  const touches = new Map<number, { x: number; y: number }>();
  let pinch: { d: number; mx: number; my: number } | null = null;
  const local = (e: PointerEvent) => {
    const r = canvas.getBoundingClientRect();
    return [e.clientX - r.left, e.clientY - r.top] as const;
  };
  const pinchState = () => {
    const [a, b] = [...touches.values()];
    return { d: Math.hypot(a.x - b.x, a.y - b.y), mx: (a.x + b.x) / 2, my: (a.y + b.y) / 2 };
  };
  canvas.addEventListener('pointerdown', (e) => {
    if (e.button !== 0 && e.pointerType === 'mouse') return;
    const [sx, sy] = local(e);
    try {
      canvas.setPointerCapture(e.pointerId);
    } catch {
      // Not a live pointer (a synthetic event): nothing to capture.
    }
    touches.set(e.pointerId, { x: sx, y: sy });
    if (touches.size === 2) {
      // A second finger: this is a pinch, not a tap or a drag.
      if (press?.snap) history.pop();
      press = null;
      pinch = pinchState();
      return;
    }
    if (touches.size > 2) return;
    press = { id: e.pointerId, x: sx, y: sy, moved: false, item: hit(sx, sy), snap: false };
  });
  canvas.addEventListener('pointermove', (e) => {
    const [sx, sy] = local(e);
    if (touches.has(e.pointerId)) touches.set(e.pointerId, { x: sx, y: sy });
    if (pinch && touches.size === 2) {
      const now = pinchState();
      view.ox += now.mx - pinch.mx;
      view.oy += now.my - pinch.my;
      zoomAt(now.d / Math.max(1, pinch.d), now.mx, now.my);
      pinch = now;
      return;
    }
    if (!press || press.id !== e.pointerId) {
      canvas.style.cursor = hit(sx, sy) ? 'grab' : 'crosshair';
      return;
    }
    if (!press.moved && Math.hypot(sx - press.x, sy - press.y) < 6) return;
    if (press.item) {
      if (!press.snap) {
        snapshot();
        press.snap = true;
      }
      press.moved = true;
      track[press.item.list][press.item.index] = toWorld(sx, sy);
      canvas.style.cursor = 'grabbing';
      changed();
    } else {
      // Pan, by however far the pointer went since the last move.
      view.ox += sx - press.x;
      view.oy += sy - press.y;
      press.x = sx;
      press.y = sy;
      press.moved = true;
      canvas.style.cursor = 'move';
      draw();
    }
  });
  const end = (e: PointerEvent) => {
    touches.delete(e.pointerId);
    if (touches.size < 2) pinch = null;
    if (!press || press.id !== e.pointerId) return;
    const p = press;
    press = null;
    if (e.type === 'pointercancel') return;
    if (p.moved) return;
    snapshot();
    if (p.item) {
      track[p.item.list].splice(p.item.index, 1);
    } else {
      const w = toWorld(p.x, p.y);
      if (mode === 'road') track.road.splice(insertIndex(w), 0, w);
      else track.cones.push(w);
    }
    changed();
  };
  canvas.addEventListener('pointerup', end);
  canvas.addEventListener('pointercancel', end);
  canvas.addEventListener(
    'wheel',
    (e) => {
      e.preventDefault();
      const [sx, sy] = [e.offsetX, e.offsetY];
      zoomAt(Math.exp(-e.deltaY * 0.0015), sx, sy);
    },
    { passive: false },
  );

  new ResizeObserver(() => {
    resizeCanvas();
    draw();
  }).observe(canvas);

  return {
    set(next: BuiltTrack) {
      track = JSON.parse(JSON.stringify(next));
      history.length = 0;
      fitView();
      onChange(track);
    },
    get: () => JSON.parse(JSON.stringify(track)) as BuiltTrack,
    setMode(next: BuilderMode) {
      mode = next;
      draw();
    },
    undo() {
      const prev = history.pop();
      if (!prev) return;
      track = JSON.parse(prev);
      changed();
    },
    clear() {
      snapshot();
      track = { road: [], cones: [] };
      changed();
    },
    canUndo: () => history.length > 0,
    refresh: fitView,
    zoom: (factor: number) => zoomAt(factor),
  };
}

/** Length of the closed road, in metres. */
export function builtLength(road: Point[]) {
  const line = builtCenterline(road);
  if (line.length < 3) return 0;
  let len = 0;
  for (let i = 0; i < line.length; i++) {
    const a = line[i];
    const b = line[(i + 1) % line.length];
    len += Math.hypot(b.x - a.x, b.z - a.z);
  }
  return len;
}

/**
 * The tightest turn on the road: its radius in metres, and the road point nearest to it. Under
 * about 5 m the inside of the road (9 m wide) folds over itself.
 */
export function tightestTurn(road: Point[]): { radius: number; near: number } | null {
  const line = builtCenterline(road);
  if (line.length < 6) return null;
  let best = Infinity;
  let at = 0;
  const step = 3; // metres either side: the radius of the circle through three points
  for (let i = 0; i < line.length; i++) {
    const a = line[(i - step + line.length) % line.length];
    const b = line[i];
    const c = line[(i + step) % line.length];
    const ab = Math.hypot(b.x - a.x, b.z - a.z);
    const bc = Math.hypot(c.x - b.x, c.z - b.z);
    const ca = Math.hypot(a.x - c.x, a.z - c.z);
    const area2 = Math.abs((b.x - a.x) * (c.z - a.z) - (b.z - a.z) * (c.x - a.x));
    const r = area2 > 1e-6 ? (ab * bc * ca) / (2 * area2) : Infinity;
    if (r < best) {
      best = r;
      at = i;
    }
  }
  const p = line[at];
  let near = 0;
  let nd = Infinity;
  road.forEach(([x, z], i) => {
    const d = Math.hypot(x - p.x, z - p.z);
    if (d < nd) {
      nd = d;
      near = i;
    }
  });
  return { radius: best, near };
}
