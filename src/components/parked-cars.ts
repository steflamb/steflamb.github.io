import * as THREE from 'three';
import type { ParkingSpot } from './osm-world';

// Copies of the Fortuna scan, tinted, parked at each spot: one instanced mesh per part of the
// model, so a street full of cars costs a handful of draw calls. The model's nose faces -Z.
const REDS = ['#e0402e', '#c2281c', '#f0614a', '#a91f17'];

export function createParkedCars(model: THREE.Object3D, spots: ParkingSpot[]) {
  const group = new THREE.Group();
  if (!spots.length) return group;
  model.updateMatrixWorld(true);
  const rootInverse = model.matrixWorld.clone().invert();
  const tint = new Map<THREE.Material, THREE.Material>();
  const tinted = (m: THREE.Material) => {
    if (!tint.has(m)) {
      const copy = m.clone() as THREE.MeshStandardMaterial;
      copy.color?.multiply(new THREE.Color(REDS[tint.size % REDS.length]));
      tint.set(m, copy);
    }
    return tint.get(m)!;
  };

  // Each spot: position in the local frame (x east, y north), heading 0 = east.
  const placements = spots.map((s) => {
    const dx = Math.cos(s.heading);
    const dz = -Math.sin(s.heading);
    return new THREE.Matrix4().compose(
      new THREE.Vector3(s.x, 0, -s.y),
      new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.atan2(dx, dz) + Math.PI),
      new THREE.Vector3(1, 1, 1),
    );
  });

  model.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh) return;
    // The part's place within the model, including the model's own offset (tyres on y = 0).
    const local = model.matrix.clone().multiply(rootInverse.clone().multiply(mesh.matrixWorld));
    const material = Array.isArray(mesh.material) ? mesh.material.map(tinted) : tinted(mesh.material);
    const instances = new THREE.InstancedMesh(mesh.geometry, material, spots.length);
    placements.forEach((p, i) => instances.setMatrixAt(i, p.clone().multiply(local)));
    instances.castShadow = true;
    instances.receiveShadow = true;
    // The geometry belongs to the loaded model: whoever clears the scene must not dispose it.
    instances.userData.sharedGeometry = true;
    instances.computeBoundingSphere();
    group.add(instances);
  });
  return group;
}
