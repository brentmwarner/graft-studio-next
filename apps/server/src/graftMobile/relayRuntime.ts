import { mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import open from "open";

import {
  GraftRelayEnvironmentRegistrationSchema,
  type GraftRelayEnvironmentRegistration,
} from "@graft/mobile-contract/relay";

import { GraftAccountLoginService } from "./graftAccountLoginService";
import { createRelayUplink, type RelayStatus } from "./relayUplink";
import { relayNetworkEndpoint } from "./networkEndpoints";

let uplink: ReturnType<typeof createRelayUplink> | null = null;
let credential: GraftRelayEnvironmentRegistration | null = null;
let credentialError: string | null = null;
let status: RelayStatus = { state: "disabled", lastError: null };
let enabled = false;
let runtimePort = 0;
let runtimeStateDir = "";
let controlPlaneUrl = "https://api.graftapp.io";
let epoch = 0;
let login: GraftAccountLoginService | null = null;

/** Only accept the authenticated, TLS-protected relay origin supplied by the host. */
export function parseMobileRelayCredential(serialized: string): GraftRelayEnvironmentRegistration {
  const value = GraftRelayEnvironmentRegistrationSchema.parse(JSON.parse(serialized));
  const http = new URL(value.httpBaseUrl);
  const ws = new URL(value.wsBaseUrl);
  const uplinkUrl = new URL(value.uplinkUrl);
  if (
    http.protocol !== "https:" ||
    ws.protocol !== "wss:" ||
    uplinkUrl.protocol !== "wss:" ||
    http.host !== ws.host ||
    http.host !== uplinkUrl.host ||
    http.pathname !== ws.pathname ||
    uplinkUrl.pathname !== "/relay/v1/uplink" ||
    http.pathname.replace(/\/$/, "") !== `/e/${encodeURIComponent(value.environmentId)}` ||
    [http, ws, uplinkUrl].some((url) => url.username || url.password || url.search || url.hash)
  ) {
    throw new Error(
      "Invalid Graft relay addresses. HTTPS/WSS addresses for the same relay environment are required.",
    );
  }
  return value;
}

export function initializeMobileRelay(
  localPort: number,
  stateDir: string,
  environment = process.env,
): void {
  stopMobileRelay();
  enabled = false;
  credential = null;
  runtimePort = localPort;
  runtimeStateDir = stateDir;
  controlPlaneUrl = environment.GRAFT_CONTROL_PLANE_URL ?? "https://api.graftapp.io";
  const serialized = environment.GRAFT_RELAY_CREDENTIAL;
  const path = environment.GRAFT_RELAY_CREDENTIAL_FILE ?? join(stateDir, "mobile-relay.json");
  let saved: string | undefined;
  try {
    saved = serialized ?? readFileSync(path, "utf8");
  } catch (error) {
    if (
      !environment.GRAFT_RELAY_CREDENTIAL_FILE &&
      error &&
      typeof error === "object" &&
      "code" in error &&
      error.code === "ENOENT"
    ) {
      saved = environment.GRAFT_LEGACY_RELAY_CREDENTIAL;
      if (!saved) return;
    } else {
      credentialError = "Graft relay credentials could not be loaded. Connect your Graft account.";
      status = { state: "error", lastError: credentialError };
      return;
    }
  }
  if (saved === undefined) return;
  try {
    credential = parseMobileRelayCredential(saved);
    uplink = createRelayUplink({
      credential,
      localHttpBaseUrl: `http://127.0.0.1:${localPort}`,
      onStatus: (next) => {
        status = next;
      },
    });
  } catch {
    credentialError = "Graft relay credentials could not be loaded. Reconnect your Graft account.";
    status = { state: "error", lastError: credentialError };
  }
}

export function setMobileRelayEnabled(next: boolean): void {
  enabled = next;
  if (next) {
    if (credentialError) status = { state: "error", lastError: credentialError };
    else uplink?.start();
  } else {
    epoch += 1;
    void login?.cancel();
    uplink?.stop();
    status = { state: "disabled", lastError: null };
  }
}

export function stopMobileRelay(): void {
  epoch += 1;
  void login?.dispose();
  login = null;
  enabled = false;
  uplink?.stop();
  uplink = null;
  credential = null;
  credentialError = null;
  status = { state: "disabled", lastError: null };
}

export function getMobileRelayStatus(): RelayStatus {
  return { ...status };
}

export function getMobileRelayEndpoint() {
  return enabled && status.state === "connected" && credential
    ? relayNetworkEndpoint(credential)
    : null;
}

/** Do not replace an internet pairing address with a LAN address during relay recovery. */
export async function waitForMobileRelayPairing(): Promise<void> {
  if (!enabled || (!credential && status.state === "disabled")) return;
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    if (!enabled || status.state !== "connecting") break;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  if (!getMobileRelayEndpoint()) {
    throw new Error(
      status.lastError ??
        "The Graft relay is reconnecting. Try pairing again when remote access is connected.",
    );
  }
}

/** Reuse Graft's existing PKCE browser sign-in; only persist the scoped uplink credential. */
export async function connectMobileRelayAccount(label: string): Promise<void> {
  if (!enabled || !runtimePort)
    throw new Error("Enable remote connections before connecting your Graft account.");
  const generation = ++epoch;
  await login?.dispose();
  if (generation !== epoch || !enabled) return;
  status = { state: "connecting", lastError: "Complete Graft sign-in in your browser." };
  try {
    login = new GraftAccountLoginService({
      controlPlaneBaseUrl: controlPlaneUrl,
      openExternal: async (url) => {
        await open(url);
      },
      persistToken: async (token) => {
        const response = await fetch(new URL("/relay/v1/environments", controlPlaneUrl), {
          method: "POST",
          headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
          body: JSON.stringify({
            label,
            ...(credential ? { environmentId: credential.environmentId } : {}),
          }),
          signal: AbortSignal.timeout(15_000),
          redirect: "error",
        });
        if (!response.ok) throw new Error("Graft relay registration failed.");
        const next = parseMobileRelayCredential(JSON.stringify(await response.json()));
        if (generation !== epoch || !enabled) throw new Error("Graft relay sign-in was cancelled.");
        mkdirSync(runtimeStateDir, { recursive: true, mode: 0o700 });
        const file = join(runtimeStateDir, "mobile-relay.json");
        const temporary = `${file}.${randomUUID()}.tmp`;
        try {
          writeFileSync(temporary, JSON.stringify(next), { mode: 0o600, flag: "wx" });
          renameSync(temporary, file);
        } finally {
          rmSync(temporary, { force: true });
        }
        uplink?.stop();
        credential = next;
        credentialError = null;
        uplink = createRelayUplink({
          credential: next,
          localHttpBaseUrl: `http://127.0.0.1:${runtimePort}`,
          onStatus: (nextStatus) => {
            status = nextStatus;
          },
        });
        uplink.start();
      },
      onComplete: (result) => {
        if (generation !== epoch || result.ok) return;
        status = {
          state: "error",
          lastError: "Could not connect your Graft account to the relay. Try signing in again.",
        };
      },
    });
    await login.start();
  } catch (error) {
    if (generation === epoch)
      status = { state: "error", lastError: "Could not start Graft sign-in. Try again." };
    throw error;
  }
}
