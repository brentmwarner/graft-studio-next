# Desktop dither reference frames

These PNGs were captured from the desktop's exported scene with UnicornStudio
2.1.3 in Chromium, at a 402 × 874 CSS-pixel viewport and device pixel ratio 1.
They are independent of the native renderer.

## Capture settings

- Load `apps/web/src/assets/unicorn-scene-light.json` or `unicorn-scene.json`
  using the same `addScene` options as `UnicornBackground.tsx`.
- Wait for the `uSprite` texture to load (360 × 40 pixels).
- Pause the scene and set every layer's `animating` property to `false`.
- Set the noise layer's `uniforms.time.value` to `seconds * 60 * 0.11`; leave
  the grain clock at zero. Call `scene.renderFrame()` before each capture.
- Apply the desktop CSS vignette: `radial-gradient(ellipse 65% 55% at 50% 50%,
transparent 0%, var(--background) 100%)`, with `#fcfcfc` in light mode and
  `#0e0e0e` in dark mode. Capture the background without foreground content.

The filenames record theme and elapsed seconds. Tests allow small pixel
differences because WebGL and Metal can produce different floating-point grain
hashes. Do not regenerate these fixtures from the native implementation.

## Source SHA-256

| Source       | SHA-256                                                            |
| ------------ | ------------------------------------------------------------------ |
| Dark scene   | `56ca54f8a2b286b66b86959fd047652aabd0b59967cff33fd98bc0c1f55a7654` |
| Light scene  | `24a365baa9ccb19908f7e0e65082c60a1ae362d77bbcffaa374372830b6d84ef` |
| Circle atlas | `5be433a48e8e2b8cbf4c4e872992c2e65759562e240cfe4f327c9e78a24f9395` |
