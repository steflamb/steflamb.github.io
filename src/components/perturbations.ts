// PerturbationDrive's image perturbations, re-implemented as one fragment shader.
// Parameters per scale (0–4) follow perturbationdrive/perturbationfuncs.py.
// Source: https://github.com/ast-fortiss-tum/perturbation-drive

export type Perturbation = { id: string; label: string; group: string; overlay?: boolean };

export const PERTURBATIONS: Perturbation[] = [
  { id: 'gaussian_noise', label: 'Gaussian noise', group: 'Noise' },
  { id: 'poisson_noise', label: 'Poisson noise', group: 'Noise' },
  { id: 'impulse_noise', label: 'Impulse noise', group: 'Noise' },
  { id: 'speckle_noise_filter', label: 'Speckle noise', group: 'Noise' },

  { id: 'defocus_blur', label: 'Defocus blur', group: 'Blur' },
  { id: 'glass_blur', label: 'Glass blur', group: 'Blur' },
  { id: 'motion_blur', label: 'Motion blur', group: 'Blur' },
  { id: 'zoom_blur', label: 'Zoom blur', group: 'Blur' },
  { id: 'gaussian_blur', label: 'Gaussian blur', group: 'Blur' },
  { id: 'low_pass_filter', label: 'Low-pass filter', group: 'Blur' },

  { id: 'increase_brightness', label: 'Brightness up', group: 'Colour and tone' },
  { id: 'decrease_brightness', label: 'Brightness down', group: 'Colour and tone' },
  { id: 'contrast', label: 'Contrast', group: 'Colour and tone' },
  { id: 'saturation_filter', label: 'Saturation up', group: 'Colour and tone' },
  { id: 'saturation_decrease_filter', label: 'Saturation down', group: 'Colour and tone' },
  { id: 'grayscale_filter', label: 'Greyscale', group: 'Colour and tone' },
  { id: 'white_balance_filter', label: 'White balance', group: 'Colour and tone' },
  { id: 'false_color_filter', label: 'False colour', group: 'Colour and tone' },
  { id: 'histogram_equalisation', label: 'Histogram equalisation', group: 'Colour and tone' },
  { id: 'posterize_filter', label: 'Posterise', group: 'Colour and tone' },
  { id: 'high_pass_filter', label: 'High-pass filter', group: 'Colour and tone' },
  { id: 'sharpen_filter', label: 'Sharpen', group: 'Colour and tone' },
  { id: 'phase_scrambling', label: 'Phase scrambling', group: 'Colour and tone' },

  { id: 'elastic', label: 'Elastic', group: 'Geometry and encoding' },
  { id: 'shear_image', label: 'Shear', group: 'Geometry and encoding' },
  { id: 'translate_image', label: 'Translate', group: 'Geometry and encoding' },
  { id: 'scale_image', label: 'Scale', group: 'Geometry and encoding' },
  { id: 'rotate_image', label: 'Rotate', group: 'Geometry and encoding' },
  { id: 'reflection_filter', label: 'Reflection', group: 'Geometry and encoding' },
  { id: 'pixelate', label: 'Pixelate', group: 'Geometry and encoding' },
  { id: 'jpeg_filter', label: 'JPEG compression', group: 'Geometry and encoding' },

  { id: 'fog_mapping', label: 'Fog mapping', group: 'Occlusion' },
  { id: 'splatter_mapping', label: 'Splatter', group: 'Occlusion' },
  { id: 'dotted_lines_mapping', label: 'Dotted lines', group: 'Occlusion' },
  { id: 'zigzag_mapping', label: 'Zigzag lines', group: 'Occlusion' },
  { id: 'canny_edges_mapping', label: 'Canny edges', group: 'Occlusion' },
  { id: 'cutout_filter', label: 'Cutout', group: 'Occlusion' },
  { id: 'sample_pairing_filter', label: 'Sample pairing', group: 'Occlusion' },
  { id: 'object_overlay', label: 'Object overlay', group: 'Occlusion', overlay: true },

  { id: 'fog_filter', label: 'Fog', group: 'Weather and light', overlay: true },
  { id: 'frost_filter', label: 'Frost', group: 'Weather and light', overlay: true },
  { id: 'dynamic_snow_filter', label: 'Snow', group: 'Weather and light', overlay: true },
  { id: 'dynamic_rain_filter', label: 'Rain', group: 'Weather and light', overlay: true },
  { id: 'dynamic_raindrop_filter', label: 'Raindrops on lens', group: 'Weather and light', overlay: true },
  { id: 'dynamic_sun_filter', label: 'Sun glare', group: 'Weather and light', overlay: true },
  { id: 'dynamic_lightning_filter', label: 'Lightning', group: 'Weather and light', overlay: true },
  { id: 'dynamic_smoke_filter', label: 'Smoke', group: 'Weather and light', overlay: true },
  { id: 'dynamic_object_overlay', label: 'Passing objects', group: 'Weather and light', overlay: true },
];

export const MODE: Record<string, number> = Object.fromEntries(PERTURBATIONS.map((p, i) => [p.id, i + 1]));

// Perturbations whose output is random per image; re-rolled a few times a second while driving.
export const RANDOM_PER_IMAGE = new Set([
  'gaussian_noise',
  'poisson_noise',
  'impulse_noise',
  'speckle_noise_filter',
  'glass_blur',
  'elastic',
  'fog_mapping',
  'splatter_mapping',
  'dotted_lines_mapping',
  'zigzag_mapping',
  'cutout_filter',
  'sample_pairing_filter',
  'fog_filter',
]);

const m = (id: string) => MODE[id];

export const perturbationVertex = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = vec4(position.xy, 0.0, 1.0);
  }
`;

export const perturbationFragment = /* glsl */ `
  uniform sampler2D tColor;
  uniform sampler2D tLogo;
  uniform sampler2D tSmall;
  uniform sampler2D tDepth;
  uniform float uNear;
  uniform float uFar;
  uniform int uMode;
  uniform int uScale;
  uniform float uTime;
  uniform float uSeed;
  uniform vec2 uRes;
  varying vec2 vUv;

  // The library works on small simulator frames; pixel sizes are scaled from a 320px-wide frame.
  float K() { return uRes.x / 320.0; }

  float pick(float a, float b, float c, float d, float e) {
    return uScale == 0 ? a : uScale == 1 ? b : uScale == 2 ? c : uScale == 3 ? d : e;
  }

  float hash(vec2 p) {
    vec3 p3 = fract(vec3(p.xyx) * 0.1031);
    p3 += dot(p3, p3.yzx + 33.33);
    return fract((p3.x + p3.y) * p3.z);
  }
  float rnd(float i, float salt) { return hash(vec2(i * 1.618 + uSeed * 7.31, salt + uSeed * 3.17)); }
  float gauss(vec2 p) {
    float u1 = max(hash(p), 1e-4);
    float u2 = hash(p + 71.3);
    return sqrt(-2.0 * log(u1)) * cos(6.2831853 * u2);
  }
  float vnoise(vec2 p) {
    vec2 i = floor(p), f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash(i), hash(i + vec2(1, 0)), f.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), f.x), f.y);
  }
  float fbm(vec2 p) {
    float s = 0.0, a = 0.5;
    for (int i = 0; i < 6; i++) { s += a * vnoise(p); p = p * 2.03 + 11.7; a *= 0.5; }
    return s;
  }

  vec3 src(vec2 uv) { return pow(max(texture2D(tColor, clamp(uv, 0.0, 1.0)).rgb, 0.0), vec3(1.0 / 2.2)); }
  vec3 srcBlack(vec2 uv) {
    if (uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0) return vec3(0.0);
    return src(uv);
  }
  float luma(vec3 c) { return dot(c, vec3(0.299, 0.587, 0.114)); }

  vec3 rgb2hsv(vec3 c) {
    vec4 K4 = vec4(0.0, -1.0 / 3.0, 2.0 / 3.0, -1.0);
    vec4 p = mix(vec4(c.bg, K4.wz), vec4(c.gb, K4.xy), step(c.b, c.g));
    vec4 q = mix(vec4(p.xyw, c.r), vec4(c.r, p.yzx), step(p.x, c.r));
    float d = q.x - min(q.w, q.y);
    return vec3(abs(q.z + (q.w - q.y) / (6.0 * d + 1e-10)), d / (q.x + 1e-10), q.x);
  }
  vec3 hsv2rgb(vec3 c) {
    vec3 p = abs(fract(c.xxx + vec3(1.0, 2.0 / 3.0, 1.0 / 3.0)) * 6.0 - 3.0);
    return c.z * mix(vec3(1.0), clamp(p - 1.0, 0.0, 1.0), c.y);
  }

  // An 8x downsampled copy of the frame, for wide blurs.
  vec3 srcSoft(vec2 uv) {
    return pow(max(texture2D(tSmall, clamp(uv, 0.0, 1.0)).rgb, 0.0), vec3(1.0 / 2.2));
  }
  vec3 wideBlur(vec2 uv, float radiusPx) {
    vec3 s = srcSoft(uv) * 2.0;
    for (int i = 0; i < 12; i++) {
      float a = float(i) * 0.5236;
      float r = (i < 6 ? 0.5 : 1.0) * radiusPx;
      s += srcSoft(uv + vec2(cos(a), sin(a)) * r / uRes);
    }
    return s / 14.0;
  }

  vec3 gaussianBlur(vec2 uv, float sigmaPx) {
    if (sigmaPx < 0.3) return src(uv);
    if (sigmaPx > 8.0) return wideBlur(uv, sigmaPx * 1.4);
    vec3 s = src(uv);
    float w = 1.0;
    for (int i = 0; i < 32; i++) {
      float fi = float(i);
      float r = sqrt((fi + 0.5) / 32.0) * 2.5 * sigmaPx;
      float a = fi * 2.39996;
      float wi = exp(-r * r / (2.0 * sigmaPx * sigmaPx));
      s += src(uv + vec2(cos(a), sin(a)) * r / uRes) * wi;
      w += wi;
    }
    return s / w;
  }
  vec3 diskBlur(vec2 uv, float radiusPx) {
    vec3 s = vec3(0.0);
    for (int i = 0; i < 32; i++) {
      float fi = float(i);
      float r = sqrt((fi + 0.5) / 32.0) * radiusPx;
      float a = fi * 2.39996;
      s += src(uv + vec2(cos(a), sin(a)) * r / uRes);
    }
    return s / 32.0;
  }

  // Image-space position with the origin top-left, as OpenCV sees it.
  vec2 topLeft(vec2 uv) { return vec2(uv.x, 1.0 - uv.y) * uRes; }
  vec2 fromTopLeft(vec2 p) { return vec2(p.x, uRes.y - p.y) / uRes; }

  // Weather and light. The library blends recorded masks; these are rendered from the scene
  // instead, using its depth, and driven by the library's intensity for each scale.
  float sceneDepth(vec2 uv) {
    float z = texture2D(tDepth, uv).r * 2.0 - 1.0;
    return (2.0 * uNear * uFar) / (uFar + uNear - z * (uFar - uNear));
  }
  float aspect() { return uRes.x / uRes.y; }

  // Falling particles in depth layers: near layers are large, fast and out of focus.
  float flakes(vec2 uv, float t, float density, float layers, float streak) {
    float m = 0.0;
    for (int l = 0; l < 5; l++) {
      float fl = float(l);
      if (fl >= layers) break;
      float depth = fl / max(layers - 1.0, 1.0);          // 0 = near the lens, 1 = far away
      float cells = mix(5.0, 34.0, depth);
      vec2 q = uv * vec2(aspect(), 1.0) * cells;
      q.y += t * mix(2.6, 0.9, depth) * (1.0 + streak * 3.0);
      q.x += sin(q.y * 0.6 + fl * 1.7 + t * 0.7) * 0.35 * (1.0 - streak);
      vec2 cell = floor(q);
      if (hash(cell + fl * 7.0) > density) continue;
      vec2 c = vec2(hash(cell + fl), hash(cell + fl + 9.1)) * 0.7 + 0.15;
      vec2 d = fract(q) - c;
      d.y /= 1.0 + streak * mix(10.0, 4.0, depth);        // rain: stretched by motion
      float size = mix(0.16, 0.05, depth) * (0.6 + 0.6 * hash(cell + 3.3));
      float soft = mix(0.95, 0.3, depth);                  // near flakes are bokeh discs
      float alpha = mix(0.45, 0.9, depth) * mix(1.0, 0.55, streak);
      m = max(m, alpha * smoothstep(size, size * (1.0 - soft), length(d)));
    }
    return m;
  }

  float smokeDensity(vec2 uv, float t) {
    vec2 p = uv * vec2(aspect(), 1.0) * 1.6;
    vec2 warp = vec2(fbm(p + vec2(t * 0.05, 0.0)), fbm(p + vec2(5.2, t * 0.04)));
    float n = fbm(p * 1.4 + warp * 1.8 + vec2(-t * 0.12, t * 0.03));
    return smoothstep(0.35, 0.85, n) * smoothstep(1.05, 0.25, uv.y);
  }

  float boltDistance(vec2 uv, float strike) {
    float x0 = 0.2 + 0.6 * hash(vec2(strike, 1.0));
    float y = 1.0 - uv.y;
    float end = 0.45 + 0.25 * hash(vec2(strike, 2.0));
    float path = x0 + (fbm(vec2(y * 5.0, strike)) - 0.5) * 0.3 + (vnoise(vec2(y * 45.0, strike)) - 0.5) * 0.025;
    float d = y < end ? abs(uv.x - path) * aspect() : 1.0;
    float branchY = 0.18 + 0.15 * hash(vec2(strike, 3.0));
    float branch = path + (y - branchY) * (0.4 + 0.3 * hash(vec2(strike, 4.0))) + (fbm(vec2(y * 9.0, strike + 3.0)) - 0.5) * 0.08;
    if (y > branchY && y < branchY + 0.18) d = min(d, abs(uv.x - branch) * aspect() * 1.5);
    return d;
  }

  float leaves(vec2 uv, float t) {
    float m = 0.0;
    for (int i = 0; i < 9; i++) {
      float fi = float(i);
      float speed = 0.05 + 0.06 * hash(vec2(fi, 2.0));
      vec2 c = vec2(fract(hash(vec2(fi, 1.0)) + t * speed), fract(0.9 - t * speed * 0.6 + hash(vec2(fi, 3.0))));
      vec2 d = (uv - c) * vec2(aspect(), 1.0);
      float a = t * (1.0 + hash(vec2(fi, 5.0))) + fi;
      d = mat2(cos(a), -sin(a), sin(a), cos(a)) * d;
      float r = 0.03 + 0.05 * hash(vec2(fi, 4.0));
      float leaf = length(d * vec2(1.0, 2.6));
      m = max(m, smoothstep(r, r * 0.85, leaf));
    }
    return m;
  }

  void main() {
    vec2 uv = vUv;
    vec3 col = src(uv);
    vec2 px = topLeft(uv);
    float k = K();

    if (uMode == ${m('gaussian_noise')}) {
      float f = pick(0.03, 0.06, 0.12, 0.18, 0.22);
      col += vec3(gauss(px + uSeed), gauss(px + uSeed + 13.1), gauss(px + uSeed + 27.3)) * f;
    } else if (uMode == ${m('poisson_noise')}) {
      float f = pick(120.0, 105.0, 87.0, 55.0, 30.0);
      col += sqrt(col / f) * vec3(gauss(px + uSeed), gauss(px + uSeed + 5.1), gauss(px + uSeed + 9.7));
    } else if (uMode == ${m('impulse_noise')}) {
      float f = pick(0.01, 0.02, 0.04, 0.065, 0.10);
      for (int c = 0; c < 3; c++) {
        float r = hash(px + uSeed + float(c) * 17.0);
        if (r < f * 0.5) col[c] = 1.0;
        else if (r < f) col[c] = 0.0;
      }
    } else if (uMode == ${m('speckle_noise_filter')}) {
      float f = pick(0.02, 0.05, 0.09, 0.14, 0.2);
      col *= 1.0 + vec3(gauss(px + uSeed), gauss(px + uSeed + 3.3), gauss(px + uSeed + 6.6)) * f;
    } else if (uMode == ${m('defocus_blur')}) {
      col = diskBlur(uv, pick(2.0, 5.0, 6.0, 9.0, 12.0) * k);
    } else if (uMode == ${m('glass_blur')}) {
      float f = pick(2.0, 5.0, 6.0, 9.0, 12.0) * k;
      vec2 o = floor((vec2(hash(px + uSeed), hash(px + uSeed + 4.2)) * 2.0 - 1.0) * (f + 0.5));
      col = src(uv + o * vec2(1.0, -1.0) / uRes);
    } else if (uMode == ${m('motion_blur')}) {
      float size = pick(2.0, 4.0, 6.0, 10.0, 15.0) * k;
      float angle = radians(pick(5.0, 12.0, 20.0, 30.0, 45.0));
      vec2 dir = vec2(cos(angle), sin(angle)) * size / uRes;
      vec3 s = vec3(0.0);
      for (int i = 0; i < 17; i++) s += src(uv + dir * (float(i) / 16.0 - 0.5));
      col = s / 17.0;
    } else if (uMode == ${m('zoom_blur')}) {
      float zmax = pick(1.0, 1.10, 1.14, 1.20, 1.30);
      vec3 s = col;
      for (int i = 0; i < 16; i++) s += src(0.5 + (uv - 0.5) / mix(1.0, zmax, float(i) / 15.0));
      col = s / 17.0;
    } else if (uMode == ${m('increase_brightness')}) {
      vec3 h = rgb2hsv(col);
      h.z = min(h.z * pick(1.1, 1.2, 1.3, 1.5, 1.7), 1.0);
      col = hsv2rgb(h);
    } else if (uMode == ${m('decrease_brightness')}) {
      // Not in perturbationfuncs.py; mirrors increase_brightness with the inverse factors.
      vec3 h = rgb2hsv(col);
      h.z /= pick(1.1, 1.2, 1.3, 1.5, 1.7);
      col = hsv2rgb(h);
    } else if (uMode == ${m('contrast')}) {
      col = 0.5 + (col - 0.5) * pick(1.1, 1.2, 1.3, 1.5, 1.7);
    } else if (uMode == ${m('elastic')}) {
      float alpha = pick(2.0, 3.0, 5.0, 7.0, 10.0) * k;
      float sigma = pick(0.4, 0.75, 0.9, 1.2, 1.5) * k;
      vec2 cell = px / max(sigma * 2.0, 1.0);
      vec2 d = vec2(vnoise(cell + uSeed), vnoise(cell + uSeed + 31.0)) * 2.0 - 1.0;
      col = src(uv + d * alpha * 0.3 * vec2(1.0, -1.0) / uRes);
    } else if (uMode == ${m('pixelate')}) {
      float f = pick(0.85, 0.55, 0.35, 0.2, 0.1) * 320.0 / uRes.x;
      vec2 cells = floor(uRes * f);
      col = src((floor(uv * cells) + 0.5) / cells);
    } else if (uMode == ${m('jpeg_filter')}) {
      // Approximation: 8x8 block DC averaging and 2x chroma subsampling, stronger at lower quality.
      float q = pick(30.0, 18.0, 15.0, 10.0, 5.0);
      float strength = clamp(1.0 - q / 40.0, 0.0, 1.0);
      vec2 block = floor(px / (8.0 * k)) * 8.0 * k;
      vec3 dc = vec3(0.0);
      for (int i = 0; i < 4; i++) for (int j = 0; j < 4; j++) dc += src(fromTopLeft(block + (vec2(i, j) + 0.5) * 2.0 * k));
      dc /= 16.0;
      vec2 cblock = floor(px / (16.0 * k)) * 16.0 * k + 8.0 * k;
      vec3 chroma = src(fromTopLeft(cblock)) - luma(src(fromTopLeft(cblock)));
      vec3 y = vec3(mix(luma(col), luma(dc), strength * 0.85));
      col = y + mix(col - luma(col), chroma, strength);
    } else if (uMode == ${m('shear_image')}) {
      float sh = pick(0.12, 0.2, 0.32, 0.45, 0.6);
      col = srcBlack(fromTopLeft(vec2(px.x - sh * px.y, px.y)));
    } else if (uMode == ${m('translate_image')}) {
      vec2 t = vec2(pick(-0.1, 25.0, 40.0, 65.0, 90.0), pick(0.1, -25.0, -40.0, -65.0, -90.0)) * k;
      col = srcBlack(fromTopLeft(px - t));
    } else if (uMode == ${m('scale_image')}) {
      col = srcBlack(0.5 + (uv - 0.5) / pick(0.96, 0.9, 0.8, 0.68, 0.5));
    } else if (uMode == ${m('rotate_image')}) {
      float a = radians(pick(10.0, 20.0, 45.0, 90.0, 180.0));
      vec2 c = px - uRes * 0.5;
      vec2 r = mat2(cos(a), sin(a), -sin(a), cos(a)) * c;
      col = srcBlack(fromTopLeft(r + uRes * 0.5));
    } else if (uMode == ${m('fog_mapping')}) {
      float sev = pick(0.05, 0.12, 0.22, 0.35, 0.6);
      float n = fbm(uv * vec2(uRes.x / uRes.y, 1.0) * 3.0 + uSeed);
      col = mix(col, vec3(smoothstep(0.2, 0.8, n)), sev);
    } else if (uMode == ${m('splatter_mapping')}) {
      float sev = pick(0.1, 0.2, 0.3, 0.4, 0.5);
      float count = floor(sev * 50.0);
      float maxSize = max(6.0, floor(sev * 50.0));
      for (int i = 0; i < 25; i++) {
        float fi = float(i);
        if (fi >= count) break;
        vec2 c = vec2(rnd(fi, 1.0), rnd(fi, 2.0)) * uRes;
        float r = mix(5.0, maxSize, rnd(fi, 3.0)) * k;
        if (length(px - c) <= r) col = vec3(0.0);
      }
    } else if (uMode == ${m('dotted_lines_mapping')}) {
      float sev = pick(0.1, 0.2, 0.3, 0.4, 0.5);
      float lines = float(uScale + 1) * 10.0;
      float spacing = max(10.0, floor(50.0 * (1.0 - sev))) * k;
      float dotRadius = max(1.0, floor(sev * 5.0)) * k;
      for (int i = 0; i < 50; i++) {
        float fi = float(i);
        if (fi >= lines) break;
        vec2 start = vec2(rnd(fi, 11.0), rnd(fi, 12.0)) * uRes;
        float a = rnd(fi, 13.0) * 6.2831853;
        vec2 dir = vec2(cos(a), sin(a));
        float t = dot(px - start, dir);
        if (t < -dotRadius) continue;
        vec2 nearest = start + dir * max(0.0, floor(t / spacing + 0.5)) * spacing;
        if (length(px - nearest) <= dotRadius) col = vec3(0.0);
      }
    } else if (uMode == ${m('zigzag_mapping')}) {
      float sev = pick(0.1, 0.2, 0.3, 0.4, 0.6);
      float lines = max(1.0, floor(sev * 10.0));
      float amp = floor(20.0 * sev) * k;
      float freq = max(1.0, floor(10.0 * sev));
      for (int i = 0; i < 6; i++) {
        float fi = float(i);
        if (fi >= lines) break;
        vec2 start = vec2(rnd(fi, 21.0), rnd(fi, 22.0)) * uRes;
        float a = rnd(fi, 23.0) * 6.2831853;
        vec2 dir = vec2(cos(a), sin(a));
        vec2 nrm = vec2(-dir.y, dir.x);
        float t = dot(px - start, dir);
        float off = dot(px - start, nrm) - amp * sin(freq * t / (6.0 * k));
        if (t >= 0.0 && abs(off) < 0.8 * k) col = vec3(0.0);
      }
    } else if (uMode == ${m('canny_edges_mapping')}) {
      float sev = pick(0.01, 0.1, 0.25, 0.4, 0.7);
      vec2 e = vec2(1.0, 0.0) / uRes * k;
      float tl = luma(src(uv + vec2(-e.x, e.x))), t = luma(src(uv + vec2(0.0, e.x))), tr = luma(src(uv + vec2(e.x, e.x)));
      float l = luma(src(uv - vec2(e.x, 0.0))), r = luma(src(uv + vec2(e.x, 0.0)));
      float bl = luma(src(uv - vec2(e.x, e.x))), b = luma(src(uv - vec2(0.0, e.x))), br = luma(src(uv + vec2(e.x, -e.x)));
      float gx = (tr + 2.0 * r + br) - (tl + 2.0 * l + bl);
      float gy = (tl + 2.0 * t + tr) - (bl + 2.0 * b + br);
      float edge = step((150.0 + sev * 100.0) / 255.0, abs(gx) + abs(gy));
      col = col * 0.7 + vec3(edge * 0.3, 0.0, 0.0);
    } else if (uMode == ${m('false_color_filter')}) {
      vec3 c = col;
      if (uScale == 0) col = c.gbr;
      else if (uScale == 1) col = c.grb;
      else if (uScale == 2) col = c.bgr;
      else if (uScale == 3) col = 1.0 - c;
      else col = (c + c.gbr) * 0.5;
    } else if (uMode == ${m('high_pass_filter')}) {
      float ks = pick(35.0, 59.0, 83.0, 107.0, 113.0);
      float sigma = (0.3 * ((ks - 1.0) * 0.5 - 1.0) + 0.8) * k;
      col = col + (col - gaussianBlur(uv, sigma));
    } else if (uMode == ${m('low_pass_filter')}) {
      float ks = pick(15.0, 23.0, 30.0, 36.0, 40.0);
      float sigma = (0.3 * ((ks - 1.0) * 0.5 - 1.0) + 0.8) * k;
      vec3 h = rgb2hsv(col);
      h.z = rgb2hsv(gaussianBlur(uv, sigma)).z;
      col = hsv2rgb(h);
    } else if (uMode == ${m('phase_scrambling')}) {
      // Approximation: phase noise moves structure while keeping each region's colour energy.
      float sev = pick(0.05, 0.15, 0.26, 0.38, 0.55);
      vec2 w = vec2(fbm(uv * 12.0 + uSeed), fbm(uv * 12.0 + uSeed + 7.0)) - 0.5;
      vec3 scrambled = src(uv + w * sev * 0.25);
      col = mix(col, scrambled, sev * 1.6);
    } else if (uMode == ${m('histogram_equalisation')}) {
      // Approximation of CLAHE on V: local contrast stretch around an 8x8-tile mean.
      float clip = pick(1.0, 3.0, 5.0, 7.0, 10.0);
      vec3 h = rgb2hsv(col);
      float mean = rgb2hsv(wideBlur(uv, uRes.x / 14.0)).z;
      h.z = clamp(0.5 + (h.z - mean) * (1.0 + clip * 0.18), 0.0, 1.0);
      col = hsv2rgb(h);
    } else if (uMode == ${m('reflection_filter')}) {
      float sev = pick(0.2, 0.3, 0.45, 0.6, 0.9);
      float y = (1.0 - uv.y) * (1.0 + sev);
      float srcY = y <= 1.0 ? y : 1.0 - (y - 1.0);
      col = src(vec2(uv.x, 1.0 - srcY));
    } else if (uMode == ${m('white_balance_filter')}) {
      float sev = pick(0.1, 0.25, 0.5, 0.75, 0.99);
      vec3 avg = vec3(0.0);
      for (int i = 0; i < 6; i++) for (int j = 0; j < 4; j++) avg += src(vec2((float(i) + 0.5) / 6.0, (float(j) + 0.5) / 4.0));
      avg /= 24.0;
      vec3 balanced = clamp(col * (luma(avg) / max(avg, vec3(0.02))), 0.0, 1.0);
      col = mix(col, balanced, sev);
    } else if (uMode == ${m('sharpen_filter')}) {
      float sev = pick(1.0, 2.0, 3.0, 4.0, 5.0);
      float w = pick(0.9, 0.8, 0.7, 0.6, 0.5);
      vec2 e = 1.0 / uRes;
      vec3 sum = vec3(0.0);
      for (int i = -1; i <= 1; i++) for (int j = -1; j <= 1; j++) if (i != 0 || j != 0) sum += src(uv + vec2(i, j) * e);
      vec3 sharp = clamp((8.0 + sev) * col - sum, 0.0, 1.0);
      col = col * w + sharp * (1.0 - w);
    } else if (uMode == ${m('grayscale_filter')}) {
      col = mix(col, vec3(luma(col)), pick(0.1, 0.2, 0.35, 0.55, 0.85));
    } else if (uMode == ${m('posterize_filter')}) {
      float levels = pick(128.0, 64.0, 32.0, 8.0, 4.0);
      col = min(floor(col * 255.0 / (255.0 / levels)), levels - 1.0) * floor(255.0 / (levels - 1.0)) / 255.0;
    } else if (uMode == ${m('cutout_filter')}) {
      float patches = pick(1.0, 2.0, 4.0, 6.0, 10.0);
      for (int i = 0; i < 10; i++) {
        float fi = float(i);
        if (fi >= patches) break;
        vec2 size = mix(vec2(0.05), vec2(0.2), vec2(rnd(fi, 31.0), rnd(fi, 32.0))) * uRes.yx;
        vec2 corner = vec2(rnd(fi, 33.0), rnd(fi, 34.0)) * (uRes - size);
        if (all(greaterThanEqual(px, corner)) && all(lessThan(px, corner + size))) col = vec3(0.0);
      }
    } else if (uMode == ${m('sample_pairing_filter')}) {
      float alpha = pick(0.9, 0.7, 0.5, 0.3, 0.1);
      vec2 start = vec2(rnd(0.0, 41.0), rnd(0.0, 42.0)) * 0.5;
      vec2 tl = start + vec2(uv.x, 1.0 - uv.y) * 0.5;
      col = col * alpha + src(vec2(tl.x, 1.0 - tl.y)) * (1.0 - alpha);
    } else if (uMode == ${m('gaussian_blur')}) {
      float ks = pick(3.0, 7.0, 15.0, 25.0, 41.0);
      col = gaussianBlur(uv, (0.3 * ((ks - 1.0) * 0.5 - 1.0) + 0.8) * k);
    } else if (uMode == ${m('saturation_filter')} || uMode == ${m('saturation_decrease_filter')}) {
      float mul = uMode == ${m('saturation_filter')} ? pick(1.05, 1.15, 1.4, 1.65, 1.9) : pick(0.9, 0.85, 0.6, 0.35, 0.1);
      vec3 h = rgb2hsv(col);
      h.y = min(h.y * mul, 1.0);
      col = hsv2rgb(h);
    } else if (uMode == ${m('fog_filter')}) {
      // Depth fog: distant geometry fades first, with drifting density and forward scatter.
      float intensity = pick(0.1, 0.2, 0.3, 0.45, 0.65);
      float dist = sceneDepth(uv);
      float drift = 0.75 + 0.5 * fbm(uv * vec2(aspect(), 1.0) * 2.5 + vec2(uTime * 0.03, 0.0));
      float f = 1.0 - exp(-dist * intensity * 0.075 * drift);
      vec3 fogColor = mix(vec3(0.70, 0.73, 0.75), vec3(0.86, 0.87, 0.87), smoothstep(0.3, 0.9, uv.y));
      col = mix(col, gaussianBlur(uv, 3.0 * k), f * 0.6);
      col = mix(col, fogColor, f);
    } else if (uMode == ${m('frost_filter')}) {
      // Frost growing in from the frame edges: frosted glass with a fine crystal grain.
      float intensity = pick(0.15, 0.19, 0.25, 0.32, 0.4);
      vec2 p = uv * vec2(aspect(), 1.0);
      float edge = min(min(uv.x, 1.0 - uv.x), min(uv.y, 1.0 - uv.y));
      float reach = 0.04 + (intensity - 0.15) * 1.1;
      float wobble = (fbm(p * 5.0) - 0.5) * 0.18;
      float growth = smoothstep(reach, reach - 0.12, edge + wobble);
      float grain = fbm(p * 60.0);
      float sparkle = step(0.992, hash(floor(px / (1.5 * k))));
      vec3 glass = mix(gaussianBlur(uv, 2.5 * k), vec3(0.88, 0.92, 0.95), 0.7 + 0.2 * grain);
      col = mix(col, glass, growth * 0.92) + sparkle * growth * 0.25;
    } else if (uMode == ${m('dynamic_snow_filter')}) {
      // Snowfall: whitened, low-contrast scene with flakes falling at several depths.
      float intensity = pick(0.15, 0.25, 0.4, 0.6, 0.85);
      float dist = sceneDepth(uv);
      col = mix(col, vec3(luma(col)) * 0.9 + 0.12, intensity * 0.45);
      col = mix(col, vec3(0.88, 0.9, 0.93), (1.0 - exp(-dist * 0.03 * intensity)) * 0.8);
      float m = flakes(uv, uTime, 0.2 + 0.7 * intensity, 5.0, 0.0);
      col = mix(col, vec3(0.97, 0.98, 1.0), m);
    } else if (uMode == ${m('dynamic_rain_filter')}) {
      // Rain: darker, wetter scene with pale motion-blurred streaks.
      float intensity = pick(0.15, 0.25, 0.4, 0.6, 0.85);
      float dist = sceneDepth(uv);
      col = mix(col, vec3(luma(col)), intensity * 0.3) * (1.0 - 0.3 * intensity);
      col = mix(col, vec3(0.55, 0.58, 0.6), (1.0 - exp(-dist * 0.025 * intensity)) * 0.7);
      vec2 slant = vec2(uv.x + (1.0 - uv.y) * 0.12, uv.y);
      float m = flakes(slant, uTime * 1.6, 0.25 + 0.65 * intensity, 4.0, 1.0);
      col = mix(col, col * 0.4 + vec3(0.62, 0.66, 0.7), m * 0.75);
    } else if (uMode == ${m('dynamic_raindrop_filter')}) {
      // Drops on the lens: each refracts a small, flipped, softened view of the scene and
      // slides slowly down the glass.
      float intensity = pick(0.15, 0.25, 0.4, 0.6, 0.85);
      float count = floor(6.0 + 40.0 * intensity);
      col = mix(col, gaussianBlur(uv, 1.5 * k), intensity * 0.5);
      vec2 p = uv * vec2(aspect(), 1.0);
      for (int i = 0; i < 40; i++) {
        float fi = float(i);
        if (fi >= count) break;
        float r = 0.012 + 0.04 * pow(hash(vec2(fi, 1.0)), 2.0);
        float speed = 0.004 + 0.03 * hash(vec2(fi, 2.0)) * (r / 0.05);
        vec2 c = vec2(hash(vec2(fi, 3.0)) * aspect(), fract(hash(vec2(fi, 4.0)) - uTime * speed) * 1.2 - 0.1);
        vec2 d = (p - c) * vec2(1.0, 0.9);
        float len = length(d);
        if (len < r) {
          float lens = sqrt(1.0 - (len / r) * (len / r));
          vec2 refracted = uv - (d / vec2(aspect(), 1.0)) * (6.0 + lens * 8.0);
          vec3 inside = gaussianBlur(refracted, 2.0 * k) * (0.85 + 0.2 * lens);
          float rim = smoothstep(r * 0.82, r, len);
          float spec = smoothstep(r * 0.25, 0.0, length(d - vec2(-0.3, 0.35) * r));
          col = mix(inside, inside * 0.65, rim * 0.7) + spec * 0.4;
        }
      }
    } else if (uMode == ${m('dynamic_sun_filter')}) {
      // Low sun into the lens: veiling glare, bloom, starburst, horizontal streak and ghosts.
      float intensity = pick(0.15, 0.25, 0.4, 0.6, 0.85);
      vec2 sun = vec2(0.8 + 0.015 * sin(uTime * 0.4), 0.82);
      vec2 d = (uv - sun) * vec2(aspect(), 1.0);
      float r = length(d);
      float flicker = 0.85 + 0.15 * vnoise(vec2(uTime * 1.5, 0.0));
      vec3 sunColor = vec3(1.0, 0.86, 0.62);
      col = col * (1.0 - 0.3 * intensity) + intensity * 0.3 * sunColor;
      float glare = exp(-r * 22.0) * 3.0 + exp(-r * 5.0) * 0.6 + exp(-r * 1.6) * 0.25;
      float star = pow(abs(cos(atan(d.y, d.x) * 3.0)), 60.0) * exp(-r * 4.0) * 0.8;
      float streak = exp(-abs(d.y) * 120.0) * exp(-abs(d.x) * 2.2) * 0.9;
      vec3 light = sunColor * (glare + star) + vec3(0.75, 0.85, 1.0) * streak;
      vec2 axis = vec2(0.5) - sun;
      for (int i = 1; i <= 4; i++) {
        float fi = float(i);
        vec2 gc = sun + axis * (0.6 + fi * 0.42);
        float gr = 0.02 + 0.035 * hash(vec2(fi, 7.0));
        float g = smoothstep(gr, gr * 0.6, length((uv - gc) * vec2(aspect(), 1.0)));
        vec3 tint = fi == 1.0 ? vec3(1.0, 0.6, 0.3) : fi == 2.0 ? vec3(0.4, 1.0, 0.6) : fi == 3.0 ? vec3(0.6, 0.5, 1.0) : vec3(1.0, 0.9, 0.5);
        light += tint * g * 0.18;
      }
      col += light * intensity * 1.4 * flicker;
      col = 1.0 - exp(-col * 1.15);
      col /= 1.0 - exp(-1.15);
    } else if (uMode == ${m('dynamic_lightning_filter')}) {
      // Storm light: a darkened scene, then a bolt and a flash every few seconds.
      float intensity = pick(0.15, 0.25, 0.4, 0.6, 0.85);
      float cycle = uTime * 0.45;
      float strike = floor(cycle);
      float phase = fract(cycle);
      float flash = phase < 0.18 ? (1.0 - phase / 0.18) * (0.6 + 0.4 * step(0.5, fract(phase * 22.0))) : 0.0;
      col *= 1.0 - 0.45 * intensity;
      col = mix(col, col * vec3(0.8, 0.85, 1.0) * 2.6 + 0.08, flash * intensity);
      if (flash > 0.0) {
        float bd = boltDistance(uv, strike);
        float bolt = smoothstep(0.004, 0.0, bd) + exp(-bd * 60.0) * 0.6;
        col += vec3(0.85, 0.9, 1.0) * bolt * flash * (0.5 + intensity);
      }
    } else if (uMode == ${m('dynamic_smoke_filter')}) {
      // Drifting smoke, thicker near the ground.
      float intensity = pick(0.15, 0.25, 0.4, 0.6, 0.85);
      float density = smokeDensity(uv, uTime) * intensity * 1.15;
      vec3 smoke = vec3(0.52, 0.52, 0.5) * (0.85 + 0.3 * fbm(uv * 6.0 + uTime * 0.05));
      col = mix(col, smoke, clamp(density, 0.0, 0.95));
    } else if (uMode == ${m('dynamic_object_overlay')}) {
      // Objects crossing the lens: leaves blown past, blending at the library's intensity.
      float intensity = pick(0.15, 0.25, 0.4, 0.6, 0.85);
      col = mix(col, vec3(0.08, 0.1, 0.06), leaves(uv, uTime) * (0.35 + 0.65 * intensity));
    } else if (uMode == ${m('object_overlay')}) {
      // The library pastes the TUM logo, sized to 1/c of the frame height, at the centre.
      float h = 1.0 / pick(10.0, 5.0, 3.0, 2.0, 1.5);
      vec2 size = vec2(h * 2.0 * uRes.y / uRes.x, h);
      vec2 q = (uv - (0.5 - size * 0.5)) / size;
      if (all(greaterThanEqual(q, vec2(0.0))) && all(lessThanEqual(q, vec2(1.0)))) {
        vec4 logo = texture2D(tLogo, q);
        if (logo.a > 0.5) col = logo.rgb;
      }
    }

    gl_FragColor = vec4(clamp(col, 0.0, 1.0), 1.0);
  }
`;
