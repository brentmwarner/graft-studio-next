export interface EnvironmentEvent {
  channel: string;
  payload: unknown;
}

export interface EnvironmentEventSink {
  emit(event: EnvironmentEvent): void;
}

export interface HostCommandPort<Command, Response = unknown> {
  dispatch(command: Command): Promise<Response> | Response;
}

export class EnvironmentEventBus implements EnvironmentEventSink {
  private readonly sinks = new Set<EnvironmentEventSink>();

  emit(event: EnvironmentEvent): void {
    for (const sink of this.sinks) {
      try {
        sink.emit(event);
      } catch {
        // A disconnected client must never abort a host state transition.
      }
    }
  }

  subscribe(sink: EnvironmentEventSink): () => void {
    this.sinks.add(sink);
    return () => {
      this.sinks.delete(sink);
    };
  }
}

/**
 * Electron-free command and event boundary for one Graft environment.
 *
 * Domain services can initially sit behind an adapter to the existing desktop
 * controller. The headless host can later provide the same port without
 * importing Electron or manufacturing a BrowserWindow.
 */
export class HostRuntime<Command, Response = unknown> {
  constructor(
    private readonly commands: HostCommandPort<Command, Response>,
    private readonly events: EnvironmentEventBus,
  ) {}

  dispatch(command: Command): Promise<Response> | Response {
    return this.commands.dispatch(command);
  }

  subscribe(sink: EnvironmentEventSink): () => void {
    return this.events.subscribe(sink);
  }
}
