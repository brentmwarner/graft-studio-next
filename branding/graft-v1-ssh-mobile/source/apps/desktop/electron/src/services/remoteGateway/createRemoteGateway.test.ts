import { createServer } from "node:http";
import { afterEach, describe, expect, it } from "vitest";
import WebSocket from "ws";
import {
  GraftEnvironmentSnapshotSchema,
  GraftMobileHostMessageSchema,
  GraftPairExchangeResponseSchema,
  GraftRemoteHealthSchema,
  parseGraftPairingUrl,
} from "@graft/shared";
import {
  createRemoteGateway,
  type RemoteGateway,
} from "./createRemoteGateway.js";
import { createEventJournal } from "./eventJournal.js";
import { createStubRemoteGatewayHandlers } from "./types.js";

const handlers = createStubRemoteGatewayHandlers({
  listProjects: async () => [
    { id: "p1", name: "demo", kind: "repo" as const, path: "/tmp/demo" },
  ],
  listThreads: async () => [
    {
      id: "t1",
      projectId: "p1",
      title: "Hello",
      updatedAt: Date.now(),
      status: "idle" as const,
    },
  ],
  startTurn: async () => ({ runId: "run-1" }),
});

async function listenOnRandomPort(): Promise<{ host: string; port: number }> {
  const probe = createServer();
  await new Promise<void>((resolve, reject) => {
    probe.once("error", reject);
    probe.listen(0, "127.0.0.1", () => resolve());
  });
  const address = probe.address();
  if (!address || typeof address === "string") {
    probe.close();
    throw new Error("failed to bind random port");
  }
  const port = address.port;
  await new Promise<void>((resolve, reject) => {
    probe.close((error) => (error ? reject(error) : resolve()));
  });
  return { host: "127.0.0.1", port };
}

async function pairSession(gateway: RemoteGateway, host: string, port: number) {
  const issued = gateway.issuePairingCredential();
  const pairResponse = await fetch(`http://${host}:${port}/v1/pair`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      token: issued.token,
      protocolVersion: 1,
      client: { platform: "ios", appVersion: "0.1.0", deviceLabel: "Phone" },
    }),
  });
  const body = GraftPairExchangeResponseSchema.parse(await pairResponse.json());
  return body.session;
}

describe("createRemoteGateway", () => {
  let gateway: RemoteGateway | undefined;

  afterEach(async () => {
    if (gateway) {
      await gateway.stop();
      gateway = undefined;
    }
  });

  it("serves health and exchanges a one-time pairing token", async () => {
    const { host, port } = await listenOnRandomPort();
    gateway = createRemoteGateway(
      {
        host,
        port,
        environmentId: "env-test",
        environmentLabel: "Test Mac",
        networkAccessEnabled: true,
      },
      handlers,
    );
    await gateway.start();

    const healthResponse = await fetch(`http://${host}:${port}/v1/health`);
    expect(healthResponse.ok).toBe(true);
    const health = GraftRemoteHealthSchema.parse(await healthResponse.json());
    expect(health.environmentLabel).toBe("Test Mac");

    const issued = gateway.issuePairingCredential();
    expect(parseGraftPairingUrl(issued.pairingUrl)?.token).toBe(issued.token);

    const pairResponse = await fetch(`http://${host}:${port}/v1/pair`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        token: issued.token,
        protocolVersion: 1,
        client: { platform: "ios", appVersion: "0.1.0", deviceLabel: "Phone" },
      }),
    });
    const session = GraftPairExchangeResponseSchema.parse(
      await pairResponse.json(),
    ).session;
    expect(session.environmentId).toBe("env-test");

    const replay = await fetch(`http://${host}:${port}/v1/pair`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        token: issued.token,
        protocolVersion: 1,
        client: { platform: "ios", appVersion: "0.1.0" },
      }),
    });
    expect(replay.status).toBe(401);
    const replayBody = (await replay.json()) as { error: { code: string } };
    expect(replayBody.error.code).toBe("pairing_token_replayed");
  });

  it("requires auth for snapshot and supports websocket hello/ping", async () => {
    const { host, port } = await listenOnRandomPort();
    gateway = createRemoteGateway(
      {
        host,
        port,
        environmentId: "env-ws",
        environmentLabel: "WS Mac",
        networkAccessEnabled: false,
      },
      handlers,
    );
    await gateway.start();

    const denied = await fetch(`http://${host}:${port}/v1/snapshot`);
    expect(denied.status).toBe(401);

    const session = await pairSession(gateway, host, port);
    const snapshotResponse = await fetch(`http://${host}:${port}/v1/snapshot`, {
      headers: { authorization: `Bearer ${session.bearerToken}` },
    });
    expect(snapshotResponse.ok).toBe(true);
    const snapshot = GraftEnvironmentSnapshotSchema.parse(
      await snapshotResponse.json(),
    );
    expect(snapshot.projects[0]?.id).toBe("p1");

    const queryAuthenticatedStatus = await websocketUpgradeStatus(
      `ws://${host}:${port}/v1/ws?token=${session.bearerToken}`,
    );
    expect(queryAuthenticatedStatus).toBe(401);

    const ws = new WebSocket(`ws://${host}:${port}/v1/ws`, {
      headers: { authorization: `Bearer ${session.bearerToken}` },
    });
    await new Promise<void>((resolve, reject) => {
      ws.once("open", () => resolve());
      ws.once("error", reject);
    });

    const welcomePromise = new Promise((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error("welcome timeout")),
        2000,
      );
      ws.on("message", (data) => {
        const message = GraftMobileHostMessageSchema.parse(
          JSON.parse(String(data)),
        );
        if (message.envelope === "welcome") {
          clearTimeout(timer);
          resolve(message);
        }
      });
    });

    ws.send(
      JSON.stringify({
        envelope: "hello",
        protocolVersion: 1,
        sessionId: session.sessionId,
        afterCursor: 0,
      }),
    );
    const welcome = await welcomePromise;
    expect(welcome).toMatchObject({
      envelope: "welcome",
      environmentId: "env-ws",
    });
    expect([...gateway.sessions.activeDeviceIds()]).toEqual([
      session.deviceId,
    ]);

    const pongPromise = new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("pong timeout")), 2000);
      ws.on("message", (data) => {
        const message = GraftMobileHostMessageSchema.parse(
          JSON.parse(String(data)),
        );
        if (message.envelope === "pong") {
          clearTimeout(timer);
          resolve(message);
        }
      });
    });
    ws.send(JSON.stringify({ envelope: "ping", at: 123 }));
    await expect(pongPromise).resolves.toMatchObject({
      envelope: "pong",
      at: 123,
    });
    ws.close();
  });

  it("includes the dispatcher error when snapshot.get fails", async () => {
    const { host, port } = await listenOnRandomPort();
    gateway = createRemoteGateway(
      {
        host,
        port,
        environmentId: "env-snapshot-fail",
        environmentLabel: "Broken Mac",
        networkAccessEnabled: true,
      },
      createStubRemoteGatewayHandlers({
        listProjects: async () => {
          throw new Error("db_locked");
        },
      }),
    );
    await gateway.start();

    const session = await pairSession(gateway, host, port);
    const snapshotResponse = await fetch(`http://${host}:${port}/v1/snapshot`, {
      headers: { authorization: `Bearer ${session.bearerToken}` },
    });
    expect(snapshotResponse.status).toBe(500);
    await expect(snapshotResponse.json()).resolves.toEqual({
      ok: false,
      error: { code: "internal", message: "db_locked" },
    });
  });

  it("sends welcome before replay frames when reconnecting with a cursor", async () => {
    const { host, port } = await listenOnRandomPort();
    gateway = createRemoteGateway(
      {
        host,
        port,
        environmentId: "env-replay",
        environmentLabel: "Replay Mac",
        networkAccessEnabled: false,
      },
      handlers,
    );
    await gateway.start();
    const session = await pairSession(gateway, host, port);

    // Give the journal something to replay, so the reconnect path below is the
    // one that previously emitted `event` frames ahead of the handshake.
    gateway.journal.append({
      id: "evt-1",
      kind: "assistant.message",
      threadId: "t1",
      createdAt: 1,
      text: "replayed",
    });

    const ws = new WebSocket(`ws://${host}:${port}/v1/ws`, {
      headers: { authorization: `Bearer ${session.bearerToken}` },
    });
    await new Promise<void>((resolve, reject) => {
      ws.once("open", () => resolve());
      ws.once("error", reject);
    });

    const frames: string[] = [];
    const replayed = new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("replay timeout")), 2000);
      ws.on("message", (data) => {
        const message = GraftMobileHostMessageSchema.parse(
          JSON.parse(String(data)),
        );
        frames.push(message.envelope);
        if (message.envelope === "event") {
          clearTimeout(timer);
          resolve();
        }
      });
    });

    ws.send(
      JSON.stringify({
        envelope: "hello",
        protocolVersion: 1,
        sessionId: session.sessionId,
        afterCursor: 0,
      }),
    );
    await replayed;

    // The client rejects the connection outright if the first frame after
    // `hello` is anything but `welcome`, so ordering is the contract here.
    expect(frames[0]).toBe("welcome");
    expect(frames).toContain("event");
    ws.close();
  });

  it("revokes an active device and rejects further commands", async () => {
    const { host, port } = await listenOnRandomPort();
    gateway = createRemoteGateway(
      {
        host,
        port,
        environmentId: "env-revoke",
        environmentLabel: "Revoke Mac",
        networkAccessEnabled: false,
      },
      handlers,
    );
    await gateway.start();
    const session = await pairSession(gateway, host, port);
    gateway.revokeDevice(session.deviceId);

    const snapshotResponse = await fetch(`http://${host}:${port}/v1/snapshot`, {
      headers: { authorization: `Bearer ${session.bearerToken}` },
    });
    expect(snapshotResponse.status).toBe(401);
  });

  it("deduplicates commandIds via dispatcher cache", async () => {
    const { host, port } = await listenOnRandomPort();
    let starts = 0;
    gateway = createRemoteGateway(
      {
        host,
        port,
        environmentId: "env-idem",
        environmentLabel: "Idem Mac",
        networkAccessEnabled: false,
      },
      {
        ...handlers,
        startTurn: async () => {
          starts += 1;
          return { runId: `run-${starts}` };
        },
      },
    );
    await gateway.start();
    const session = await pairSession(gateway, host, port);

    const ws = new WebSocket(`ws://${host}:${port}/v1/ws`, {
      headers: { authorization: `Bearer ${session.bearerToken}` },
    });
    await new Promise<void>((resolve, reject) => {
      ws.once("open", () => resolve());
      ws.once("error", reject);
    });

    const commandId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
    const responses: unknown[] = [];
    ws.on("message", (data) => {
      responses.push(JSON.parse(String(data)));
    });

    ws.send(
      JSON.stringify({
        envelope: "hello",
        protocolVersion: 1,
        sessionId: session.sessionId,
      }),
    );
    await new Promise((r) => setTimeout(r, 50));

    const frame = {
      envelope: "command",
      commandId,
      command: { type: "turn.start", threadId: "t1", text: "hi" },
    };
    ws.send(JSON.stringify(frame));
    ws.send(JSON.stringify(frame));
    await new Promise((r) => setTimeout(r, 100));

    const commandResponses = responses.filter(
      (message) =>
        typeof message === "object" &&
        message !== null &&
        "envelope" in message &&
        (message as { envelope: string }).envelope === "response",
    ) as Array<{ receipt: { status: string; runId?: string } }>;

    expect(commandResponses.length).toBeGreaterThanOrEqual(2);
    expect(starts).toBe(1);
    expect(commandResponses.some((r) => r.receipt.status === "duplicate")).toBe(
      true,
    );
    ws.close();
  });
});

function websocketUpgradeStatus(url: string): Promise<number> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url);
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      ws.terminate();
      reject(new Error("WebSocket upgrade response timed out"));
    }, 2_000);
    ws.once("unexpected-response", (_request, response) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(response.statusCode ?? 0);
    });
    ws.once("open", () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      ws.close();
      reject(new Error("WebSocket upgrade unexpectedly succeeded"));
    });
    ws.once("error", (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(error);
    });
  });
}

describe("eventJournal", () => {
  it("replays after cursor and signals snapshot when history expired", () => {
    const journal = createEventJournal(2);
    journal.append({
      id: "e1",
      kind: "user.message",
      threadId: "t1",
      createdAt: 1,
      text: "a",
    });
    journal.append({
      id: "e2",
      kind: "assistant.message",
      threadId: "t1",
      createdAt: 2,
      text: "b",
    });
    journal.append({
      id: "e3",
      kind: "assistant.message",
      threadId: "t1",
      createdAt: 3,
      text: "c",
    });

    const replay = journal.replayAfter(0);
    expect(replay.snapshotRequired).toBe(true);
    expect(journal.replayAfter(2).events.map((e) => e.id)).toEqual(["e3"]);
  });
});
