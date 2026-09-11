import { EventEmitter } from "node:events";
import type WebSocket from "ws";
import { describe, expect, it, vi } from "vitest";
import {
  GRAFT_DESKTOP_CAPABILITIES,
  GRAFT_DESKTOP_PROTOCOL_VERSION,
  type GraftDesktopClientMessage,
} from "@graft/shared";
import { workerForViewChannel } from "@electron/types/ipc";
import type { SshRemoteConnection } from "../services/sshRemote";
import { RemoteEnvironmentClient } from "./remoteEnvironmentClient";

function fixtureConnection(): SshRemoteConnection {
  const now = Date.now();
  return {
    machine: {
      id: "machine-fedora",
      label: "Fedora",
      sshTarget: "fedora",
      effectiveHostname: "fedora",
      effectiveUser: "brent",
      effectivePort: 22,
      environmentId: "fedora-host-environment",
      environmentLabel: "Fedora",
      daemonVersion: "0.1.0",
      protocolVersion: 1,
      capabilities: [...GRAFT_DESKTOP_CAPABILITIES],
      sessionId: "desktop-session-fedora",
      secretAccountKey: "desktop-host:fedora",
      createdAt: now,
      updatedAt: now,
      lastConnectedAt: now,
    },
    resolvedTarget: {
      target: "fedora",
      hostname: "fedora",
      user: "brent",
      port: 22,
      proxyJump: null,
    },
    bootstrap: {
      protocolVersion: 1,
      environmentId: "fedora-host-environment",
      environmentLabel: "Fedora",
      daemonVersion: "0.1.0",
      platform: { os: "linux", arch: "x64", libc: "glibc" },
      port: 43123,
      enrollmentToken: "e".repeat(32),
      enrollmentExpiresAt: now + 60_000,
      activeRunCount: 0,
      activePtyCount: 0,
    },
    environment: {
      environmentId: "fedora-host-environment",
      environmentLabel: "Fedora",
      daemonVersion: "0.1.0",
      protocolVersion: 1,
      capabilities: [...GRAFT_DESKTOP_CAPABILITIES],
      cursor: 0,
      replayFloor: 0,
    },
    session: {
      sessionId: "desktop-session-fedora",
      environmentId: "fedora-host-environment",
      profile: "desktop_occupancy",
      clientId: "desktop-client",
      clientLabel: "Graft",
      grants: [...GRAFT_DESKTOP_CAPABILITIES],
      createdAt: now,
      expiresAt: now + 60_000,
      lastSeenAt: now,
      revokedAt: null,
    },
    bearer: "b".repeat(32),
    localPort: 43123,
    routes: {
      httpBaseUrl: "http://127.0.0.1:43123",
      wsUrl: "ws://127.0.0.1:43123/desktop/v1/ws",
    },
    close: vi.fn(),
  };
}

class SocketDouble extends EventEmitter {
  readonly readyState = 1;

  constructor(private readonly autoRespond = true) {
    super();
  }

  readonly send = vi.fn((raw: string) => {
    const message = JSON.parse(raw) as GraftDesktopClientMessage;
    if (message.envelope !== "command" || !this.autoRespond) return;
    queueMicrotask(() => {
      this.emit(
        "message",
        Buffer.from(
          JSON.stringify({
            envelope: "response",
            commandId: message.commandId,
            requestId: message.requestId,
            receipt: {
              commandId: message.commandId,
              requestHash: "a".repeat(64),
              status: "completed",
              replayed: false,
              acceptedAt: 1,
              completedAt: 2,
            },
            result: { source: "fedora" },
          }),
        ),
        false,
      );
    });
  });

  readonly close = vi.fn();
}

function welcome(socket: SocketDouble): void {
  queueMicrotask(() => {
    socket.emit("open");
    socket.emit(
      "message",
      Buffer.from(
        JSON.stringify({
          envelope: "welcome",
          environment: fixtureConnection().environment,
          session: fixtureConnection().session,
          capabilities: GRAFT_DESKTOP_CAPABILITIES,
        }),
      ),
      false,
    );
  });
}

describe("RemoteEnvironmentClient", () => {
  it("dispatches host commands over the authenticated environment socket", async () => {
    const connection = fixtureConnection();
    const socket = new SocketDouble();
    welcome(socket);
    const client = await RemoteEnvironmentClient.connect(
      connection,
      { dispatch: vi.fn() },
      {
        clientVersion: "test",
        createSocket: () => socket as unknown as WebSocket,
      },
    );

    await expect(client.dispatch({ type: "project/list" })).resolves.toEqual({
      source: "fedora",
    });
    expect(socket.send).toHaveBeenCalledTimes(2);
    const command = JSON.parse(socket.send.mock.calls[1]![0]!) as {
      command: { type: string };
    };
    expect(command.command.type).toBe("project/list");
    await client.close();
    expect(connection.close).toHaveBeenCalledOnce();
  });

  it("keeps client commands local and fails closed for unsupported commands", async () => {
    const socket = new SocketDouble();
    const platformDispatch = vi.fn(() => ({ local: true }));
    welcome(socket);
    const client = await RemoteEnvironmentClient.connect(
      fixtureConnection(),
      { dispatch: platformDispatch },
      {
        clientVersion: "test",
        createSocket: () => socket as unknown as WebSocket,
      },
    );

    await expect(
      client.dispatch({ type: "appsnap/get-state" }),
    ).resolves.toEqual({ local: true });
    await expect(
      client.dispatch({
        type: "thread/export",
        payload: { threadId: "thread" },
      }),
    ).rejects.toThrow("only available on this machine");
    expect(platformDispatch).toHaveBeenCalledOnce();
    await client.close();
  });

  it("starts attachment-free turns directly on the host", async () => {
    const socket = new SocketDouble();
    const readApprovedRemoteFile = vi.fn();
    welcome(socket);
    const client = await RemoteEnvironmentClient.connect(
      fixtureConnection(),
      { dispatch: vi.fn(), readApprovedRemoteFile },
      {
        clientVersion: "test",
        createSocket: () => socket as unknown as WebSocket,
      },
    );

    await client.dispatch({
      type: "turn/start",
      payload: {
        clientTurnId: "turn-1",
        threadId: "thread-1",
        text: "Hello",
        model: "gpt-5",
      },
    });
    expect(readApprovedRemoteFile).not.toHaveBeenCalled();
    const command = socket.send.mock.calls
      .map(([raw]) => JSON.parse(raw) as GraftDesktopClientMessage)
      .find(
        (message) =>
          message.envelope === "command" &&
          message.command.type === "turn/start",
      );
    expect(command).toMatchObject({
      envelope: "command",
      command: { type: "turn/start", payload: { text: "Hello" } },
    });
    await client.close();
  });

  it("uploads approved turn attachments without sending a client path", async () => {
    const socket = new SocketDouble();
    const bytes = Buffer.from("attachment");
    const ticket = {
      transferId: "33333333-3333-4333-8333-333333333333",
      direction: "upload" as const,
      mediaType: "text/plain",
      sizeBytes: bytes.length,
      sha256:
        "602a5e69c3021bdbd3d25156a02d2cbb467605b8203248eea6af3fb42168d663",
      expiresAt: Date.now() + 60_000,
    };
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ ok: true, ticket }), { status: 201 }),
      )
      .mockResolvedValueOnce(new Response(null, { status: 200 }));
    const readApprovedRemoteFile = vi.fn(async () => ({
      data: bytes,
      fileName: "notes.txt",
      mediaType: "text/plain",
    }));
    welcome(socket);
    const client = await RemoteEnvironmentClient.connect(
      fixtureConnection(),
      { dispatch: vi.fn(), readApprovedRemoteFile },
      {
        clientVersion: "test",
        fetch: fetchMock,
        createSocket: () => socket as unknown as WebSocket,
      },
    );

    await client.dispatch({
      type: "turn/start",
      payload: {
        clientTurnId: "turn-1",
        threadId: "thread-1",
        text: "Read this",
        model: "gpt-5",
        filePaths: ["/Users/test/private/notes.txt"],
      },
    });
    expect(readApprovedRemoteFile).toHaveBeenCalledWith({
      purpose: "attachment",
      path: "/Users/test/private/notes.txt",
    });
    const commandRaw = socket.send.mock.calls.find(([raw]) =>
      raw.includes('"type":"turn/start"'),
    )?.[0];
    expect(commandRaw).toContain(
      "graft-upload://33333333-3333-4333-8333-333333333333/notes.txt",
    );
    expect(commandRaw).not.toContain("/Users/test/private");
    await client.close();
  });

  it("uploads approved imports without sending local approval secrets", async () => {
    const socket = new SocketDouble();
    const bytes = Buffer.from("imported");
    const ticket = {
      transferId: "55555555-5555-4555-8555-555555555555",
      direction: "upload" as const,
      mediaType: "text/plain",
      sizeBytes: bytes.length,
      sha256:
        "5f54227b74fbba7743c47cd286b4873f2e17331518d56facfc03e34cde4a0950",
      expiresAt: Date.now() + 60_000,
    };
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ ok: true, ticket }), { status: 201 }),
      )
      .mockResolvedValueOnce(new Response(null, { status: 200 }));
    const readApprovedRemoteFile = vi.fn(async () => ({
      data: bytes,
      fileName: "source.txt",
      mediaType: "text/plain",
    }));
    welcome(socket);
    const client = await RemoteEnvironmentClient.connect(
      fixtureConnection(),
      { dispatch: vi.fn(), readApprovedRemoteFile },
      {
        clientVersion: "test",
        fetch: fetchMock,
        createSocket: () => socket as unknown as WebSocket,
      },
    );

    await client.dispatch({
      type: "files/import",
      payload: {
        projectId: "project-1",
        sourcePaths: ["/Users/test/private/source.txt"],
        approvalTokens: ["local-approval-secret"],
        targetDir: "docs",
      },
    });
    const commandRaw = socket.send.mock.calls.find(([raw]) =>
      raw.includes('"type":"files/import"'),
    )?.[0];
    expect(commandRaw).toContain(
      "graft-upload://55555555-5555-4555-8555-555555555555/source.txt",
    );
    expect(commandRaw).not.toContain("/Users/test/private");
    expect(commandRaw).not.toContain("local-approval-secret");
    await client.close();
  });

  it("publishes only validated host events to its subscribers", async () => {
    const socket = new SocketDouble();
    welcome(socket);
    const client = await RemoteEnvironmentClient.connect(
      fixtureConnection(),
      { dispatch: vi.fn() },
      {
        clientVersion: "test",
        createSocket: () => socket as unknown as WebSocket,
      },
    );
    const emit = vi.fn();
    client.subscribe({ emit });
    socket.emit(
      "message",
      Buffer.from(
        JSON.stringify({
          envelope: "event",
          cursor: 1,
          occurredAt: 2,
          event: { channel: "thread/updated", payload: { id: "remote" } },
        }),
      ),
      false,
    );

    expect(emit).toHaveBeenCalledExactlyOnceWith({
      channel: "thread/updated",
      payload: { id: "remote" },
    });
    socket.emit(
      "message",
      Buffer.from(
        JSON.stringify({
          envelope: "stream",
          streamId: "22222222-2222-4222-8222-222222222222",
          channel: "pty",
          sequence: 0,
          payload: {
            channel: "worker:terminal:for-view",
            payload: { data: "hello" },
          },
        }),
      ),
      false,
    );
    expect(emit).toHaveBeenLastCalledWith({
      channel: "worker:terminal:for-view",
      payload: { data: "hello" },
    });
    await client.close();
  });

  it("filters legacy Cursor user and thinking records before publishing part updates", async () => {
    const socket = new SocketDouble();
    welcome(socket);
    const client = await RemoteEnvironmentClient.connect(
      fixtureConnection(),
      { dispatch: vi.fn() },
      {
        clientVersion: "test",
        createSocket: () => socket as unknown as WebSocket,
      },
    );
    const emit = vi.fn();
    client.subscribe({ emit });
    const prompt = "how about the component library?";
    await client.dispatch({
      type: "turn/start",
      payload: {
        clientTurnId: "cursor-client-turn",
        threadId: "cursor-thread",
        text: prompt,
        model: "auto",
        providerHint: "cursor",
      },
    });

    socket.emit(
      "message",
      Buffer.from(
        JSON.stringify({
          envelope: "event",
          cursor: 1,
          occurredAt: 2,
          event: {
            channel: workerForViewChannel("engine"),
            payload: {
              type: "part:event",
              payload: {
                type: "part:updated",
                projectId: "remote-project",
                partId: "assistant-part",
                threadId: "cursor-thread",
                partType: "text",
                changes: {
                  content: `${prompt}The user wants to know about the component library.`,
                  status: "streaming",
                },
              },
            },
          },
        }),
      ),
      false,
    );
    expect(emit).toHaveBeenLastCalledWith({
      channel: workerForViewChannel("engine"),
      payload: {
        type: "part:event",
        payload: expect.objectContaining({
          changes: expect.objectContaining({ content: "" }),
        }),
      },
    });

    const answer = "The component library lives inside the desktop app.";
    socket.emit(
      "message",
      Buffer.from(
        JSON.stringify({
          envelope: "event",
          cursor: 2,
          occurredAt: 3,
          event: {
            channel: workerForViewChannel("engine"),
            payload: {
              type: "part:event",
              payload: {
                type: "part:updated",
                projectId: "remote-project",
                partId: "assistant-part",
                threadId: "cursor-thread",
                partType: "text",
                changes: {
                  content: `${prompt}thinking${answer}${answer}`,
                  status: "complete",
                },
              },
            },
          },
        }),
      ),
      false,
    );
    expect(emit).toHaveBeenLastCalledWith({
      channel: workerForViewChannel("engine"),
      payload: {
        type: "part:event",
        payload: expect.objectContaining({
          changes: expect.objectContaining({ content: answer }),
        }),
      },
    });
    await client.close();
  });

  it("reconnects with its durable cursor and retries pending command IDs", async () => {
    const first = new SocketDouble(false);
    const second = new SocketDouble();
    let socketIndex = 0;
    welcome(first);
    const client = await RemoteEnvironmentClient.connect(
      fixtureConnection(),
      { dispatch: vi.fn() },
      {
        clientVersion: "test",
        reconnectDelayMs: 1,
        createSocket: () => {
          const socket = socketIndex === 0 ? first : second;
          socketIndex += 1;
          if (socket === second) welcome(second);
          return socket as unknown as WebSocket;
        },
      },
    );
    const response = client.dispatch({ type: "project/list" });
    await Promise.resolve();
    first.emit("close");

    await expect(response).resolves.toEqual({ source: "fedora" });
    const firstCommand = first.send.mock.calls
      .map(([raw]) => JSON.parse(raw) as GraftDesktopClientMessage)
      .find((message) => message.envelope === "command");
    const secondCommand = second.send.mock.calls
      .map(([raw]) => JSON.parse(raw) as GraftDesktopClientMessage)
      .find((message) => message.envelope === "command");
    expect(firstCommand).toMatchObject({ envelope: "command" });
    expect(secondCommand).toMatchObject({
      envelope: "command",
      commandId:
        firstCommand?.envelope === "command"
          ? firstCommand.commandId
          : "missing",
    });
    const secondHello = JSON.parse(
      second.send.mock.calls[0]![0]!,
    ) as GraftDesktopClientMessage;
    expect(secondHello).toMatchObject({ envelope: "hello", afterCursor: 0 });
    await client.close();
  });

  it("publishes snapshot, reconnect, and stream-gap events on renderer worker channels", async () => {
    const socket = new SocketDouble();
    welcome(socket);
    const client = await RemoteEnvironmentClient.connect(
      fixtureConnection(),
      { dispatch: vi.fn() },
      {
        clientVersion: "test",
        createSocket: () => socket as unknown as WebSocket,
      },
    );
    const emit = vi.fn();
    client.subscribe({ emit });

    socket.emit(
      "message",
      Buffer.from(
        JSON.stringify({
          envelope: "snapshot_required",
          reason: "cursor_expired",
          replayFloor: 12,
        }),
      ),
      false,
    );
    expect(emit).toHaveBeenCalledWith({
      channel: workerForViewChannel("engine"),
      payload: {
        type: "desktop-host/snapshot-required",
        payload: { reason: "cursor_expired", replayFloor: 12 },
      },
    });

    socket.emit("close");
    await new Promise((resolve) => setTimeout(resolve, 5));
    expect(emit).toHaveBeenCalledWith({
      channel: workerForViewChannel("engine"),
      payload: {
        type: "desktop-host/connection-state",
        payload: { state: "reconnecting" },
      },
    });

    socket.emit(
      "message",
      Buffer.from(
        JSON.stringify({
          envelope: "stream",
          streamId: "22222222-2222-4222-8222-222222222222",
          channel: "pty",
          sequence: 0,
          payload: {
            channel: "worker:terminal:for-view",
            payload: { data: "hello" },
          },
        }),
      ),
      false,
    );
    socket.emit(
      "message",
      Buffer.from(
        JSON.stringify({
          envelope: "stream",
          streamId: "22222222-2222-4222-8222-222222222222",
          channel: "pty",
          sequence: 2,
          payload: {
            channel: "worker:terminal:for-view",
            payload: { data: "skipped" },
          },
        }),
      ),
      false,
    );
    expect(emit).toHaveBeenCalledWith({
      channel: workerForViewChannel("terminal"),
      payload: {
        type: "desktop-host/stream-gap",
        payload: {
          streamId: "22222222-2222-4222-8222-222222222222",
          channel: "pty",
          expectedSequence: 1,
          receivedSequence: 2,
        },
      },
    });
    await client.close();
  });

  it("notifies the window owner when a protocol failure closes the session", async () => {
    const socket = new SocketDouble();
    const onFatalError = vi.fn();
    welcome(socket);
    const client = await RemoteEnvironmentClient.connect(
      fixtureConnection(),
      { dispatch: vi.fn() },
      {
        clientVersion: "test",
        createSocket: () => socket as unknown as WebSocket,
        onFatalError,
      },
    );

    socket.emit("message", Buffer.from("not-json"), false);
    await Promise.resolve();

    expect(onFatalError).toHaveBeenCalledOnce();
    expect(onFatalError.mock.calls[0]?.[0]).toBeInstanceOf(Error);
    await client.close();
  });

  it("uploads and downloads bulk bytes with digest verification", async () => {
    const socket = new SocketDouble();
    const bytes = Buffer.from("attachment");
    const uploadTicket = {
      transferId: "33333333-3333-4333-8333-333333333333",
      direction: "upload" as const,
      mediaType: "text/plain",
      sizeBytes: bytes.length,
      sha256:
        "602a5e69c3021bdbd3d25156a02d2cbb467605b8203248eea6af3fb42168d663",
      expiresAt: Date.now() + 60_000,
    };
    const downloadTicket = {
      ...uploadTicket,
      transferId: "44444444-4444-4444-8444-444444444444",
      direction: "download" as const,
    };
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ ok: true, ticket: uploadTicket }), {
          status: 201,
          headers: { "content-type": "application/json" },
        }),
      )
      .mockResolvedValueOnce(new Response(null, { status: 200 }))
      .mockResolvedValueOnce(new Response(bytes, { status: 200 }));
    welcome(socket);
    const client = await RemoteEnvironmentClient.connect(
      fixtureConnection(),
      { dispatch: vi.fn() },
      {
        clientVersion: "test",
        fetch: fetchMock,
        createSocket: () => socket as unknown as WebSocket,
      },
    );

    await expect(client.uploadBulk(bytes, "text/plain")).resolves.toEqual(
      uploadTicket,
    );
    await expect(client.downloadBulk(downloadTicket)).resolves.toEqual(bytes);
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(fetchMock.mock.calls[0]?.[1]?.headers).toMatchObject({
      authorization: `Bearer ${fixtureConnection().bearer}`,
    });
    await client.close();
  });
});
