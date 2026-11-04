import type { OsmBuilding, OsmMap } from './osm-world';

// Any street, anywhere: the OpenStreetMap streets and buildings around two picked points,
// fetched from the public Overpass API, in a local metric frame (x east, y north), with
// the shortest route between the points along the road network.

export type LatLng = { lat: number; lng: number };
// origin: the lat/lng of the local frame's (0, 0), to draw the route back on a map.
export type CustomRoute = { id: string; name: string; map: OsmMap; route: number[][]; origin: LatLng };

const OVERPASS = 'https://overpass-api.de/api/interpreter';
const MARGIN = 100; // metres of surroundings around the two points
const ATTEMPTS = 3;
const ATTEMPT_TIMEOUT = 45000;
const BUSY = new Set([429, 502, 503, 504]);
const MAX_SPAN = 2000; // metres between the points
const MIN_ROUTE = 80;

// Typical carriageway widths in metres, by road class.
const WIDTH: Record<string, number> = {
  motorway: 12, trunk: 11, primary: 10, secondary: 9, tertiary: 8, unclassified: 6.5,
  residential: 7, living_street: 6, service: 4.5, motorway_link: 6, trunk_link: 6,
  primary_link: 6, secondary_link: 6, tertiary_link: 6, road: 6,
};
const FOOTWAYS = new Set(['footway', 'path', 'cycleway', 'pedestrian', 'steps', 'track']);

// Which side of a way has cars parked along it, and how: the current parking:<side> scheme
// first, then the older parking:lane:<side> one.
const NO_PARKING = new Set(['no', 'separate', 'no_parking', 'no_stopping', 'fire_lane', 'none']);
const ORIENTATIONS = ['parallel', 'diagonal', 'perpendicular'];
type Orientation = 'parallel' | 'diagonal' | 'perpendicular';
function streetParking(tags: Record<string, string>) {
  const out: { left?: Orientation; right?: Orientation } = {};
  for (const side of ['left', 'right'] as const) {
    let value = tags[`parking:${side}`] ?? tags['parking:both'];
    let orientation = tags[`parking:${side}:orientation`] ?? tags['parking:both:orientation'] ?? 'parallel';
    if (value === undefined) {
      const old = tags[`parking:lane:${side}`] ?? tags['parking:lane:both'];
      if (ORIENTATIONS.includes(old)) [value, orientation] = ['lane', old];
    }
    if (value && !NO_PARKING.has(value)) out[side] = (ORIENTATIONS.includes(orientation) ? orientation : 'parallel') as Orientation;
  }
  return out.left || out.right ? out : null;
}

type Way = {
  type: 'way' | 'node';
  id: number;
  nodes: number[];
  geometry: { lat: number; lon: number }[];
  lat?: number;
  lon?: number;
  tags?: Record<string, string>;
};

const metres = (a: LatLng, b: LatLng) => {
  const k = Math.cos(((a.lat + b.lat) / 2) * (Math.PI / 180));
  return Math.hypot((b.lng - a.lng) * 111320 * k, (b.lat - a.lat) * 110540);
};

export function routeId(start: LatLng, end: LatLng) {
  const f = (p: LatLng) => `${p.lat.toFixed(4)},${p.lng.toFixed(4)}`;
  return `${f(start)}:${f(end)}`;
}

export function checkSpan(start: LatLng, end: LatLng) {
  const d = metres(start, end);
  if (d > MAX_SPAN) return `Those points are ${(d / 1000).toFixed(1)} km apart. Pick two within 2 km.`;
  if (d < 40) return 'Those points are too close together. Pick a finish further along the street.';
  return null;
}

// Last few routes stay on this device, so reloading one does not query Overpass again.
const CACHE = 'garage-osm-routes-v3'; // v3: with trees, building tags, street furniture and parking
function readCache(): CustomRoute[] {
  try {
    return (JSON.parse(localStorage.getItem(CACHE) ?? '[]') as CustomRoute[]).filter((r) => r.origin);
  } catch {
    return [];
  }
}
function writeCache(route: CustomRoute) {
  try {
    const kept = [route, ...readCache().filter((r) => r.id !== route.id)].slice(0, 3);
    localStorage.setItem(CACHE, JSON.stringify(kept));
  } catch {
    // Storage full or blocked: the route still works for this visit.
  }
}
export const lastRoute = () => readCache()[0] ?? null;

// Back from the local frame (x east, y north, metres) to lat/lng, to draw a route on a map.
export function toLatLng(route: CustomRoute, [x, y]: number[]): [number, number] {
  const kx = 111320 * Math.cos(route.origin.lat * (Math.PI / 180));
  return [route.origin.lat + y / 110540, route.origin.lng + x / kx];
}

const sleep = (ms: number, signal?: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener('abort', () => {
      clearTimeout(timer);
      reject(new DOMException('Cancelled', 'AbortError'));
    });
  });

// The public Overpass server is often busy: each attempt gets a time limit, and busy answers
// or timeouts are retried after a short wait. Cancelling stops everything at once.
async function overpass(query: string, signal: AbortSignal | undefined, onStatus: (text: string) => void) {
  let problem = '';
  for (let attempt = 1; attempt <= ATTEMPTS; attempt++) {
    if (attempt > 1) {
      onStatus(`${problem} Trying again (${attempt} of ${ATTEMPTS})…`);
      await sleep(2500 * (attempt - 1), signal);
    }
    const controller = new AbortController();
    const cancel = () => controller.abort();
    signal?.addEventListener('abort', cancel);
    const started = performance.now();
    const ticker = setInterval(() => {
      const seconds = Math.round((performance.now() - started) / 1000);
      if (seconds >= 8) onStatus(`Still loading from OpenStreetMap… ${seconds} s. The public server is slow right now.`);
    }, 1000);
    const timer = setTimeout(() => controller.abort(), ATTEMPT_TIMEOUT);
    try {
      const response = await fetch(OVERPASS, { method: 'POST', body: new URLSearchParams({ data: query }), signal: controller.signal });
      if (response.ok) return (await response.json()) as { elements: Way[] };
      if (!BUSY.has(response.status)) throw new Error(`The OpenStreetMap data service answered ${response.status}. Try again later.`);
      problem = 'The OpenStreetMap data service is busy.';
    } catch (error) {
      if (signal?.aborted) throw new DOMException('Cancelled', 'AbortError');
      if ((error as Error).name !== 'AbortError' && (error as Error).message.startsWith('The OpenStreetMap')) throw error;
      problem = (error as Error).name === 'AbortError' ? 'The OpenStreetMap data service did not answer in time.' : 'Could not reach the OpenStreetMap data service.';
    } finally {
      clearTimeout(timer);
      clearInterval(ticker);
      signal?.removeEventListener('abort', cancel);
    }
  }
  throw new Error(`${problem} Please try again in a minute.`);
}

export async function loadRoute(
  start: LatLng,
  end: LatLng,
  signal?: AbortSignal,
  onStatus: (text: string) => void = () => {},
): Promise<CustomRoute> {
  const id = routeId(start, end);
  const cached = readCache().find((r) => r.id === id);
  if (cached) return cached;
  const problem = checkSpan(start, end);
  if (problem) throw new Error(problem);

  // Bounding box around both points, plus a margin.
  const lat0 = (start.lat + end.lat) / 2;
  const lng0 = (start.lng + end.lng) / 2;
  const kx = 111320 * Math.cos(lat0 * (Math.PI / 180));
  const ky = 110540;
  const dLat = MARGIN / ky;
  const dLng = MARGIN / kx;
  const bbox = [
    Math.min(start.lat, end.lat) - dLat,
    Math.min(start.lng, end.lng) - dLng,
    Math.max(start.lat, end.lat) + dLat,
    Math.max(start.lng, end.lng) + dLng,
  ].map((v) => v.toFixed(6)).join(',');
  const query = `[out:json][timeout:25];
(
  way["highway"](${bbox});
  way["building"](${bbox});
  way["building:part"](${bbox});
  way["leisure"~"^(park|garden|playground|pitch)$"](${bbox});
  way["landuse"~"^(grass|meadow|forest|recreation_ground|village_green)$"](${bbox});
  way["natural"~"^(wood|tree_row|water|scrub)$"](${bbox});
  way["amenity"~"^(parking|fountain)$"](${bbox});
  node["natural"="tree"](${bbox});
  node["highway"~"^(street_lamp|traffic_signals|crossing|bus_stop)$"](${bbox});
);
out body geom;`;

  const { elements } = await overpass(query, signal, onStatus);

  const project = (p: { lat: number; lon: number }) => [
    +((p.lon - lng0) * kx).toFixed(2),
    +((p.lat - lat0) * ky).toFixed(2),
  ];
  const closed = (w: Way) => w.nodes.length > 3 && w.nodes[0] === w.nodes[w.nodes.length - 1];

  const map: OsmMap = {
    roads: [], paths: [], buildings: [], green: [],
    trees: [], treeRows: [], woods: [], lamps: [], signals: [], crossings: [], busStops: [], parking: [], water: [],
  };
  const num = (v: string | undefined) => {
    const n = parseFloat((v ?? '').replace(',', '.'));
    return Number.isFinite(n) ? n : null;
  };
  const parts: number[][] = [];
  const partEntries = new Set<OsmBuilding>();
  // Road graph: OSM node ids, positions, and the distance to each neighbour.
  const nodes = new Map<number, { p: number[]; edges: [number, number][] }>();
  const names = new Map<string, string>();

  for (const el of elements) {
    if (el.type !== 'node' || el.lat === undefined) continue;
    const tags = el.tags ?? {};
    const p = project({ lat: el.lat, lon: el.lon! });
    if (tags.natural === 'tree') {
      const h = num(tags.height);
      map.trees!.push(h && h > 2 && h < 45 ? [...p, h] : p);
    } else if (tags.highway === 'street_lamp') map.lamps!.push(p);
    else if (tags.highway === 'traffic_signals') map.signals!.push(p);
    else if (tags.highway === 'crossing') map.crossings!.push(p);
    else if (tags.highway === 'bus_stop') map.busStops!.push(p);
  }

  for (const way of elements) {
    if (way.type !== 'way' || !way.geometry) continue;
    const tags = way.tags ?? {};
    const pts = way.geometry.map(project);
    if (tags.highway && WIDTH[tags.highway] !== undefined && tags.area !== 'yes') {
      const tagged = parseFloat(tags.width);
      const lanes = parseInt(tags.lanes, 10);
      const w = tagged > 2 && tagged < 40 ? tagged : lanes > 0 ? Math.max(4.5, lanes * 3.2) : WIDTH[tags.highway];
      map.roads.push({
        w,
        pts,
        name: tags.name,
        ...(['yes', '1', '-1'].includes(tags.oneway) ? { oneway: true } : {}),
        ...(lanes > 0 ? { lanes } : {}),
        ...(streetParking(tags) ? { parking: streetParking(tags)! } : {}),
      });
      way.nodes.forEach((id, i) => {
        if (!nodes.has(id)) nodes.set(id, { p: pts[i], edges: [] });
        if (i > 0) {
          const prev = way.nodes[i - 1];
          const d = Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
          nodes.get(id)!.edges.push([prev, d]);
          nodes.get(prev)!.edges.push([id, d]);
          if (tags.name) {
            names.set(`${prev}-${id}`, tags.name);
            names.set(`${id}-${prev}`, tags.name);
          }
        }
      });
    } else if (tags.highway && FOOTWAYS.has(tags.highway)) {
      map.paths.push({ w: 2, pts });
    } else if ((tags.building || tags['building:part']) && closed(way)) {
      const height = num(tags.height);
      const levels = num(tags['building:levels']);
      const h = height && height > 2 ? height : levels && levels > 0 ? levels * 3.1 + 1 : 9;
      const minH = num(tags.min_height) ?? ((num(tags['building:min_level']) ?? 0) * 3.1 || null);
      const roof = ['gabled', 'hipped', 'pyramidal'].includes(tags['roof:shape']) ? (tags['roof:shape'] as 'gabled') : undefined;
      const outline = pts.slice(0, -1);
      if (tags['building:part']) {
        const n = outline.length;
        parts.push([outline.reduce((s, q) => s + q[0], 0) / n, outline.reduce((s, q) => s + q[1], 0) / n]);
      }
      const building: OsmBuilding = {
        h: Math.min(h, 120),
        pts: outline,
        kind: tags.building ?? tags['building:part'],
        ...(minH ? { minH } : {}),
        ...(tags['building:colour'] ? { colour: tags['building:colour'] } : {}),
        ...(tags['roof:colour'] ? { roofColour: tags['roof:colour'] } : {}),
        ...(roof ? { roof } : {}),
        ...(num(tags['roof:height']) ? { roofH: num(tags['roof:height'])! } : {}),
      };
      map.buildings.push(building);
      if (tags['building:part']) partEntries.add(building);
    } else if (tags.natural === 'tree_row') {
      map.treeRows!.push(pts);
    } else if (closed(way) && (tags.natural === 'wood' || tags.landuse === 'forest')) {
      map.woods!.push(pts.slice(0, -1));
      map.green.push(pts.slice(0, -1));
    } else if (closed(way) && tags.amenity === 'parking') {
      map.parking!.push(pts.slice(0, -1));
    } else if (closed(way) && (tags.natural === 'water' || tags.amenity === 'fountain')) {
      map.water!.push(pts.slice(0, -1));
    } else if ((tags.leisure || tags.landuse || tags.natural === 'scrub') && closed(way)) {
      map.green.push(pts.slice(0, -1));
    }
  }
  // An outline with building parts inside it is drawn by its parts.
  const inside = ([x, y]: number[], poly: number[][]) => {
    let c = false;
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      const [xi, yi] = poly[i];
      const [xj, yj] = poly[j];
      if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) c = !c;
    }
    return c;
  };
  if (parts.length) {
    map.buildings = map.buildings.filter((b) => partEntries.has(b) || !parts.some((c) => inside(c, b.pts)));
  }
  if (!nodes.size) throw new Error('No drivable streets around those points. Try a spot with roads.');

  // Keep the largest connected road network: parking aisles, driveways and fragments cut off
  // at the edge of the area cannot join a route, so a tap should never snap onto them.
  const component = new Map<number, number>();
  const sizes: number[] = [];
  for (const id of nodes.keys()) {
    if (component.has(id)) continue;
    const label = sizes.length;
    const stack = [id];
    component.set(id, label);
    let size = 0;
    while (stack.length) {
      const n = stack.pop()!;
      size++;
      for (const [next] of nodes.get(n)!.edges) {
        if (!component.has(next)) {
          component.set(next, label);
          stack.push(next);
        }
      }
    }
    sizes.push(size);
  }
  const main = sizes.indexOf(Math.max(...sizes));

  // Snap each picked point to the nearest node on that network.
  const snap = (ll: LatLng) => {
    const [x, y] = project({ lat: ll.lat, lon: ll.lng });
    let best = -1;
    let bestD = Infinity;
    for (const [id, n] of nodes) {
      if (component.get(id) !== main) continue;
      const d = Math.hypot(n.p[0] - x, n.p[1] - y);
      if (d < bestD) {
        bestD = d;
        best = id;
      }
    }
    if (bestD > 80) throw new Error('One of the points is not near a street. Tap right on a road.');
    return best;
  };
  const from = snap(start);
  const to = snap(end);

  // Dijkstra over the road graph (one-way rules ignored: it is a game).
  const dist = new Map<number, number>([[from, 0]]);
  const prev = new Map<number, number>();
  const heap: [number, number][] = [[0, from]];
  const push = (item: [number, number]) => {
    heap.push(item);
    let i = heap.length - 1;
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (heap[parent][0] <= heap[i][0]) break;
      [heap[parent], heap[i]] = [heap[i], heap[parent]];
      i = parent;
    }
  };
  const pop = () => {
    const top = heap[0];
    const last = heap.pop()!;
    if (heap.length) {
      heap[0] = last;
      let i = 0;
      for (;;) {
        const l = i * 2 + 1;
        const r = l + 1;
        let m = i;
        if (l < heap.length && heap[l][0] < heap[m][0]) m = l;
        if (r < heap.length && heap[r][0] < heap[m][0]) m = r;
        if (m === i) break;
        [heap[m], heap[i]] = [heap[i], heap[m]];
        i = m;
      }
    }
    return top;
  };
  while (heap.length) {
    const [d, id] = pop();
    if (id === to) break;
    if (d > (dist.get(id) ?? Infinity)) continue;
    for (const [next, w] of nodes.get(id)!.edges) {
      const nd = d + w;
      if (nd < (dist.get(next) ?? Infinity)) {
        dist.set(next, nd);
        prev.set(next, id);
        push([nd, next]);
      }
    }
  }
  if (!dist.has(to)) throw new Error('Those two points are not connected by roads in this area. Try points on connected streets.');

  const ids = [to];
  while (ids[0] !== from) ids.unshift(prev.get(ids[0])!);
  const route = ids.map((id) => nodes.get(id)!.p);
  const length = dist.get(to)!;
  if (length < MIN_ROUTE) throw new Error('That route is very short. Pick a finish further along the street.');

  // Name the route by the streets it uses, in order.
  const streetNames: string[] = [];
  for (let i = 1; i < ids.length; i++) {
    const name = names.get(`${ids[i - 1]}-${ids[i]}`);
    if (name && streetNames[streetNames.length - 1] !== name) streetNames.push(name);
  }
  const name = streetNames.length ? streetNames.slice(0, 3).join(' → ') + (streetNames.length > 3 ? ' …' : '') : 'Your route';

  const result: CustomRoute = { id, name, map, route, origin: { lat: lat0, lng: lng0 } };
  writeCache(result);
  return result;
}
