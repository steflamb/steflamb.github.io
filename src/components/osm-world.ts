import * as THREE from 'three';

// Streets, footways, green areas and buildings from an OpenStreetMap extract, in a local
// metric frame (x east, y north), as a three.js group with y up.
export type OsmMap = {
  roads: { w: number; pts: number[][]; name?: string }[];
  paths: { w: number; pts: number[][] }[];
  buildings: { h: number; pts: number[][] }[];
  green: number[][][];
};

export function buildStreet(map: OsmMap) {
  const world = new THREE.Group();
  const flat = (color: string, offset = 0) =>
    new THREE.MeshStandardMaterial({ color, roughness: 0.95, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: offset, polygonOffsetUnits: offset });
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(1600, 1600), flat('#a3a79a'));
  ground.rotation.x = -Math.PI / 2;
  ground.position.set(140, -0.05, -80);
  world.add(ground);

  const polygon = (pts: number[][]) => new THREE.Shape(pts.map(([x, y]) => new THREE.Vector2(x, y)));
  const greenMaterial = flat('#8fa279', -1);
  for (const pts of map.green) {
    const mesh = new THREE.Mesh(new THREE.ShapeGeometry(polygon(pts)), greenMaterial);
    mesh.rotation.x = -Math.PI / 2;
    mesh.position.y = 0.01;
    world.add(mesh);
  }

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


  const buildingMaterial = new THREE.MeshStandardMaterial({ color: '#dddbd3', roughness: 0.9 });
  for (const building of map.buildings) {
    const geometry = new THREE.ExtrudeGeometry(polygon(building.pts), { depth: building.h, bevelEnabled: false });
    geometry.rotateX(-Math.PI / 2);
    world.add(new THREE.Mesh(geometry, buildingMaterial));
  }
  return world;
}
