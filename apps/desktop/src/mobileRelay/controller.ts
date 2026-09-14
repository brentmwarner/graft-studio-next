import type { GraftDesktopRelayStatus } from "@graft/mobile-contract/relay";

import { GraftAccountLoginService } from "./graftAccountLoginService";
import {
  clearStoredRelayCredential,
  ensureRelayCredential,
  readStoredRelayCredential,
  registerRelayEnvironment,
  RelaySignedOutError,
} from "./relayRegistration";
import { createRelayUplink, type RelayUplink } from "./relayUplink";
import type { RemoteSessionSecretStore } from "./remoteSessionSecretStore";

const ACCOUNT_TOKEN_KEY = "graft-account-token";
const DISABLED: GraftDesktopRelayStatus = {
  state: "disabled",
  httpBaseUrl: null,
  wsBaseUrl: null,
  lastError: null,
};

export interface MobileRelayDependencies {
  controlPlaneBaseUrl: string;
  secretStore: RemoteSessionSecretStore;
  openExternal: (url: string) => Promise<void>;
  requestBackend: (path: string, body?: unknown) => Promise<unknown>;
  label: string;
  uplinkFactory?: typeof createRelayUplink;
  fetchImpl?: typeof fetch;
}

/** Owns the account and outbound relay for this Graft profile only. */
export class MobileRelayController {
  private readonly login: GraftAccountLoginService;
  private uplink: RelayUplink | null = null;
  private localPort: number | null = null;
  private pending: Promise<void> | null = null;
  private publishing: Promise<void> = Promise.resolve();
  private timer: ReturnType<typeof setInterval> | null = null;
  private generation = 0;
  private stopped = false;
  private signingIn = false;
  private signingOut = false;
  private accountError: string | null = null;
  private status: GraftDesktopRelayStatus = DISABLED;

  constructor(private readonly dependencies: MobileRelayDependencies) {
    this.login = new GraftAccountLoginService({
      controlPlaneBaseUrl: dependencies.controlPlaneBaseUrl,
      openExternal: dependencies.openExternal,
      ...(dependencies.fetchImpl ? { fetchImpl: dependencies.fetchImpl } : {}),
      persistToken: async (token) => dependencies.secretStore.set(ACCOUNT_TOKEN_KEY, token),
      onComplete: (result) => {
        this.signingIn = false;
        this.accountError = result.ok
          ? null
          : result.error === "timeout"
            ? "Sign-in timed out. Try again."
            : "Could not complete Graft sign-in. Try again.";
        if (result.ok) void this.sync();
      },
    });
  }

  start(): void {
    if (this.timer) return;
    // Also recovers after a backend restart or an HTTP client toggling connections.
    this.timer = setInterval(() => void this.sync(), 10_000);
    this.timer.unref?.();
    void this.sync();
  }

  getAccountStatus() {
    let signedIn = false;
    try {
      signedIn = Boolean(this.dependencies.secretStore.get(ACCOUNT_TOKEN_KEY));
    } catch {
      this.accountError = "Secure account storage is unavailable.";
    }
    return { signedIn, signingIn: this.signingIn, error: this.accountError };
  }

  async signIn(): Promise<void> {
    this.accountError = null;
    this.signingIn = true;
    try {
      await this.login.start();
    } catch (error) {
      this.signingIn = false;
      this.accountError = error instanceof Error ? error.message : "Could not start Graft sign-in.";
      throw error;
    }
  }

  async signOut(): Promise<void> {
    this.signingOut = true;
    this.generation += 1;
    this.stopUplink();
    await this.login.cancel();
    await this.pending;
    this.dependencies.secretStore.delete(ACCOUNT_TOKEN_KEY);
    clearStoredRelayCredential(this.dependencies.secretStore);
    this.signingIn = false;
    this.signingOut = false;
    this.accountError = null;
    await this.publish(DISABLED);
  }

  sync(): Promise<void> {
    if (this.stopped || this.signingOut) return Promise.resolve();
    if (this.pending) return this.pending;
    this.pending = this.synchronize()
      .catch(() => {
        // A restarting backend will be retried. Drop the outgoing connection meanwhile.
        this.stopUplink();
      })
      .finally(() => {
        this.pending = null;
      });
    return this.pending;
  }

  private async synchronize(): Promise<void> {
    const current = (await this.dependencies.requestBackend("/api/graft/connections/status")) as {
      enabled: boolean;
      port: number | null;
    };
    if (this.stopped || this.signingOut) return;
    if (!current.enabled || !current.port) {
      this.stopUplink();
      await this.publish(DISABLED);
      return;
    }
    const token = this.dependencies.secretStore.get(ACCOUNT_TOKEN_KEY);
    if (!token) {
      this.stopUplink();
      await this.publish({
        ...DISABLED,
        lastError: "Sign in to Graft to connect over cellular or another network.",
      });
      return;
    }
    if (this.uplink && this.localPort === current.port && !this.uplink.getStatus().rejected) {
      await this.publish(this.status);
      return;
    }
    const rejected = this.uplink?.getStatus().rejected === true;
    this.stopUplink();
    const generation = ++this.generation;
    await this.publish({ ...DISABLED, state: "connecting" });
    const registration = {
      controlPlaneBaseUrl: this.dependencies.controlPlaneBaseUrl,
      getAccountToken: async () => this.dependencies.secretStore.get(ACCOUNT_TOKEN_KEY),
      secretStore: this.dependencies.secretStore,
      label: this.dependencies.label,
      ...(this.dependencies.fetchImpl ? { fetchImpl: this.dependencies.fetchImpl } : {}),
    };
    try {
      const stored = readStoredRelayCredential(registration.secretStore);
      const credential = rejected
        ? await registerRelayEnvironment(
            registration,
            stored ? { environmentId: stored.environmentId } : {},
          )
        : await ensureRelayCredential(registration);
      if (generation !== this.generation || this.stopped || this.signingOut) return;
      this.localPort = current.port;
      this.uplink = (this.dependencies.uplinkFactory ?? createRelayUplink)({
        ...credential,
        localHttpBaseUrl: `http://127.0.0.1:${current.port}`,
        onStatusChange: (next) => {
          if (generation !== this.generation || this.stopped || this.signingOut) return;
          void this.publish({
            state: next.state,
            httpBaseUrl: next.httpBaseUrl,
            wsBaseUrl: next.wsBaseUrl,
            lastError: next.lastError,
          });
        },
      });
      this.uplink.start();
    } catch (error) {
      if (generation !== this.generation || this.stopped || this.signingOut) return;
      if (error instanceof RelaySignedOutError) {
        this.dependencies.secretStore.delete(ACCOUNT_TOKEN_KEY);
        clearStoredRelayCredential(this.dependencies.secretStore);
      }
      await this.publish({
        ...DISABLED,
        state: "error",
        lastError: error instanceof Error ? error.message : "Could not connect to Graft.",
      });
    }
  }

  private publish(status: GraftDesktopRelayStatus): Promise<void> {
    this.status = status;
    // Serialize notifications so a late 'connecting' cannot replace 'connected'.
    this.publishing = this.publishing
      .catch(() => {})
      .then(async () => {
        await this.dependencies.requestBackend("/api/graft/connections/relay", status);
      })
      .catch(() => {});
    return this.publishing;
  }

  private stopUplink(): void {
    this.generation += 1;
    this.uplink?.stop();
    this.uplink = null;
    this.localPort = null;
    this.status = DISABLED;
  }

  async dispose(): Promise<void> {
    this.stopped = true;
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    this.stopUplink();
    await this.login.dispose();
    await this.pending;
    await this.publish(DISABLED);
  }
}
