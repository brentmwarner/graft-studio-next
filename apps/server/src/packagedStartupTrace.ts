import { Layer } from "effect";

export function tracePackagedStartup(message: string): void {
  if (process.env.GRAFT_DESKTOP_PACKAGED === "1") {
    process.stderr.write(`[server] startup ${message}\n`);
  }
}

/**
 * Preserve a layer's services while recording when its eager acquisition has
 * completed in a packaged desktop backend. These markers stay silent for the
 * CLI, development server, and tests.
 */
export function tracePackagedLayerCompletion<A, E, R>(
  name: string,
  layer: Layer.Layer<A, E, R>,
): Layer.Layer<A, E, R> {
  if (process.env.GRAFT_DESKTOP_PACKAGED !== "1") return layer;
  return layer.pipe(
    Layer.flatMap((services) => {
      tracePackagedStartup(`layer ${name} ready`);
      return Layer.succeedServices(services);
    }),
  );
}
