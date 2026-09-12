import http from "node:http";
import type { Socket } from "node:net";

let lanServer: http.Server | null = null;
let lanPort = 0;

export function getMobileLanGatewayPort(): number | null {
  return lanPort > 0 ? lanPort : null;
}

export function isMobileGatewayPath(pathname: string): boolean {
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

export async function startMobileLanGateway(mainServer: http.Server): Promise<number> {
  if (lanServer && lanPort > 0) return lanPort;

  const requestListeners = [...mainServer.listeners("request")] as Array<
    (request: http.IncomingMessage, response: http.ServerResponse) => void
  >;
  const upgradeListeners = [...mainServer.listeners("upgrade")] as Array<
    (request: http.IncomingMessage, socket: Socket, head: Buffer) => void
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

  await new Promise<void>((resolve, reject) => {
    const onError = (error: Error) => {
      server.off("error", onError);
      reject(error);
    };
    server.once("error", onError);
    server.listen(0, "0.0.0.0", () => {
      server.off("error", onError);
      resolve();
    });
  });

  const address = server.address();
  if (
    !address ||
    typeof address === "string" ||
    !Number.isInteger(address.port) ||
    address.port < 1
  ) {
    server.close();
    throw new Error("Mobile LAN gateway did not bind a TCP port");
  }

  lanServer = server;
  lanPort = address.port;
  return lanPort;
}

export async function stopMobileLanGateway(): Promise<void> {
  const server = lanServer;
  lanServer = null;
  lanPort = 0;
  if (!server) return;
  await new Promise<void>((resolve) => {
    server.close(() => resolve());
  });
}
