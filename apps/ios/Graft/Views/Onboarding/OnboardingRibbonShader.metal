//
//  OnboardingRibbonShader.metal
//  Fetch — onboarding home background
//
//  A "following ribbon beam": one holographic/metallic ribbon that sweeps
//  corner-to-corner (enters top-right, bows right mid-screen, curves down to the
//  bottom-left), drawn with fine combed striations running along its flow.
//
//  Ported 1:1 from the web studio (explorations/onboarding-home/index.html) with
//  the locked "Fetch chrome" (silver) preset baked in as constants. Runs as a
//  SwiftUI `.colorEffect`, so it composites straight over the active theme
//  ground — the left half stays clean for the mark + CTAs.
//
//  Helpers are file-local (static + obr_ prefix) so they never collide with the
//  other shader translation units (NewChatShaders / AnomalousMatterShaders).
//

#include <metal_stdlib>
using namespace metal;

// ── file-local noise (value-noise FBM with domain warp) ─────────────────────
static inline float obr_hash21(float2 p) {
    p = fract(p * float2(123.34, 345.45));
    p += dot(p, p + 34.345);
    return fract(p.x * p.y);
}

static inline float obr_vnoise(float2 p) {
    float2 i = floor(p), f = fract(p);
    float2 u = f * f * (3.0 - 2.0 * f);
    float a = obr_hash21(i);
    float b = obr_hash21(i + float2(1.0, 0.0));
    float c = obr_hash21(i + float2(0.0, 1.0));
    float d = obr_hash21(i + float2(1.0, 1.0));
    return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}

static inline float obr_fbm(float2 p) {
    float v = 0.0, a = 0.55;
    float2x2 m = float2x2(1.6, 1.2, -1.2, 1.6);   // column-major, matches the GLSL mat2
    for (int i = 0; i < 5; i++) { v += a * obr_vnoise(p); p = m * p; a *= 0.5; }
    return v;
}

// ── stitchable color effect ─────────────────────────────────────────────────
// position: pixel location in the view's user space (points, origin top-left).
// size:     view size in points (passed from SwiftUI via .visualEffect proxy).
// time:     seconds since the view appeared.
// reveal:   0→1 first-appearance wipe (the ribbon draws on from the top); held
//           at 1 once settled (and always 1 for reduce-motion).
// dark:     0 for the white-ground treatment, 1 for the black-ground treatment.
[[ stitchable ]]
half4 onboardingRibbon(float2 position, half4 color, float2 size, float time, float reveal, float dark) {
    const float PI = 3.14159265358979;

    // Locked "Fetch chrome" preset (exported from the studio, 2026-06-27).
    const float kBeamCenter = 0.52;   // horizontal bias of the sweep
    const float kBeamWidth  = 0.115;  // ribbon half-width (at the neck)
    const float kFlowWarp   = 0.06;   // organic boundary jitter
    const float kCurve      = 0.86;   // mid-screen rightward bow
    const float kStriation  = 20.0;   // filament density across the ribbon
    const float kTimeScale  = 0.96;   // speed 0.12 × 8 (studio time mapping)
    const float kIntensity  = 0.97;   // overall ribbon opacity
    const float kGrain      = 0.015;  // dither to warm the flat white

    // WebGL sampled with origin bottom-left; flip Y so y == 1 is the top.
    float2 uv = float2(position.x / size.x, 1.0 - position.y / size.y);
    float t = time * kTimeScale;

    half dmode = half(clamp(dark, 0.0, 1.0));
    half3 ground = mix(half3(1.0h), half3(0.0h), dmode);
    half3 outc = ground;

    for (int i = 0; i < 5; i++) {                // layered strands → a fuller fan
        float fi = float(i);
        float ph = fi * 1.7;
        float y  = uv.y;

        // Centerline sweeps corner-to-corner: enters top-right narrow, bows right
        // mid-screen, then curves down and FANS WIDE across to the bottom-left.
        float diag  = mix(-0.30, 0.12, y);
        float bulge = kCurve * 0.42 * sin(y * PI);
        float splay = (fi - 2.0) * mix(0.10, 0.012, y);   // strands splay toward the tail
        float cx = kBeamCenter + diag + bulge + splay
                 + 0.045 * (sin(y * 3.0 + t * 0.5 + ph) + 0.6 * sin(y * 5.0 - t * 0.4 + ph));
        cx += (obr_fbm(float2(y * 2.2 + ph, t * 0.15)) - 0.5) * kFlowWarp;

        // Narrow at the head (top), fanning out dramatically toward the tail.
        float w = kBeamWidth * mix(2.9, 0.40, y)
                * (1.0 + 0.18 * sin(y * 1.6 + t * 0.5 + ph));

        float d    = (uv.x - cx) / max(w, 0.04);          // cross-ribbon coord
        float body = 1.0 - smoothstep(0.0, 1.2, abs(d));  // feathered ribbon body
        if (body <= 0.0) continue;

        // Fine striations parallel to the ribbon (constant-d lines), warped.
        float dl = d + 0.07 * obr_fbm(float2(d * 3.0, y * 4.5 - t * 0.25));
        float stripe = 0.5 + 0.5 * sin(dl * kStriation * PI + y * 2.4 + t * 0.7 + ph * 2.0);
        stripe = pow(clamp(stripe, 0.0, 1.0), 1.5);       // crisp filaments

        half lightSilver = half(mix(0.14, 0.97, stripe));
        half darkSilver = half(mix(0.07, 0.82, stripe));
        half3 col = half3(mix(lightSilver, darkSilver, dmode));
        float a = body * mix(0.30, 1.0, stripe) * kIntensity;
        half opacity = mix(0.55h, 0.66h, dmode);
        outc = mix(outc, col, half(clamp(a, 0.0, 1.0)) * opacity);
    }

    // ── first-appearance reveal ─────────────────────────────────────────────
    // The ribbon wipes on from the TOP (uv.y == 1) down to the bottom as
    // `reveal` 0→1, led by a holographic crest that fades once it lands. Below
    // the moving front the frame is still the plain white ground, so the ribbon
    // reads as being *drawn* downward rather than just fading in.
    float front = mix(1.14, -0.14, clamp(reveal, 0.0, 1.0));   // travels top → bottom
    float band  = 0.13;
    float shown = smoothstep(front - band, front + band, uv.y);
    float crest = smoothstep(band, 0.0, abs(uv.y - front))      // bright at the wavefront
                * smoothstep(1.0, 0.72, reveal);                // …fading out as it settles

    // crest: lift + a cool prismatic tint riding the front (the holographic head)
    half3 iris = half3(0.60h, 0.73h, 1.0h);
    half3 crestColor = mix(
        clamp(outc * 1.16h + iris * 0.12h, 0.0h, 1.0h),
        clamp(outc + half3(0.22h, 0.25h, 0.30h), 0.0h, 1.0h),
        dmode
    );
    outc = mix(outc, crestColor, half(crest * 0.85));
    // wipe: everything below the front is still the untouched theme ground
    outc = mix(ground, outc, half(shown));

    float g = (obr_hash21(position * 0.5 + t) * 2.0 - 1.0) * kGrain;
    outc += half3(g) * half(shown);                            // grain only on revealed area
    return half4(outc, 1.0h);
}

// ── pill glass: deep, see-through "black glass" via two composited passes ────
// A SwiftUI `.colorEffect` can only *veil* (over-composite), which lifts dark
// glass toward grey over a light ground — turn the opacity down and you get a
// grey pill, not a transparent black one. To stay genuinely BLACK while still
// transmitting the backdrop, the pill is built from two passes whose SwiftUI
// blend modes composite against the ribbon directly:
//
//   • TINT  (onboardingPillGlassTint) — a dark transmission multiplier, drawn
//            with `.blendMode(.multiply)`: result = backdrop × tint. Anchored
//            near ~0.13, the body stays deep/black whatever the backdrop, yet
//            the backdrop's texture still reads through → see-through glass with
//            no grey lift. (multiply, unlike over, can't wash toward white.)
//   • SPEC  (onboardingPillGlassSpec) — additive sheen / specular rim / bounce
//            + a whisper of edge dispersion, drawn with `.blendMode(.plusLighter)`
//            so the highlights add real light *on top* of the dark body.
//
// Net read: transmission×backdrop + reflection — the physical glass model.
// Coverage (incl. the anti-aliased edge) comes from the filled capsule each
// pass is applied to. Both passes are fully static.

// shared capsule geometry for the two pill passes.
struct OpgGeom { float2 uv; float2 nrm; float rim; float inside; };
static inline OpgGeom opg_geom(float2 position, float2 size) {
    OpgGeom g;
    g.uv = position / size;                              // origin top-left, 0…1
    float r = size.y * 0.5;
    float2 a = float2(r, r);
    float2 b = float2(size.x - r, r);
    float2 pa = position - a, ba = b - a;
    float hSeg = clamp(dot(pa, ba) / max(dot(ba, ba), 1e-4), 0.0, 1.0);
    float2 toEdge = pa - ba * hSeg;
    float lenEdge = length(toEdge);
    float sd = lenEdge - r;                               // < 0 inside
    g.nrm = lenEdge > 1e-4 ? toEdge / lenEdge : float2(0.0, -1.0);
    g.rim = 1.0 - smoothstep(0.0, 0.11 * r, -sd);         // 0 core → 1 edge (tight = thin glass border)
    g.inside = clamp(-sd / r, 0.0, 1.0);                  // 0 rim → 1 core
    return g;
}

// TINT pass — transmission multiplier (composite with `.blendMode(.multiply)`).
// Lower = darker / less see-through; 1.0 = fully clear. The body sits near
// ~0.13, so backdrop × 0.13 stays black-ish for any backdrop. `darkness` is the
// single knob here. Light pill (d=0) rides much higher so it barely tints.
[[ stitchable ]]
half4 onboardingPillGlassTint(float2 position, half4 color, float2 size, float dark) {
    float cov = float(color.a);
    if (cov <= 0.0001) return half4(0.0h);
    OpgGeom g = opg_geom(position, size);
    half d = half(dark);

    // deep, lightly graded transmission — a touch more open at the very top.
    half base = mix(0.66h, 0.13h, d);                     // light pill vs deep black glass
    half grad = half(mix(1.16, 0.84, smoothstep(0.0, 1.0, g.uv.y)));
    half t = clamp(base * grad, 0.04h, 1.0h);

    // the curved rim refracts a little more backdrop through — a thin glassy lip.
    t = mix(t, min(t + 0.16h, 1.0h), half(g.rim));

    return half4(half3(t) * half(cov), half(cov));        // premultiplied; ×backdrop
}

// SPEC pass — additive reflections (composite with `.blendMode(.plusLighter)`).
// Pure black where there's no highlight, so it only ever *adds* light onto the
// dark transmission below it.
[[ stitchable ]]
half4 onboardingPillGlassSpec(float2 position, half4 color, float2 size, float dark) {
    float cov = float(color.a);
    if (cov <= 0.0001) return half4(0.0h);
    OpgGeom g = opg_geom(position, size);
    half d = half(dark);

    half3 s = half3(0.0h);

    // top reflection: an elongated sheen high on the dome, fading at the ends.
    float sheen = smoothstep(0.0, 0.15, g.uv.y) * (1.0 - smoothstep(0.15, 0.52, g.uv.y));
    sheen *= mix(0.55, 1.0, g.inside);
    s += half(sheen) * mix(0.10h, 0.30h, d);

    // specular rim / lip: bright at the very edge, strongest along the top.
    float rimSpec = g.rim * mix(0.35, 1.0, 1.0 - g.uv.y);
    s += half(rimSpec) * mix(0.14h, 0.40h, d);

    // gentle bottom bounce light.
    float bounce = smoothstep(0.6, 1.0, g.uv.y) * g.rim;
    s += half(bounce) * mix(0.05h, 0.12h, d);

    // chromatic refraction: a whisper of prismatic colour hugging the very edge,
    // concentrated by rim^3 so it never becomes a stripe down the side.
    float ang = atan2(g.nrm.y, g.nrm.x);
    half3 prism = half3(0.5h + 0.5h * half(cos(ang)),
                        0.5h + 0.5h * half(cos(ang - 2.0944)),
                        0.5h + 0.5h * half(cos(ang + 2.0944)));
    s += (prism - 0.5h) * half(g.rim * g.rim * g.rim) * mix(0.035h, 0.06h, d);

    s = max(s, half3(0.0h));
    return half4(s * half(cov), half(cov));               // premultiplied; adds light
}
