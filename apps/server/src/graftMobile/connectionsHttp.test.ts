import { mkdtempSync, renameSync, rmSync } from "node:fs";
import * as fs from "node:fs/promises";
import http from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";

import * as NodeHttpServer from "@effect/platform-node/NodeHttpServer";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { Effect, Exit, Layer, Scope } from "effect";
import { HttpRouter } from "effect/unstable/http";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { ServerAuth } from "../auth/Services/ServerAuth";
import { ServerConfig } from "../config";
import { ServerEnvironment } from "../environment/Services/ServerEnvironment";
import { Open } from "../open";
import * as pathPermissions from "../privatePathPermissions";
import { graftConnectionsRouteLayer } from "./connectionsHttp";
import * as connectionChanges from "./mobileConnectionChanges";
import {
  attachMobileLanGatewayMainServer,
  detachMobileLanGatewayMainServer,
  getMobileLanGatewayPort,
  stopMobileLanGateway,
} from "./lanGateway";
import {
  loadMobileGatewaySettings,
  mobileGatewaySettingsPath,
  saveMobileGatewaySettings,
} from "./mobileGatewaySettings";
import { disconnectMobileRelayAccount, setMobileRelayEnabled } from "./relayRuntime";

vi.mock("node:fs/promises", async (importOriginal) => {
  const actual = await importOriginal<typeof fs>();
  return { ...actual, rename: vi.fn(actual.rename) };
});

vi.mock("./mobileConnectionChanges", async (importOriginal) => {
  const actual = await importOriginal<typeof connectionChanges>();
  return { serializeMobileConnectionChange: vi.fn(actual.serializeMobileConnectionChange) };
});

vi.mock("../privatePathPermissions", async (importOriginal) => {
  const actual = await importOriginal<typeof pathPermissions>();
  return { ...actual, syncDirectoryEntry: vi.fn(actual.syncDirectoryEntry) };
});

vi.mock("./relayRuntime", () => ({
  connectMobileRelayAccount: vi.fn(),
  connectMobileRelayWithAccount: vi.fn(),
  disconnectMobileRelayAccount: vi.fn(async () => undefined),
  getMobileRelayEndpoint: () => null,
  getMobileRelayStatus: () => ({ state: "disabled" }),
  setMobileRelayEnabled: vi.fn(),
}));

let scope: Scope.Closeable;
let stateDir: string;
let base: string;

beforeEach(async () => {
  stateDir = mkdtempSync(join(tmpdir(), "graft-connection-changes-"));
  scope = await Effect.runPromise(Scope.make("sequential"));
  let server: http.Server | null = null;
  await Effect.runPromise(
    Scope.provide(
      Effect.gen(function* () {
        const host = yield* NodeHttpServer.make(
          () => {
            server = http.createServer();
            attachMobileLanGatewayMainServer(server);
            return server;
          },
          { port: 0, host: "127.0.0.1" },
        );
        yield* host.serve(yield* HttpRouter.toHttpEffect(graftConnectionsRouteLayer));
      }).pipe(
        Effect.provide(
          Layer.mergeAll(
            NodeServices.layer,
            Layer.succeed(ServerConfig, {
              mode: "desktop",
              host: "127.0.0.1",
              port: 0,
              stateDir,
              authToken: "connection-test",
            } as never),
            Layer.succeed(ServerEnvironment, {
              getDescriptor: Effect.succeed({ environmentId: "test", label: "Test computer" }),
            } as never),
            Layer.succeed(Open, {} as never),
            Layer.succeed(ServerAuth, {
              listClientSessions: () => Effect.succeed([]),
              listPairingLinks: () => Effect.succeed([]),
            } as never),
          ),
        ),
      ),
      scope,
    ),
  );
  const address = (server as http.Server | null)?.address();
  if (!address || typeof address !== "object") throw new Error("No test server address");
  base = `http://127.0.0.1:${address.port}/api/graft/connections`;
  await saveMobileGatewaySettings(mobileGatewaySettingsPath(stateDir), {
    enabled: false,
    preferredPort: null,
  });
});

afterEach(async () => {
  await stopMobileLanGateway();
  detachMobileLanGatewayMainServer();
  await Effect.runPromise(Scope.close(scope, Exit.void));
  vi.restoreAllMocks();
  vi.clearAllMocks();
  rmSync(stateDir, { recursive: true, force: true });
});

function changeEnabled(enabled: boolean) {
  return fetch(`${base}/enabled?token=connection-test`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ enabled }),
  });
}

it("keeps existing gateways enabled when saving disabled intent fails", async () => {
  expect((await changeEnabled(true)).status).toBe(200);
  const port = getMobileLanGatewayPort();
  vi.mocked(setMobileRelayEnabled).mockClear();
  vi.mocked(fs.rename).mockRejectedValueOnce(new Error("storage unavailable"));

  expect((await changeEnabled(false)).status).toBe(500);
  expect(getMobileLanGatewayPort()).toBe(port);
  expect(setMobileRelayEnabled).not.toHaveBeenCalled();
  expect(loadMobileGatewaySettings(mobileGatewaySettingsPath(stateDir))).toEqual({
    enabled: true,
    preferredPort: port,
  });
});

it("rolls back a new LAN gateway after a failed enable so pairing can retry", async () => {
  vi.mocked(fs.rename).mockRejectedValueOnce(new Error("storage unavailable"));
  expect((await changeEnabled(true)).status).toBe(500);
  expect(getMobileLanGatewayPort()).toBeNull();
  expect(setMobileRelayEnabled).not.toHaveBeenCalled();
  expect(loadMobileGatewaySettings(mobileGatewaySettingsPath(stateDir)).enabled).toBe(false);

  expect((await changeEnabled(true)).status).toBe(200);
  expect(getMobileLanGatewayPort()).not.toBeNull();
  expect(setMobileRelayEnabled).toHaveBeenLastCalledWith(true);
  expect(loadMobileGatewaySettings(mobileGatewaySettingsPath(stateDir)).enabled).toBe(true);
});

it("preserves an already running LAN gateway when a repeated enable cannot save", async () => {
  expect((await changeEnabled(true)).status).toBe(200);
  const port = getMobileLanGatewayPort();
  vi.mocked(setMobileRelayEnabled).mockClear();
  vi.mocked(fs.rename).mockRejectedValueOnce(new Error("storage unavailable"));

  expect((await changeEnabled(true)).status).toBe(500);
  expect(getMobileLanGatewayPort()).toBe(port);
  expect(setMobileRelayEnabled).toHaveBeenLastCalledWith(true);
});

it.each([true, false])(
  "honors committed enabled=%s intent if directory sync fails after replacement",
  async (enabled) => {
    if (!enabled) expect((await changeEnabled(true)).status).toBe(200);
    vi.mocked(pathPermissions.syncDirectoryEntry).mockRejectedValueOnce(
      new Error("directory sync failed"),
    );
    expect((await changeEnabled(enabled)).status).toBe(500);
    expect(loadMobileGatewaySettings(mobileGatewaySettingsPath(stateDir)).enabled).toBe(enabled);
    expect(getMobileLanGatewayPort() !== null).toBe(enabled);
    expect(setMobileRelayEnabled).toHaveBeenLastCalledWith(enabled);
  },
);

it("orders an overlapping disable after an in-flight enable save", async () => {
  const saving = Promise.withResolvers<void>();
  const release = Promise.withResolvers<void>();
  vi.mocked(fs.rename).mockImplementationOnce(async (from, to) => {
    saving.resolve();
    await release.promise;
    renameSync(from, to);
  });
  const enabling = changeEnabled(true);
  try {
    await saving.promise;
    const disabling = changeEnabled(false);
    await vi.waitFor(() =>
      expect(connectionChanges.serializeMobileConnectionChange).toHaveBeenCalledTimes(2),
    );
    release.resolve();
    expect((await enabling).status).toBe(200);
    expect((await disabling).status).toBe(200);
    expect(getMobileLanGatewayPort()).toBeNull();
    expect(setMobileRelayEnabled).toHaveBeenLastCalledWith(false);
    expect(loadMobileGatewaySettings(mobileGatewaySettingsPath(stateDir)).enabled).toBe(false);
  } finally {
    release.resolve();
    await enabling;
  }
});

it("cancels relay registration immediately and finishes sign-out after an older enable", async () => {
  const saving = Promise.withResolvers<void>();
  const release = Promise.withResolvers<void>();
  vi.mocked(fs.rename).mockImplementationOnce(async (from, to) => {
    saving.resolve();
    await release.promise;
    renameSync(from, to);
  });
  const enabling = changeEnabled(true);
  try {
    await saving.promise;
    const disconnecting = fetch(`${base}/account/disconnect?token=connection-test`, {
      method: "POST",
    });
    await vi.waitFor(() => expect(disconnectMobileRelayAccount).toHaveBeenCalledOnce());
    release.resolve();
    expect((await enabling).status).toBe(200);
    expect((await disconnecting).status).toBe(200);
    expect(getMobileLanGatewayPort()).toBeNull();
    expect(setMobileRelayEnabled).toHaveBeenLastCalledWith(false);
    expect(loadMobileGatewaySettings(mobileGatewaySettingsPath(stateDir)).enabled).toBe(false);
  } finally {
    release.resolve();
    await enabling;
  }
});
