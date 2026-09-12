import http from "node:http";
import type { Socket } from "node:net";
import type { Duplex } from "node:stream";

import { isLoopbackHost } from "../startupAccess";

let lanServer: http.Server | null = null;
let lanPort = 0;
let lanGatewayIpv6 = false;

export function getMobileLanGatewayPort(): number | null {
  return lanPort > 0 ? lanPort : null;
}

export function mobileLanGatewayAdvertisesIpv6(): boolean {
  return lanGatewayIpv6;
}

export function shouldStartMobileLanGateway(config: {
  readonly host?: string | undefined;
  readonly publicUrl?: URL | undefined;
  readonly authToken?: string | undefined;
}): boolean {
  return (
    Boolean(config.authToken?.trim()) &&
    isLoopbackHost(config.host) &&
    config.publicUrl === undefined
  );
}

export function isOwnerOnlyMobilePath(pathname: string): boolean {
  return pathname === "/v1/pairing-link";
}

export function isMobileGatewayPath(pathname: string): boolean {
  if (isOwnerOnlyMobilePath(pathname)) return false;
  return pathname === "/v1" || pathname.startsWith("/v1/");
}

function pathnameFromRequest(request: http.IncomingMessage): string {
  try {
    return new URL(request.url ?? "/", "http://127.0.0.1").pathname;
  } catch {
    return "/";
  }
}

function handleClientSocketError(this: Socket): void {
  this.destroy();
}

function listen(
  server: http.Server,
  options: { port: number; host: string; ipv6Only?: boolean },
): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const onError = (error: Error) => {
      server.off("error", onError);
      reject(error);
    };
    server.once("error", onError);
    server.listen(options, () => {
      server.off("error", onError);
      resolve();
    });
  });
}

function boundPort(server: http.Server): number {
  const address = server.address();
  if (
    !address ||
    typeof address === "string" ||
    !Number.isInteger(address.port) ||
    address.port < 1
  ) {
    return 0;
  }
  return address.port;
}

export async function startMobileLanGateway(mainServer: http.Server): Promise<number> {
  if (lanServer && lanPort > 0) return lanPort;

  const requestListeners = [...mainServer.listeners("request")] as Array<
    (request: http.IncomingMessage, response: http.ServerResponse) => void
  >;
  const upgradeListeners = [...mainServer.listeners("upgrade")] as Array<
    (request: http.IncomingMessage, socket: Duplex, head: Buffer) => void
  >;

  const server = http.createServer((request, response) => {
    if (!isMobileGatewayPath(pathnameFromRequest(request))) {
      response.writeHead(404, { "content-type": "application/json" });
      response.end(JSON.stringify({ error: "Not found" }));
      return;
    }
    for (const listener of requestListeners) {
      listener.call(mainServer, request, response);
    }
  });
  server.on("connection", (socket) => {
    socket.on("error", handleClientSocketError);
  });
  server.on("upgrade", (request, socket, head) => {
    if (!isMobileGatewayPath(pathnameFromRequest(request))) {
      socket.destroy();
      return;
    }
    for (const listener of upgradeListeners) {
      listener.call(mainServer, request, socket, head);
    }
  });

  let ipv6 = true;
  try {
    await listen(server, { port: 0, host: "::", ipv6Only: false });
  } catch {
    ipv6 = false;
    await listen(server, { port: 0, host: "0.0.0.0" });
  }

  const port = boundPort(server);
  if (port < 1) {
    server.close();
    throw new Error("Mobile LAN gateway did not bind a TCP port");
  }

  lanServer = server;
  lanPort = port;
  lanGatewayIpv6 = ipv6;
  return lanPort;
}

export async function stopMobileLanGateway(): Promise<void> {
  const server = lanServer;
  lanServer = null;
  lanPort = 0;
  lanGatewayIpv6 = false;
  if (!server) return;
  await new Promise<void>((resolve) => {
    server.close(() => resolve());
  });
}
