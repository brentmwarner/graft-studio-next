/// Native `DitherWaveRenderer` time: UnicornStudio increments uTime by speed
/// once per 60 Hz frame (`seconds * 60 * 0.11`).
export function ditherWaveTime(elapsedSeconds: number, reduceMotion: boolean): number {
  return reduceMotion ? 0 : elapsedSeconds * 60 * 0.11;
}

export function ditherWaveSurface(dark: boolean): number {
  return dark ? 14 / 255 : 252 / 255;
}

export function ditherWaveCanvas(dark: boolean): number {
  return dark ? 23 / 255 : 1;
}

export const DITHER_WAVE_VERTEX = `
attribute vec2 position;
void main() {
  gl_Position = vec4(position, 0.0, 1.0);
}
`;

/// Fused field + glyph-dither composite, ported from
/// `apps/ios/Graft/Views/Onboarding/DitherWaveShader.metal`.
export const DITHER_WAVE_FRAGMENT = `
precision highp float;

uniform vec2 uResolution;
uniform float uTime;
uniform float uDark;
uniform sampler2D uGlyphs;
uniform float uHasGlyphs;

vec3 hash33(vec3 p3) {
  p3 = fract(p3 * vec3(0.1031, 0.11369, 0.13787));
  p3 += dot(p3, p3.yxz + 19.19);
  return -1.0 + 2.0 * fract(vec3(
    (p3.x + p3.y) * p3.z,
    (p3.x + p3.z) * p3.y,
    (p3.y + p3.z) * p3.x
  ));
}

float perlin(vec3 p) {
  vec3 pi = floor(p);
  vec3 pf = p - pi;
  vec3 w = pf * pf * (3.0 - 2.0 * pf);
  float n000 = dot(pf - vec3(0.0), hash33(pi + vec3(0.0)));
  float n100 = dot(pf - vec3(1.0, 0.0, 0.0), hash33(pi + vec3(1.0, 0.0, 0.0)));
  float n010 = dot(pf - vec3(0.0, 1.0, 0.0), hash33(pi + vec3(0.0, 1.0, 0.0)));
  float n110 = dot(pf - vec3(1.0, 1.0, 0.0), hash33(pi + vec3(1.0, 1.0, 0.0)));
  float n001 = dot(pf - vec3(0.0, 0.0, 1.0), hash33(pi + vec3(0.0, 0.0, 1.0)));
  float n101 = dot(pf - vec3(1.0, 0.0, 1.0), hash33(pi + vec3(1.0, 0.0, 1.0)));
  float n011 = dot(pf - vec3(0.0, 1.0, 1.0), hash33(pi + vec3(0.0, 1.0, 1.0)));
  float n111 = dot(pf - vec3(1.0), hash33(pi + vec3(1.0)));
  float nx00 = mix(n000, n100, w.x);
  float nx01 = mix(n001, n101, w.x);
  float nx10 = mix(n010, n110, w.x);
  float nx11 = mix(n011, n111, w.x);
  return mix(mix(nx00, nx10, w.y), mix(nx01, nx11, w.y), w.z);
}

float waveNoise(vec2 uv, float time) {
  vec2 skew = vec2(0.53, 0.47);
  vec2 drift = vec2(0.0, time * 0.0125) * mix(1.0, 14.0, 0.11);
  float n = perlin(vec3(uv * skew - drift, 0.08 + time * 0.03));
  return mix(0.5, n * 0.5 + 0.5, 3.2);
}

float palette(float t, float col1, float col2) {
  float mid = 0.5 * (col1 + col2);
  float axisAmp = 0.5 * (col2 - col1);
  float col = mid + axisAmp * cos(6.28318530718 * t);
  col = 1.0 / (1.0 + exp(-col * 4.0 + 0.25) * 7.5);
  return clamp(col, 0.0, 1.0);
}

float overlay(float src, float dst) {
  return dst <= 0.5 ? 2.0 * src * dst : 1.0 - 2.0 * (1.0 - dst) * (1.0 - src);
}

float softLight(float src, float dst) {
  if (src <= 0.5) return dst - (1.0 - 2.0 * src) * dst * (1.0 - dst);
  if (dst <= 0.25) {
    return dst + (2.0 * src - 1.0) * (4.0 * dst * (4.0 * dst + 1.0) * (dst - 1.0) + 7.0 * dst);
  }
  return dst + (2.0 * src - 1.0) * (sqrt(dst) - dst);
}

float randFibo(vec2 p) {
  return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123);
}

float unorm8(float value) {
  return floor(clamp(value, 0.0, 1.0) * 255.0 + 0.5) / 255.0;
}

float fieldAt(vec2 pixel, vec2 uv) {
  float aspect = uResolution.x / uResolution.y;
  vec2 st = (uv - 0.5) * vec2(aspect, 1.0) * mix(1.0, 14.0, 0.11);
  float noise = waveNoise(st, uTime);
  noise = smoothstep(noise - 0.5, noise + 0.5, 0.56);
  float tone = palette(noise + 1.0 + 0.55 * uTime * 0.01, mix(1.0, 0.93333333333, uDark), 0.0);
  tone += (randFibo(pixel) - 0.5) / 255.0 * 0.5;
  float field = unorm8(clamp(overlay(0.0, tone), 0.0, 1.0) * mix(0.86, 0.52, uDark));
  return softLight(randFibo(pixel), field);
}

float proceduralGlyph(vec2 local, float index) {
  float radius = (index + 1.0) / 20.0;
  return smoothstep(radius, radius - 0.04, length(local - 0.5));
}

void main() {
  vec2 pixel = vec2(gl_FragCoord.x, uResolution.y - gl_FragCoord.y);
  vec2 uv = pixel / uResolution;
  float aspect = uResolution.x / uResolution.y;
  float aspectCorrection = mix(aspect, 1.0 / aspect, 0.5);
  float gridSize = mix(0.05, 0.005, 0.98);
  vec2 cellSize = vec2(gridSize / aspect, gridSize) * aspectCorrection;
  vec2 cell = floor((uv - 0.5) / cellSize);
  vec2 center = (cell + 0.5) * cellSize + 0.5;
  vec2 fieldPixel = center * uResolution;
  float luminance = fieldAt(vec2(fieldPixel.x, uResolution.y - fieldPixel.y), center);

  float count = 9.0;
  float index = clamp(floor(luminance * count), 0.0, count - 1.0);
  float gamma = pow(mix(0.2, 2.2, 0.42), 2.2);
  float gammaIndex = clamp(floor(luminance * count * gamma), 0.0, count - 1.0);
  vec2 local = fract((uv - 0.5) / cellSize);
  local = clamp(local, 0.5 / 32.0, 1.0 - 0.5 / 32.0);

  float alpha;
  if (uHasGlyphs > 0.5) {
    vec2 spriteUV = vec2((gammaIndex + local.x) / count, local.y);
    alpha = smoothstep(0.0, 1.0, texture2D(uGlyphs, spriteUV).r);
  } else {
    alpha = proceduralGlyph(local, gammaIndex);
  }

  float ink = (luminance - index * 0.04) * 1.4;
  float canvas = mix(1.0, 23.0 / 255.0, uDark);
  float composite = unorm8(unorm8(ink * alpha) + canvas * (1.0 - unorm8(alpha)));
  float fade = clamp(length((uv - 0.5) / vec2(0.65, 0.55)), 0.0, 1.0);
  float surface = mix(252.0 / 255.0, 14.0 / 255.0, uDark);
  float tone = mix(composite, surface, fade);
  gl_FragColor = vec4(vec3(tone), 1.0);
}
`;
