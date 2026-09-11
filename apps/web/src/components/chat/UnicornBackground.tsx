// FILE: UnicornBackground.tsx
// Purpose: Render Graft's empty-landing "Glyph Waves" Unicorn Studio scene.
// Layer: Chat empty-state decoration

import { useEffect, useRef, useState } from "react";
import darkSceneData from "~/assets/unicorn-scene.json";

declare global {
  interface Window {
    UnicornStudio?: {
      addScene: (options: {
        elementId: string;
        projectId?: string;
        filePath?: string;
        scale?: number;
        dpi?: number;
        fps?: number;
        lazyLoad?: boolean;
        production?: boolean;
      }) => Promise<{ destroy: () => void }>;
    };
  }
}

const SDK_URL =
  "https://cdn.jsdelivr.net/gh/hiunicornstudio/unicornstudio.js@v2.1.3/dist/unicornStudio.umd.js";

const darkBlobUrl = URL.createObjectURL(
  new Blob([JSON.stringify(darkSceneData)], { type: "application/json" }),
);

let lightBlobUrl: string | null = null;

async function getLightBlobUrl(): Promise<string> {
  if (lightBlobUrl) return lightBlobUrl;
  const mod = await import("~/assets/unicorn-scene-light.json");
  lightBlobUrl = URL.createObjectURL(
    new Blob([JSON.stringify(mod.default)], { type: "application/json" }),
  );
  return lightBlobUrl;
}

function loadSdk(): Promise<void> {
  if (typeof window === "undefined") return Promise.resolve();
  if (window.UnicornStudio) return Promise.resolve();

  return new Promise((resolve, reject) => {
    if (document.querySelector(`script[src="${SDK_URL}"]`)) {
      let attempts = 0;
      const poll = setInterval(() => {
        if (typeof window === "undefined") {
          clearInterval(poll);
          resolve();
          return;
        }
        if (window.UnicornStudio) {
          clearInterval(poll);
          resolve();
        } else if (++attempts > 30) {
          clearInterval(poll);
          reject(new Error("UnicornStudio SDK timed out"));
        }
      }, 100);
      return;
    }

    const script = document.createElement("script");
    script.src = SDK_URL;
    script.onload = () => {
      setTimeout(() => {
        if (typeof window === "undefined") return resolve();
        if (window.UnicornStudio) resolve();
        else reject(new Error("UnicornStudio SDK loaded but not available on window"));
      }, 50);
    };
    script.onerror = () => reject(new Error("Failed to load UnicornStudio SDK"));
    document.head.appendChild(script);
  });
}

function useIsDark() {
  const [isDark, setIsDark] = useState(() =>
    document.documentElement.classList.contains("dark"),
  );

  useEffect(() => {
    const observer = new MutationObserver(() => {
      setIsDark(document.documentElement.classList.contains("dark"));
    });
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["class"],
    });
    return () => observer.disconnect();
  }, []);

  return isDark;
}

export function UnicornBackground({ visible }: { visible: boolean }) {
  const sceneRef = useRef<{ destroy: () => void } | null>(null);
  const isDark = useIsDark();

  useEffect(() => {
    let cancelled = false;

    const init = async () => {
      try {
        await loadSdk();
      } catch (err) {
        console.warn("[UnicornBackground] SDK load failed:", err);
        return;
      }
      if (cancelled || !window.UnicornStudio) return;

      sceneRef.current?.destroy();
      sceneRef.current = null;

      let sceneUrl: string;
      try {
        sceneUrl = isDark ? darkBlobUrl : await getLightBlobUrl();
      } catch {
        sceneUrl = darkBlobUrl;
      }

      try {
        const scene = await window.UnicornStudio.addScene({
          elementId: "unicorn-bg",
          filePath: sceneUrl,
          scale: 1,
          dpi: window.devicePixelRatio ?? 1.5,
          fps: 60,
          lazyLoad: false,
          production: true,
        });
        if (cancelled) {
          scene.destroy();
        } else {
          sceneRef.current = scene;
        }
      } catch (err) {
        console.warn("[UnicornBackground] Scene init failed:", err);
      }
    };

    void init();

    return () => {
      cancelled = true;
      sceneRef.current?.destroy();
      sceneRef.current = null;
    };
  }, [isDark]);

  return (
    <div
      className="pointer-events-none absolute inset-0 overflow-hidden transition-opacity duration-700 ease-in-out"
      style={{ opacity: visible ? 1 : 0 }}
      aria-hidden="true"
    >
      <div id="unicorn-bg" style={{ width: "100%", height: "100%" }} />
      <div
        className="absolute inset-0"
        style={{
          background:
            "radial-gradient(ellipse 65% 55% at 50% 50%, transparent 0%, var(--background) 100%)",
        }}
      />
    </div>
  );
}
