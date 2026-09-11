import type { EnvironmentEventSink, HostRuntime } from "@graft/host-runtime";
import type { ViewCommand } from "./channels";
import { DESKTOP_COMMAND_POLICIES } from "./desktopCommandOwnership";
import type { EnvironmentClient } from "./environmentClient";
import type { RemoteFileHandoffPort } from "./remoteFileHandoff";

export interface ClientPlatformCommandPort extends Partial<RemoteFileHandoffPort> {
  dispatch(command: ViewCommand): Promise<unknown> | unknown;
}

/**
 * Preserves local desktop behavior while making command ownership explicit.
 * Host commands cross HostRuntime; Electron/client commands stay on the
 * platform port. Split commands remain local until their hand-off protocols
 * are implemented.
 */
export class LocalEnvironmentClient implements EnvironmentClient {
  constructor(
    private readonly hostRuntime: HostRuntime<ViewCommand>,
    private readonly clientPlatform: ClientPlatformCommandPort,
  ) {}

  dispatch(command: ViewCommand): Promise<unknown> | unknown {
    const policy = DESKTOP_COMMAND_POLICIES[command.type];
    switch (policy.owner) {
      case "host":
        return this.hostRuntime.dispatch(command);
      case "client":
      case "split":
      case "unsupported_remote":
        return this.clientPlatform.dispatch(command);
      default: {
        const exhaustive: never = policy.owner;
        throw new Error(`Unknown local command owner: ${String(exhaustive)}`);
      }
    }
  }

  subscribe(sink: EnvironmentEventSink): () => void {
    return this.hostRuntime.subscribe(sink);
  }
}
