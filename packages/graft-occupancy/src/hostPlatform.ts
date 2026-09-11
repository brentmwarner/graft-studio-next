import type { GraftDesktopPlatform } from "@graft/desktop-contract";

export interface HostPlatformDiagnostic {
  compatible: boolean;
  platform: string;
  architecture: string;
  libc: string | null;
  message: string;
}

function runtimeGlibcVersion(): string | null {
  const report = process.report?.getReport() as
    | { header?: { glibcVersionRuntime?: unknown } }
    | undefined;
  const header = report?.header;
  return typeof header?.glibcVersionRuntime === "string" ? header.glibcVersionRuntime : null;
}

export function diagnoseHostPlatform(): HostPlatformDiagnostic {
  const libc = runtimeGlibcVersion();
  const compatible = process.platform === "linux" && process.arch === "x64" && libc !== null;
  return {
    compatible,
    platform: process.platform,
    architecture: process.arch,
    libc,
    message: compatible ? `Linux x64 glibc ${libc}` : "graft-host v1 requires Linux x64 with glibc",
  };
}

export function requireSupportedHostPlatform(): GraftDesktopPlatform {
  const diagnostic = diagnoseHostPlatform();
  if (!diagnostic.compatible) throw new Error(diagnostic.message);
  return { os: "linux", arch: "x64", libc: "glibc" };
}

export const LINUX_X64_GLIBC_PLATFORM: GraftDesktopPlatform = {
  os: "linux",
  arch: "x64",
  libc: "glibc",
};
