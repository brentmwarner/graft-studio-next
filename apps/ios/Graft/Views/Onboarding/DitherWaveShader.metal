// Native rendering of the desktop new-chat Glyph Waves scene.
// Source: apps/web/src/assets/unicorn-scene{,-light}.json and
// apps/web/src/components/chat/UnicornBackground.tsx.
// Keep the source's black shape input, nine-glyph atlas, framebuffer
// quantization, bottom-left UVs, and 60 Hz time units when updating this port.

#include <metal_stdlib>
using namespace metal;

static inline float3 dw_hash33(float3 p3) {
    p3 = fract(p3 * float3(0.1031, 0.11369, 0.13787));
    p3 += dot(p3, p3.yxz + 19.19);
    return -1.0 + 2.0 * fract(float3(
        (p3.x + p3.y) * p3.z,
        (p3.x + p3.z) * p3.y,
        (p3.y + p3.z) * p3.x
    ));
}

static inline float dw_perlin(float3 p) {
    float3 pi = floor(p);
    float3 pf = p - pi;
    float3 w = pf * pf * (3.0 - 2.0 * pf);

    float n000 = dot(pf - float3(0.0, 0.0, 0.0), dw_hash33(pi + float3(0.0, 0.0, 0.0)));
    float n100 = dot(pf - float3(1.0, 0.0, 0.0), dw_hash33(pi + float3(1.0, 0.0, 0.0)));
    float n010 = dot(pf - float3(0.0, 1.0, 0.0), dw_hash33(pi + float3(0.0, 1.0, 0.0)));
    float n110 = dot(pf - float3(1.0, 1.0, 0.0), dw_hash33(pi + float3(1.0, 1.0, 0.0)));
    float n001 = dot(pf - float3(0.0, 0.0, 1.0), dw_hash33(pi + float3(0.0, 0.0, 1.0)));
    float n101 = dot(pf - float3(1.0, 0.0, 1.0), dw_hash33(pi + float3(1.0, 0.0, 1.0)));
    float n011 = dot(pf - float3(0.0, 1.0, 1.0), dw_hash33(pi + float3(0.0, 1.0, 1.0)));
    float n111 = dot(pf - float3(1.0, 1.0, 1.0), dw_hash33(pi + float3(1.0, 1.0, 1.0)));

    float nx00 = mix(n000, n100, w.x);
    float nx01 = mix(n001, n101, w.x);
    float nx10 = mix(n010, n110, w.x);
    float nx11 = mix(n011, n111, w.x);
    float nxy0 = mix(nx00, nx10, w.y);
    float nxy1 = mix(nx01, nx11, w.y);
    return mix(nxy0, nxy1, w.z);
}

static inline float dw_waveNoise(float2 uv, float time) {
    const float turbulence = 1.0;
    const float direction = 0.53;
    const float driftVal = 1.0;
    const float scale = 0.11;
    const float phase = 0.08;
    float turb = turbulence * 3.2;
    float2 skew = float2(direction, 1.0 - direction);
    float2 drift = float2(0.0, driftVal * time * 0.0125) * mix(1.0, 14.0, scale);
    float n = dw_perlin(float3(uv * skew - drift, phase + time * 0.03));
    return mix(0.5, n * 0.5 + 0.5, turb);
}

static inline float dw_palette(float t, float col1, float col2) {
    float mid = 0.5 * (col1 + col2);
    float axisAmp = 0.5 * (col2 - col1);
    float col = mid + axisAmp * cos(6.28318530718 * t);
    col = 1.0 / (1.0 + exp(-col * 4.0 + 0.25) * 7.5);
    return clamp(col, 0.0, 1.0);
}

static inline float dw_overlay(float src, float dst) {
    return dst <= 0.5
        ? 2.0 * src * dst
        : 1.0 - 2.0 * (1.0 - dst) * (1.0 - src);
}

static inline float dw_softLight(float src, float dst) {
    if (src <= 0.5) {
        return dst - (1.0 - 2.0 * src) * dst * (1.0 - dst);
    }
    if (dst <= 0.25) {
        return dst + (2.0 * src - 1.0) * (4.0 * dst * (4.0 * dst + 1.0) * (dst - 1.0) + 7.0 * dst);
    }
    return dst + (2.0 * src - 1.0) * (sqrt(dst) - dst);
}

static inline uint2 dw_pcg2d(uint2 v) {
    v = v * 1664525u + 1013904223u;
    v.x += v.y * v.y * 1664525u + 1013904223u;
    v.y += v.x * v.x * 1664525u + 1013904223u;
    v ^= v >> 16;
    v.x += v.y * v.y * 1664525u + 1013904223u;
    v.y += v.x * v.x * 1664525u + 1013904223u;
    return v;
}

static inline float dw_randFibo(float2 p) {
    uint2 v = as_type<uint2>(p);
    v = dw_pcg2d(v);
    uint r = v.x ^ v.y;
    return float(r) / float(0xffffffffu);
}

struct DitherWaveUniforms {
    float2 resolution;
    float time;
    float dark;
};

struct DitherWaveVertex {
    float4 position [[position]];
};

vertex DitherWaveVertex ditherWaveVertex(uint index [[vertex_id]]) {
    const float2 positions[] = { float2(-1, -1), float2(3, -1), float2(-1, 3) };
    return { float4(positions[index], 0, 1) };
}

static inline float dw_unorm8(float value) {
    return round(saturate(value) * 255.0) / 255.0;
}

// Fuse noiseFill and grain while preserving the RGBA8 boundary between them.
fragment float4 ditherWaveField(
    DitherWaveVertex in [[stage_in]],
    constant DitherWaveUniforms &u [[buffer(0)]]
) {
    float2 pixel = float2(in.position.x, u.resolution.y - in.position.y);
    float2 uv = pixel / u.resolution;
    float aspect = u.resolution.x / u.resolution.y;
    float2 st = (uv - 0.5) * float2(aspect, 1.0) * mix(1.0, 14.0, 0.11);
    float noise = dw_waveNoise(st, u.time);
    noise = smoothstep(noise - 0.5, noise + 0.5, 0.56);
    float palette = dw_palette(noise + 1.0 + 0.55 * u.time * 0.01,
                               mix(1.0, 0.93333333333, u.dark), 0.0);
    palette += (dw_randFibo(pixel) - 0.5) / 255.0 * 0.5;
    // Effects belong to the black shape, not the theme's background gradient.
    float field = dw_unorm8(saturate(dw_overlay(0.0, palette)) * mix(0.86, 0.52, u.dark));
    field = dw_softLight(dw_randFibo(pixel), field);
    return float4(float3(field), 1.0);
}

fragment float4 ditherWaveComposite(
    DitherWaveVertex in [[stage_in]],
    constant DitherWaveUniforms &u [[buffer(0)]],
    texture2d<float> field [[texture(0)]],
    texture2d<float> glyphs [[texture(1)]]
) {
    constexpr sampler linearSampler(coord::normalized, address::clamp_to_edge, filter::linear);
    float2 uv = float2(in.position.x, u.resolution.y - in.position.y) / u.resolution;
    float aspect = u.resolution.x / u.resolution.y;
    float aspectCorrection = mix(aspect, 1.0 / aspect, 0.5);
    float gridSize = mix(0.05, 0.005, 0.98);
    float2 cellSize = float2(gridSize / aspect, gridSize) * aspectCorrection;
    float2 cell = floor((uv - 0.5) / cellSize);
    float2 center = (cell + 0.5) * cellSize + 0.5;
    // Metal textures have a top-left origin; the exported scene uses bottom-left UVs.
    float luminance = field.sample(linearSampler, float2(center.x, 1.0 - center.y)).r;
    float glyphHeight = float(glyphs.get_height());
    float count = float(glyphs.get_width()) / glyphHeight;
    float index = clamp(floor(luminance * count), 0.0, count - 1.0);
    float gamma = pow(mix(0.2, 2.2, 0.42), 2.2);
    float gammaIndex = clamp(floor(luminance * count * gamma), 0.0, count - 1.0);
    float2 local = fract((uv - 0.5) / cellSize);
    local = clamp(local, 0.5 / glyphHeight, 1.0 - 0.5 / glyphHeight);
    float2 spriteUV = float2((gammaIndex + local.x) / count, local.y);
    float alpha = smoothstep(0.0, 1.0, glyphs.sample(linearSampler, spriteUV).r);
    float ink = (luminance - index * 0.04) * 1.4;

    // glyphDither outputs premultiplied color into RGBA8 before the shape
    // composites over the scene gradient. Preserve both rounding boundaries.
    float canvas = mix(1.0, 23.0 / 255.0, u.dark);
    float composite = dw_unorm8(dw_unorm8(ink * alpha) + canvas * (1.0 - dw_unorm8(alpha)));
    float fade = saturate(length((uv - 0.5) / float2(0.65, 0.55)));
    // The web app's CSS vignette fades to its surface token, not the canvas color.
    float surface = mix(252.0 / 255.0, 14.0 / 255.0, u.dark);
    return float4(float3(mix(composite, surface, fade)), 1.0);
}
