import * as THREE from 'three';
import { MODE, RANDOM_PER_IMAGE, perturbationFragment, perturbationVertex } from './perturbations';

// Renders a scene through one of PerturbationDrive's image perturbations: scene to a target,
// an 8x downsample for the wide blurs, then the perturbation shader to the screen.
export function createPerturbationPass(renderer: THREE.WebGLRenderer, camera: THREE.PerspectiveCamera) {
  const target = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType });
  target.depthTexture = new THREE.DepthTexture(1, 1);
  const small = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType });
  const quadCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  const quad = (material: THREE.Material) => new THREE.Scene().add(new THREE.Mesh(new THREE.PlaneGeometry(2, 2), material));

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
  const post = new THREE.ShaderMaterial({
    vertexShader: perturbationVertex,
    fragmentShader: perturbationFragment,
    uniforms: {
      tColor: { value: target.texture },
      tLogo: { value: new THREE.Texture() },
      tDepth: { value: target.depthTexture },
      tSmall: { value: small.texture },
      uNear: { value: camera.near },
      uFar: { value: camera.far },
      uMode: { value: 0 },
      uScale: { value: 0 },
      uTime: { value: 0 },
      uSeed: { value: 0 },
      uRes: { value: new THREE.Vector2(1, 1) },
    },
    depthTest: false,
    depthWrite: false,
  });
  const downsampleScene = quad(downsample);
  const postScene = quad(post);
  let frames = 0;

  return {
    setSize(width: number, height: number) {
      const pr = renderer.getPixelRatio();
      target.setSize(Math.round(width * pr), Math.round(height * pr));
      small.setSize(Math.max(1, Math.round((width * pr) / 8)), Math.max(1, Math.round((height * pr) / 8)));
      downsample.uniforms.uTexel.value.set(1 / (width * pr), 1 / (height * pr));
      post.uniforms.uRes.value.set(width * pr, height * pr);
    },
    render(scene: THREE.Scene, id: string, scale: number, time: number) {
      frames++;
      post.uniforms.uMode.value = MODE[id] ?? 0;
      post.uniforms.uScale.value = scale;
      post.uniforms.uTime.value = time;
      post.uniforms.uSeed.value = RANDOM_PER_IMAGE.has(id) ? Math.floor(frames / 6) % 997 : 0;
      post.uniforms.uNear.value = camera.near;
      post.uniforms.uFar.value = camera.far;
      renderer.setRenderTarget(target);
      renderer.render(scene, camera);
      renderer.setRenderTarget(small);
      renderer.render(downsampleScene, quadCamera);
      renderer.setRenderTarget(null);
      renderer.render(postScene, quadCamera);
    },
  };
}
