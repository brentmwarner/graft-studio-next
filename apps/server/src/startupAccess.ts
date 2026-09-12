import OS from "node:os";

export const isWildcardHost = (host: string | undefined): boolean =>
  host === "0.0.0.0" || host === "::" || host === "[::]";

export const isLoopbackHost = (host: string | undefined): boolean => {
  if (!host) return true;
  const normalized = host.startsWith("[") && host.endsWith("]") ? host.slice(1, -1) : host;
  return normalized === "localhost" || normalized === "127.0.0.1" || normalized === "::1";
};

export const formatHostForUrl = (host: string): string =>
  host.includes(":") && !host.startsWith("[") ? `[${host}]` : host;

let boundListenPort = 0;

export function setBoundListenPort(port: number): void {
  if (!Number.isInteger(port) || port < 0) return;
  boundListenPort = port;
}

export function getBoundListenPort(fallbackPort: number): number {
  return boundListenPort > 0 ? boundListenPort : fallbackPort;
}

export const resolveListeningPort = (address: unknown, fallbackPort: number): number => {
  if (
    typeof address === "object" &&
    address !== null &&
    "port" in address &&
    typeof address.port === "number"
  ) {
    return address.port;
  }
  return fallbackPort;
};

export function firstReachableIpv4Address(
  interfaces: NodeJS.Dict<OS.NetworkInterfaceInfo[]> = OS.networkInterfaces(),
): string | undefined {
  for (const addresses of Object.values(interfaces)) {
    for (const address of addresses ?? []) {
      if (address.family === "IPv4" && !address.internal) return address.address;
    }
  }
  return undefined;
}

export function mobilePairingBaseUrl(input: {
  readonly host: string | undefined;
  readonly port: number;
  readonly publicUrl?: URL | undefined;
  readonly fallback: string;
  readonly lanAddress?: string | undefined;
}): string {
  if (input.publicUrl) return input.publicUrl.origin;
  if (!isWildcardHost(input.host)) return input.fallback;
  const address = input.lanAddress ?? firstReachableIpv4Address();
  return address ? `http://${formatHostForUrl(address)}:${input.port}` : input.fallback;
}
