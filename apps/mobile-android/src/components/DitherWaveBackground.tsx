import { Asset } from "expo-asset";
import { GLView, type ExpoWebGLRenderingContext } from "expo-gl";
import { useEffect, useRef, useState } from "react";
import { AccessibilityInfo, StyleSheet, View, useColorScheme } from "react-native";

import {
  DITHER_WAVE_FRAGMENT,
  DITHER_WAVE_VERTEX,
  ditherWaveSurface,
  ditherWaveTime,
} from "../chrome/ditherWave";
import { useGraftPalette } from "../theme/tokens";

const FULLSCREEN_TRIANGLE = new Float32Array([-1, -1, 3, -1, -1, 3]);

function compile(gl: ExpoWebGLRenderingContext, type: number, source: string): WebGLShader {
  const shader = gl.createShader(type);
  if (!shader) throw new Error("Could not create shader");
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    const log = gl.getShaderInfoLog(shader) ?? "compile failed";
    gl.deleteShader(shader);
    throw new Error(log);
  }
  return shader;
}

async function loadGlyphTexture(gl: ExpoWebGLRenderingContext): Promise<WebGLTexture | null> {
  try {
    const asset = Asset.fromModule(require("../../assets/DitherGlyphs.png"));
    await asset.downloadAsync();
    const texture = gl.createTexture();
    if (!texture) return null;
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, asset as never);
    return texture;
  } catch {
    return null;
  }
}

function startRenderer(
  gl: ExpoWebGLRenderingContext,
  read: () => { dark: boolean; reduceMotion: boolean; active: boolean },
): () => void {
  const vertex = compile(gl, gl.VERTEX_SHADER, DITHER_WAVE_VERTEX);
  const fragment = compile(gl, gl.FRAGMENT_SHADER, DITHER_WAVE_FRAGMENT);
  const program = gl.createProgram();
  if (!program) throw new Error("Could not create program");
  gl.attachShader(program, vertex);
  gl.attachShader(program, fragment);
  gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    throw new Error(gl.getProgramInfoLog(program) ?? "link failed");
  }

  const buffer = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
  gl.bufferData(gl.ARRAY_BUFFER, FULLSCREEN_TRIANGLE, gl.STATIC_DRAW);
  const position = gl.getAttribLocation(program, "position");
  gl.enableVertexAttribArray(position);
  gl.vertexAttribPointer(position, 2, gl.FLOAT, false, 0, 0);

  const uResolution = gl.getUniformLocation(program, "uResolution");
  const uTime = gl.getUniformLocation(program, "uTime");
  const uDark = gl.getUniformLocation(program, "uDark");
  const uGlyphs = gl.getUniformLocation(program, "uGlyphs");
  const uHasGlyphs = gl.getUniformLocation(program, "uHasGlyphs");

  let glyphs: WebGLTexture | null = null;
  let frame = 0;
  let elapsed = 0;
  let previous: number | undefined;
  let cancelled = false;

  void loadGlyphTexture(gl).then((texture) => {
    if (!cancelled) glyphs = texture;
  });

  const draw = (now: number) => {
    if (cancelled) return;
    const { dark, reduceMotion, active } = read();
    if (active && !reduceMotion) {
      if (previous !== undefined) elapsed += (now - previous) / 1000;
      previous = now;
    } else {
      previous = undefined;
    }

    const surface = ditherWaveSurface(dark);
    gl.viewport(0, 0, gl.drawingBufferWidth, gl.drawingBufferHeight);
    gl.clearColor(surface, surface, surface, 1);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.useProgram(program);
    gl.uniform2f(uResolution, gl.drawingBufferWidth, gl.drawingBufferHeight);
    gl.uniform1f(uTime, ditherWaveTime(elapsed, reduceMotion));
    gl.uniform1f(uDark, dark ? 1 : 0);
    gl.uniform1f(uHasGlyphs, glyphs ? 1 : 0);
    if (glyphs) {
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, glyphs);
      gl.uniform1i(uGlyphs, 0);
    }
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    gl.endFrameEXP();
    frame = requestAnimationFrame(draw);
  };

  frame = requestAnimationFrame(draw);
  return () => {
    cancelled = true;
    cancelAnimationFrame(frame);
    gl.deleteProgram(program);
    gl.deleteShader(vertex);
    gl.deleteShader(fragment);
    if (glyphs) gl.deleteTexture(glyphs);
  };
}

/// Native `DitherWaveBackground` — desktop new-chat glyph-wave, GPU-side.
export function DitherWaveBackground() {
  const palette = useGraftPalette();
  const scheme = useColorScheme();
  const [reduceMotion, setReduceMotion] = useState(false);
  const [failed, setFailed] = useState(false);
  const dark = scheme === "dark";
  const params = useRef({ dark, reduceMotion, active: true });
  const dispose = useRef<(() => void) | undefined>(undefined);

  params.current = { dark, reduceMotion, active: true };

  useEffect(() => {
    let cancelled = false;
    void AccessibilityInfo.isReduceMotionEnabled().then((enabled) => {
      if (!cancelled) setReduceMotion(enabled);
    });
    const subscription = AccessibilityInfo.addEventListener("reduceMotionChanged", setReduceMotion);
    return () => {
      cancelled = true;
      subscription.remove();
    };
  }, []);

  useEffect(
    () => () => {
      dispose.current?.();
    },
    [],
  );

  if (failed) {
    return (
      <View
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
        pointerEvents="none"
        style={[StyleSheet.absoluteFill, { backgroundColor: palette.background }]}
      />
    );
  }

  return (
    <GLView
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      msaaSamples={0}
      onContextCreate={(gl) => {
        try {
          dispose.current?.();
          dispose.current = startRenderer(gl, () => params.current);
        } catch {
          setFailed(true);
        }
      }}
      pointerEvents="none"
      style={[StyleSheet.absoluteFill, { backgroundColor: palette.background }]}
    />
  );
}
