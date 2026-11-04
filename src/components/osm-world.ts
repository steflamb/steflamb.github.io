import * as THREE from 'three';

// Streets, footways, green areas, buildings, trees and street furniture from an
// OpenStreetMap extract, in a local metric frame (x east, y north), as a three.js group with
// y up. Everything optional below comes from OSM tags when they are mapped.
export type OsmBuilding = {
  h: number;
  pts: number[][];
  minH?: number;
  kind?: string;
  colour?: string;
  roofColour?: string;
  roof?: 'gabled' | 'hipped' | 'pyramidal';
  roofH?: number;
};
export type OsmMap = {
  roads: {
    w: number;
    pts: number[][];
    name?: string;
    oneway?: boolean;
    lanes?: number;
    // Sides (relative to the way's direction) with cars parked along the kerb.
    parking?: { left?: 'parallel' | 'diagonal' | 'perpendicular'; right?: 'parallel' | 'diagonal' | 'perpendicular' };
  }[];
  paths: { w: number; pts: number[][] }[];
  buildings: OsmBuilding[];
  green: number[][][];
  trees?: number[][]; // [x, y, height?]
  treeRows?: number[][][];
  woods?: number[][][];
  lamps?: number[][];
  signals?: number[][];
  crossings?: number[][];
  busStops?: number[][];
  parking?: number[][][];
  water?: number[][][];
};

// Small deterministic random from a position, so the same map always looks the same.
const hash = (x: number, y: number, k = 0) => {
  const s = Math.sin(x * 12.9898 + y * 78.233 + k * 37.719) * 43758.5453;
  return s - Math.floor(s);
};

const toWorld = (x: number, y: number, h = 0) => new THREE.Vector3(x, h, -y);
const polygon = (pts: number[][]) => new THREE.Shape(pts.map(([x, y]) => new THREE.Vector2(x, y)));

function pointInPolygon([x, y]: number[], poly: number[][]) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i];
    const [xj, yj] = poly[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

const polygonArea = (pts: number[][]) => {
  let a = 0;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) a += pts[j][0] * pts[i][1] - pts[i][0] * pts[j][1];
  return a / 2;
};

// Smallest rectangle around a footprint, for roofs: centre, long axis u, short axis v.
function orientedBox(pts: number[][]) {
  let best = { area: Infinity, c: [0, 0], u: [1, 0], v: [0, 1], hl: 0, hw: 0 };
  for (let i = 0; i < pts.length; i++) {
    const [x0, y0] = pts[i];
    const [x1, y1] = pts[(i + 1) % pts.length];
    const len = Math.hypot(x1 - x0, y1 - y0);
    if (len < 0.5) continue;
    const u = [(x1 - x0) / len, (y1 - y0) / len];
    const v = [-u[1], u[0]];
    let minU = Infinity, maxU = -Infinity, minV = Infinity, maxV = -Infinity;
    for (const [x, y] of pts) {
      const pu = x * u[0] + y * u[1];
      const pv = x * v[0] + y * v[1];
      minU = Math.min(minU, pu);
      maxU = Math.max(maxU, pu);
      minV = Math.min(minV, pv);
      maxV = Math.max(maxV, pv);
    }
    const area = (maxU - minU) * (maxV - minV);
    if (area < best.area) {
      const cu = (minU + maxU) / 2;
      const cv = (minV + maxV) / 2;
      const c = [u[0] * cu + v[0] * cv, u[1] * cu + v[1] * cv];
      const [lu, lv] = [(maxU - minU) / 2, (maxV - minV) / 2];
      best = lu >= lv ? { area, c, u, v, hl: lu, hw: lv } : { area, c, u: v, v: u, hl: lv, hw: lu };
    }
  }
  return best;
}

// Wall colours by what the building is, when OSM does not give one.
const HOMES = new Set(['house', 'residential', 'apartments', 'detached', 'semidetached_house', 'terrace', 'dormitory']);
const PLAIN = new Set(['garage', 'garages', 'shed', 'roof', 'carport', 'hut', 'kiosk', 'service', 'transformer_tower']);
// Light plasters, as on most Munich facades: cream, pale ochre, off-white, a soft pink.
const WARM = ['#f1e8d6', '#f2e1b6', '#ead6c2', '#f6f1e6', '#e8dbbd', '#f0d9c9'];
const COOL = ['#dcdfdf', '#cdd3d6', '#e4e5e0', '#d2d6d2'];

function windowTexture() {
  // One bay of facade, 3 m wide and one 3.1 m storey tall: wall, and a window in it.
  const cnv = document.createElement('canvas');
  cnv.width = cnv.height = 64;
  const ctx = cnv.getContext('2d')!;
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, 64, 64);
  ctx.fillStyle = '#56636f';
  ctx.fillRect(17, 15, 30, 30);
  ctx.fillStyle = '#7d8a95';
  ctx.fillRect(17, 15, 30, 7);
  ctx.fillStyle = '#d9d6cf';
  ctx.fillRect(15, 45, 34, 3);
  const tex = new THREE.CanvasTexture(cnv);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  // Side UVs come out in metres (u along the wall, v = 1 - height): one bay per 3 x 3.1 m,
  // with the storey lines starting at the ground.
  tex.repeat.set(1 / 3, 1 / 3.1);
  tex.offset.set(0, -1 / 3.1);
  return tex;
}

// Triangles collected per material, merged into one mesh each.
class Bucket {
  positions: number[] = [];
  colors: number[] = [];
  uvs: number[] = [];
  push(p: THREE.Vector3, c: THREE.Color, u = 0, v = 0) {
    this.positions.push(p.x, p.y, p.z);
    this.colors.push(c.r, c.g, c.b);
    this.uvs.push(u, v);
  }
  mesh(material: THREE.Material) {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.positions, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.colors, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uvs, 2));
    g.computeVertexNormals();
    return new THREE.Mesh(g, material);
  }
}

export function buildStreet(map: OsmMap) {
  const world = new THREE.Group();
  const flat = (color: string, offset = 0) =>
    new THREE.MeshStandardMaterial({ color, roughness: 0.95, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: offset, polygonOffsetUnits: offset });
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(1600, 1600), flat('#a3a79a'));
  ground.rotation.x = -Math.PI / 2;
  ground.position.set(140, -0.05, -80);
  world.add(ground);

  const area = (list: number[][][] | undefined, material: THREE.Material, y: number) => {
    for (const pts of list ?? []) {
      if (pts.length < 3) continue;
      const mesh = new THREE.Mesh(new THREE.ShapeGeometry(polygon(pts)), material);
      mesh.rotation.x = -Math.PI / 2;
      mesh.position.y = y;
      world.add(mesh);
    }
  };
  area(map.green, flat('#8fa279', -1), 0.01);
  area(map.parking, flat('#5a5d5d', -2), 0.015);
  area(map.water, flat('#7fa6c2', -2), 0.015);

  // Roads as ribbons along their OSM centrelines, at their mapped or typical width.
  function ribbon(pts: number[][], halfWidth: number, y: number, material: THREE.Material) {
    const positions: number[] = [];
    const indices: number[] = [];
    pts.forEach(([x, z], i) => {
      const [px, pz] = pts[Math.max(0, i - 1)];
      const [nx, nz] = pts[Math.min(pts.length - 1, i + 1)];
      const len = Math.hypot(nx - px, nz - pz) || 1;
      const ox = (-(nz - pz) / len) * halfWidth;
      const oz = ((nx - px) / len) * halfWidth;
      positions.push(x + ox, y, -(z + oz), x - ox, y, -(z - oz));
      if (i < pts.length - 1) indices.push(i * 2, i * 2 + 1, i * 2 + 2, i * 2 + 1, i * 2 + 3, i * 2 + 2);
    });
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geometry.setIndex(indices);
    geometry.computeVertexNormals();
    return new THREE.Mesh(geometry, material);
  }
  const sidewalk = flat('#c4c2ba', -2);
  const asphalt = flat('#4a4c4b', -3);
  const footway = flat('#d3cfc3', -2);
  for (const road of map.roads) {
    world.add(ribbon(road.pts, road.w / 2 + 2, 0.02, sidewalk));
    world.add(ribbon(road.pts, road.w / 2, 0.03, asphalt));
  }
  for (const way of map.paths) world.add(ribbon(way.pts, way.w / 2, 0.025, footway));

  world.add(...markings(map));
  world.add(buildings(map.buildings));
  world.add(...trees(map));
  world.add(...furniture(map));
  return world;
}

// --- Road markings: dashed centre lines on two-way roads, zebra crossings ---

function markings(map: OsmMap) {
  const paint = new Bucket();
  const white = new THREE.Color('#ecebe4');
  // A flat quad on the road: centre (x, y), along unit (ux, uy), length and width in metres.
  const quad = (x: number, y: number, ux: number, uy: number, length: number, width: number) => {
    const vx = -uy;
    const vy = ux;
    const c = (a: number, b: number) => toWorld(x + ux * a + vx * b, y + uy * a + vy * b, 0.04);
    const [p1, p2, p3, p4] = [c(-length / 2, -width / 2), c(length / 2, -width / 2), c(length / 2, width / 2), c(-length / 2, width / 2)];
    for (const p of [p1, p2, p3, p1, p3, p4]) paint.push(p, white);
  };

  for (const road of map.roads) {
    if (road.oneway || road.w < 6) continue;
    let carry = 0;
    for (let i = 1; i < road.pts.length; i++) {
      const [x0, y0] = road.pts[i - 1];
      const [x1, y1] = road.pts[i];
      const len = Math.hypot(x1 - x0, y1 - y0);
      if (len < 0.01) continue;
      const [ux, uy] = [(x1 - x0) / len, (y1 - y0) / len];
      for (let s = carry; s < len; s += 9) quad(x0 + ux * (s + 1.5), y0 + uy * (s + 1.5), ux, uy, 3, 0.15);
      carry = (((carry - len) % 9) + 9) % 9;
    }
  }

  // Zebra crossings: stripes along the road, side by side across it.
  for (const [x, y] of map.crossings ?? []) {
    let best = { d: Infinity, ux: 1, uy: 0, w: 7 };
    for (const road of map.roads) {
      for (let i = 1; i < road.pts.length; i++) {
        const [x0, y0] = road.pts[i - 1];
        const [x1, y1] = road.pts[i];
        const len = Math.hypot(x1 - x0, y1 - y0) || 1;
        const t = Math.max(0, Math.min(1, ((x - x0) * (x1 - x0) + (y - y0) * (y1 - y0)) / (len * len)));
        const d = Math.hypot(x - (x0 + (x1 - x0) * t), y - (y0 + (y1 - y0) * t));
        if (d < best.d) best = { d, ux: (x1 - x0) / len, uy: (y1 - y0) / len, w: road.w };
      }
    }
    if (best.d > 6) continue;
    const [vx, vy] = [-best.uy, best.ux];
    for (let o = -best.w / 2 + 0.6; o <= best.w / 2 - 0.6; o += 1) quad(x + vx * o, y + vy * o, best.ux, best.uy, 3, 0.5);
  }

  if (!paint.positions.length) return [];
  const material = new THREE.MeshStandardMaterial({
    vertexColors: true,
    roughness: 0.8,
    side: THREE.DoubleSide,
    polygonOffset: true,
    polygonOffsetFactor: -5,
    polygonOffsetUnits: -5,
  });
  return [paint.mesh(material)];
}

// --- Buildings: coloured walls with a window per bay and storey, and their roofs ---

function buildings(list: OsmBuilding[]) {
  const group = new THREE.Group();
  const facades = new Bucket();
  const plain = new Bucket();
  const roofs = new Bucket();
  const tmp = new THREE.Vector3();

  for (const b of list) {
    let pts = b.pts;
    if (pts.length < 3) continue;
    if (polygonArea(pts) < 0) pts = [...pts].reverse();
    const [cx, cy] = pts[0];
    const r = hash(cx, cy);
    const home = HOMES.has(b.kind ?? '');
    const wall = new THREE.Color(b.colour ?? (home ? WARM : r < 0.55 ? WARM : COOL)[Math.floor(hash(cx, cy, 1) * 6) % (home ? WARM.length : 4)]);
    const minH = b.minH ?? 0;

    // A pitched roof needs a roughly rectangular footprint to sit on.
    const box = b.roof ? orientedBox(pts) : null;
    const rectangular = !!box && Math.abs(polygonArea(pts)) / (4 * box.hl * box.hw) > 0.8;
    const roofH = rectangular ? Math.min(b.roofH ?? box!.hw * Math.tan((35 * Math.PI) / 180), 7, (b.h - minH) * 0.5) : 0;
    const wallH = Math.max(1, b.h - minH - roofH);
    const roof = new THREE.Color(b.roofColour ?? (rectangular ? (home ? '#9a5a45' : '#6f767b') : '#9fa3a5'));

    const windows = !PLAIN.has(b.kind ?? '') && wallH >= 4;
    const geometry = new THREE.ExtrudeGeometry(polygon(pts), { depth: wallH, bevelEnabled: false });
    geometry.rotateX(-Math.PI / 2);
    geometry.translate(0, minH, 0);
    const pos = geometry.getAttribute('position');
    const uv = geometry.getAttribute('uv');
    // ExtrudeGeometry: group 0 is the caps (top and bottom), group 1 the walls.
    for (const g of geometry.groups) {
      const caps = g.materialIndex === 0;
      const target = caps ? roofs : windows ? facades : plain;
      for (let i = g.start; i < g.start + g.count; i++) {
        tmp.fromBufferAttribute(pos, i);
        if (caps && tmp.y < minH + 0.01) continue; // the underside is never seen
        target.push(tmp.clone(), caps ? roof : wall, uv.getX(i), uv.getY(i));
      }
    }
    geometry.dispose();
    if (rectangular) pitchedRoof(b.roof!, box!, minH + wallH, roofH, roof, wall, roofs, plain);
  }

  // Caps were pushed vertex by vertex; drop any incomplete triangle from skipped undersides.
  for (const bucket of [facades, plain, roofs]) {
    const whole = Math.floor(bucket.positions.length / 9) * 9;
    bucket.positions.length = whole;
    bucket.colors.length = whole;
    bucket.uvs.length = (whole / 3) * 2;
  }
  if (facades.positions.length) group.add(facades.mesh(new THREE.MeshStandardMaterial({ vertexColors: true, map: windowTexture(), roughness: 0.85 })));
  if (plain.positions.length) group.add(plain.mesh(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9, side: THREE.DoubleSide })));
  if (roofs.positions.length) group.add(roofs.mesh(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.8, side: THREE.DoubleSide })));
  return group;
}

function pitchedRoof(
  shape: 'gabled' | 'hipped' | 'pyramidal',
  box: ReturnType<typeof orientedBox>,
  base: number,
  height: number,
  roofColour: THREE.Color,
  wallColour: THREE.Color,
  roofs: Bucket,
  walls: Bucket,
) {
  const { c, u, v, hl, hw } = box;
  const at = (a: number, b: number, h: number) => toWorld(c[0] + u[0] * a + v[0] * b, c[1] + u[1] * a + v[1] * b, base + h);
  const A = at(-hl, -hw, 0);
  const B = at(hl, -hw, 0);
  const C = at(hl, hw, 0);
  const D = at(-hl, hw, 0);
  const tri = (bucket: Bucket, colour: THREE.Color, ...p: THREE.Vector3[]) => p.forEach((q) => bucket.push(q, colour));
  if (shape === 'pyramidal') {
    const apex = at(0, 0, height);
    tri(roofs, roofColour, A, B, apex, B, C, apex, C, D, apex, D, A, apex);
    return;
  }
  const inset = shape === 'hipped' ? Math.min(hw, hl * 0.45) : 0;
  const R1 = at(-hl + inset, 0, height);
  const R2 = at(hl - inset, 0, height);
  tri(roofs, roofColour, A, B, R2, A, R2, R1, C, D, R1, C, R1, R2);
  // Gables are wall; hips are roof.
  tri(shape === 'gabled' ? walls : roofs, shape === 'gabled' ? wallColour : roofColour, B, C, R2, D, A, R1);
}

// --- Trees: mapped single trees, rows planted along their lines, woods filled ---

function trees(map: OsmMap) {
  const spots: { x: number; y: number; h: number; conifer: boolean }[] = [];
  for (const [x, y, h] of map.trees ?? []) spots.push({ x, y, h: h ?? 8 + hash(x, y) * 6, conifer: false });
  for (const row of map.treeRows ?? []) {
    for (let i = 1; i < row.length; i++) {
      const [x0, y0] = row[i - 1];
      const [x1, y1] = row[i];
      const len = Math.hypot(x1 - x0, y1 - y0);
      for (let s = 0; s < len; s += 7) {
        const x = x0 + ((x1 - x0) * s) / len;
        const y = y0 + ((y1 - y0) * s) / len;
        spots.push({ x, y, h: 8 + hash(x, y) * 5, conifer: false });
      }
    }
  }
  for (const wood of map.woods ?? []) {
    const xs = wood.map((p) => p[0]);
    const ys = wood.map((p) => p[1]);
    const [minX, maxX, minY, maxY] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
    const count = Math.min(500, Math.round(Math.abs(polygonArea(wood)) / 55));
    for (let i = 0, placed = 0; i < count * 4 && placed < count; i++) {
      const x = minX + hash(minX + i, minY, 2) * (maxX - minX);
      const y = minY + hash(minX, minY + i, 3) * (maxY - minY);
      if (!pointInPolygon([x, y], wood)) continue;
      placed++;
      spots.push({ x, y, h: 9 + hash(x, y, 4) * 9, conifer: hash(x, y, 5) < 0.35 });
    }
  }
  if (!spots.length) return [];

  const trunkGeo = new THREE.CylinderGeometry(0.16, 0.24, 1, 6).translate(0, 0.5, 0);
  const broadGeo = new THREE.IcosahedronGeometry(1, 1);
  const coniferGeo = new THREE.ConeGeometry(1, 1, 7).translate(0, 0.5, 0);
  const trunks = new THREE.InstancedMesh(trunkGeo, new THREE.MeshStandardMaterial({ color: '#5b4636', roughness: 1 }), spots.length);
  const broad = spots.filter((s) => !s.conifer);
  const conifer = spots.filter((s) => s.conifer);
  const crownMaterial = new THREE.MeshStandardMaterial({ roughness: 0.9, flatShading: true });
  const broadMesh = new THREE.InstancedMesh(broadGeo, crownMaterial, Math.max(1, broad.length));
  const coniferMesh = new THREE.InstancedMesh(coniferGeo, crownMaterial, Math.max(1, conifer.length));
  broadMesh.count = broad.length;
  coniferMesh.count = conifer.length;

  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const scale = new THREE.Vector3();
  const colour = new THREE.Color();
  const BROAD = ['#5f7f45', '#6b8a4c', '#56763f', '#738f52', '#647f3f'];
  const NEEDLE = ['#3f5e3a', '#47663f', '#3a5537'];
  spots.forEach((s, i) => {
    q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), hash(s.x, s.y, 6) * Math.PI * 2);
    m.compose(toWorld(s.x, s.y), q, scale.set(1, s.h * (s.conifer ? 0.3 : 0.4), 1));
    trunks.setMatrixAt(i, m);
  });
  broad.forEach((s, i) => {
    const r = s.h * (0.26 + hash(s.x, s.y, 7) * 0.08);
    m.compose(toWorld(s.x, s.y, s.h - r * 1.05), q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), hash(s.x, s.y, 8) * 6.28), scale.set(r, r * 1.1, r));
    broadMesh.setMatrixAt(i, m);
    broadMesh.setColorAt(i, colour.set(BROAD[Math.floor(hash(s.x, s.y, 9) * BROAD.length)]));
  });
  conifer.forEach((s, i) => {
    const r = s.h * 0.2;
    m.compose(toWorld(s.x, s.y, s.h * 0.22), q.identity(), scale.set(r, s.h * 0.78, r));
    coniferMesh.setMatrixAt(i, m);
    coniferMesh.setColorAt(i, colour.set(NEEDLE[Math.floor(hash(s.x, s.y, 10) * NEEDLE.length)]));
  });
  return [trunks, broadMesh, coniferMesh].filter((mesh) => mesh.count > 0);
}

// --- Street furniture: lamps, traffic lights and bus stops where they are mapped ---

function furniture(map: OsmMap) {
  const out: THREE.Object3D[] = [];
  const steel = new THREE.MeshStandardMaterial({ color: '#4c5358', roughness: 0.6, metalness: 0.4 });
  const place = (points: number[][] | undefined, parts: [THREE.BufferGeometry, THREE.Material][]) => {
    if (!points?.length) return;
    for (const [geometry, material] of parts) {
      const mesh = new THREE.InstancedMesh(geometry, material, points.length);
      const m = new THREE.Matrix4();
      points.forEach(([x, y], i) => mesh.setMatrixAt(i, m.makeTranslation(x, 0, -y)));
      out.push(mesh);
    }
  };
  place(map.lamps, [
    [new THREE.CylinderGeometry(0.06, 0.09, 6, 6).translate(0, 3, 0), steel],
    [new THREE.BoxGeometry(0.28, 0.14, 0.5).translate(0, 6, 0), new THREE.MeshStandardMaterial({ color: '#f4efdc', emissive: '#6b6250', roughness: 0.4 })],
  ]);
  place(map.signals, [
    [new THREE.CylinderGeometry(0.08, 0.1, 3.4, 6).translate(0, 1.7, 0), steel],
    [new THREE.BoxGeometry(0.34, 0.95, 0.3).translate(0, 3.1, 0), new THREE.MeshStandardMaterial({ color: '#1b2126', roughness: 0.5 })],
  ]);
  place(map.busStops, [
    [new THREE.CylinderGeometry(0.05, 0.05, 2.6, 6).translate(0, 1.3, 0), steel],
    [new THREE.CylinderGeometry(0.3, 0.3, 0.04, 20).rotateX(Math.PI / 2).translate(0, 2.5, 0), new THREE.MeshStandardMaterial({ color: '#f2c230', roughness: 0.5 })],
  ]);
  return out;
}

// --- Parked cars: spots along the kerb where OSM maps street parking ---

export type ParkingSpot = { x: number; y: number; heading: number };

// Spots in the local frame (heading: radians, 0 = east, counter-clockwise), along each side
// with mapped parking, kept clear of junctions and crossings, about two in three taken.
export function parkingSpots(map: OsmMap) {
  const spots: ParkingSpot[] = [];
  const ends = map.roads.flatMap((r) => [r.pts[0], r.pts[r.pts.length - 1]]);
  const clear = (x: number, y: number) =>
    !ends.some(([ex, ey]) => Math.hypot(ex - x, ey - y) < 12) &&
    !(map.crossings ?? []).some(([cx, cy]) => Math.hypot(cx - x, cy - y) < 8);
  for (const road of map.roads) {
    if (!road.parking) continue;
    for (const side of ['left', 'right'] as const) {
      const orientation = road.parking[side];
      if (!orientation) continue;
      const pitch = orientation === 'parallel' ? 6 : orientation === 'diagonal' ? 3.6 : 2.7;
      const turn = orientation === 'parallel' ? 0 : orientation === 'diagonal' ? Math.PI / 4 : Math.PI / 2;
      // Parked at the kerb, half on the pavement, so the lanes stay clear.
      // On a narrow street, never closer to the centre than a traffic lane's outer edge.
      const offset = Math.max(road.w / 2 + (orientation === 'parallel' ? 0.2 : 1.2), 3.6);
      const sign = side === 'left' ? 1 : -1;
      let carry = 4;
      for (let i = 1; i < road.pts.length; i++) {
        const [x0, y0] = road.pts[i - 1];
        const [x1, y1] = road.pts[i];
        const len = Math.hypot(x1 - x0, y1 - y0);
        if (len < 0.01) continue;
        const [ux, uy] = [(x1 - x0) / len, (y1 - y0) / len];
        const [nx, ny] = [-uy * sign, ux * sign];
        let s = carry;
        for (; s < len; s += pitch) {
          const x = x0 + ux * s + nx * offset;
          const y = y0 + uy * s + ny * offset;
          if (!clear(x0 + ux * s, y0 + uy * s) || hash(x, y, 11) > 0.68) continue;
          // Parked facing the traffic on that side: with the way on the right, against it on
          // the left of a two-way street.
          const facing = side === 'left' && !road.oneway ? Math.PI : 0;
          spots.push({ x, y, heading: Math.atan2(uy, ux) + facing + turn * sign });
        }
        carry = s - len;
      }
    }
  }
  return spots;
}
