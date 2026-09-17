import type * as EffectType from "effect/Effect";

import { version } from "../package.json" with { type: "json" };

const tracePackagedImport = (message: string): void => {
  if (process.env.GRAFT_DESKTOP_PACKAGED === "1") {
    process.stderr.write(`[server] runtime import ${message}\n`);
  }
};

tracePackagedImport("@effect/platform-node/NodeRuntime started");
const NodeRuntime = await import("@effect/platform-node/NodeRuntime");
tracePackagedImport("@effect/platform-node/NodeRuntime finished");

tracePackagedImport("@effect/platform-node/NodeServices started");
const NodeServices = await import("@effect/platform-node/NodeServices");
tracePackagedImport("@effect/platform-node/NodeServices finished");

tracePackagedImport("@graft/shared/Net started");
const { NetService } = await import("@graft/shared/Net");
tracePackagedImport("@graft/shared/Net finished");

tracePackagedImport("effect/Effect started");
const Effect = await import("effect/Effect");
tracePackagedImport("effect/Effect finished");

tracePackagedImport("effect/unstable/http started");
const { FetchHttpClient } = await import("effect/unstable/http");
tracePackagedImport("effect/unstable/http finished");

tracePackagedImport("effect/unstable/cli started");
const { Command } = await import("effect/unstable/cli");
tracePackagedImport("effect/unstable/cli finished");

tracePackagedImport("effect/Layer started");
const Layer = await import("effect/Layer");
tracePackagedImport("effect/Layer finished");

tracePackagedImport("desktopParentLifetime started");
const { consumeDesktopParentInput, withDesktopParentLifetime } =
  await import("./desktopParentLifetime");
tracePackagedImport("desktopParentLifetime finished");

tracePackagedImport("effectServer started");
const { ServerLive } = await import("./effectServer");
tracePackagedImport("effectServer finished");

tracePackagedImport("main started");
const { CliConfig, graftCli } = await import("./main");
tracePackagedImport("main finished");

tracePackagedImport("open started");
const { OpenLive } = await import("./open");
tracePackagedImport("open finished");

const desktopParentInput = consumeDesktopParentInput(process.env, () => process.stdin);

const RuntimeLayer = Layer.empty.pipe(
  Layer.provideMerge(CliConfig.layer),
  Layer.provideMerge(ServerLive),
  Layer.provideMerge(OpenLive),
  Layer.provideMerge(NetService.layer),
  Layer.provideMerge(NodeServices.layer),
  Layer.provideMerge(FetchHttpClient.layer),
);

Command.run(graftCli, { version })
  .pipe(Effect.provide(RuntimeLayer))
  .pipe((program) => withDesktopParentLifetime(program, desktopParentInput))
  .pipe((program) => NodeRuntime.runMain(program as EffectType.Effect<void, unknown, never>));
