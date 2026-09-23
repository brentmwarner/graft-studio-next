import { spawnProcessSync } from "@graft/shared/processRuntime";

function normalizeLabel(value: string | null | undefined): string | null {
  return value?.trim() || null;
}

function readSystemName(command: string, args: ReadonlyArray<string>): string | null {
  try {
    const result = spawnProcessSync(command, args, {
      encoding: "utf8",
      timeout: 1_000,
      maxBuffer: 4_096,
      stdio: ["ignore", "pipe", "ignore"],
    });
    return result.status === 0 ? normalizeLabel(result.stdout) : null;
  } catch {
    return null;
  }
}

export function resolveServerEnvironmentLabel({
  platform = process.platform,
  env = process.env,
}: {
  readonly platform?: NodeJS.Platform;
  readonly env?: NodeJS.ProcessEnv;
} = {}): string {
  const configured = normalizeLabel(env.GRAFT_MACHINE_NAME);
  if (configured) return configured;

  // Keep native OS bindings out of packaged macOS backend startup.
  // ComputerName preserves the friendly name, including spaces and capitalization.
  if (platform === "darwin") {
    const computerName = readSystemName("/usr/sbin/scutil", ["--get", "ComputerName"]);
    if (computerName) return computerName;
  }
  if (platform === "darwin" || platform === "linux") {
    const hostname = readSystemName("/bin/hostname", []);
    if (hostname) return hostname;
  }
  return normalizeLabel(env.COMPUTERNAME) ?? normalizeLabel(env.HOSTNAME) ?? "Graft";
}
