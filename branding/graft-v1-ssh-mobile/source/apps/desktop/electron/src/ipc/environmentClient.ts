import type {
  EnvironmentEventSink,
  HostCommandPort,
} from "@graft/host-runtime";
import type { ViewCommand } from "./channels";

export interface EnvironmentClient extends HostCommandPort<ViewCommand> {
  subscribe(sink: EnvironmentEventSink): () => void;
  close?(): Promise<void> | void;
}

export type EnvironmentDescriptor =
  | {
      kind: "local";
      environmentId: string;
      environmentLabel: string;
    }
  | {
      kind: "ssh";
      environmentId: string;
      environmentLabel: string;
      machineId: string;
    };
