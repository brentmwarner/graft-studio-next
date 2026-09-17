import * as NodeRuntime from "@effect/platform-node/NodeRuntime";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { NetService } from "@graft/shared/Net";
import * as Effect from "effect/Effect";
import { FetchHttpClient } from "effect/unstable/http";
import { Command } from "effect/unstable/cli";
import * as Layer from "effect/Layer";

import { version } from "../package.json" with { type: "json" };
import { consumeDesktopParentInput, withDesktopParentLifetime } from "./desktopParentLifetime";
import { ServerLive } from "./effectServer";
import { CliConfig, graftCli } from "./main";
import { OpenLive } from "./open";

const tracePackagedImport = (message: string): void => {
  if (process.env.GRAFT_DESKTOP_PACKAGED === "1") {
    process.stderr.write(`[server] runtime import ${message}\n`);
  }
};

// Keep one statically linked server graph. Importing these modules separately
// caused the bundler to emit duplicate copies of the main server chunks, which
// Electron's macOS utility process then evaluated twice during startup.
tracePackagedImport("server module graph ready");

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
  .pipe((program) => NodeRuntime.runMain(program as Effect.Effect<void, unknown, never>));
