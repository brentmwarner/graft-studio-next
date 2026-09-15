import type { ExecutionEnvironmentDescriptor } from "@graft/contracts";
import { Effect, ServiceMap } from "effect";

export interface ServerEnvironmentShape {
  readonly getDescriptor: Effect.Effect<ExecutionEnvironmentDescriptor>;
}

export class ServerEnvironment extends ServiceMap.Service<
  ServerEnvironment,
  ServerEnvironmentShape
>()("graft/environment/Services/ServerEnvironment") {}
