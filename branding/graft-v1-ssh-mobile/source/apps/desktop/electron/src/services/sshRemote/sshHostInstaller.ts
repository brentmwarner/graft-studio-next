import { existsSync, readFileSync } from "node:fs";
import { createHash, randomUUID } from "node:crypto";
import {
  GraftDesktopBootstrapResponseSchema,
  type GraftDesktopBootstrapResponse,
} from "@graft/shared";
import {
  classifySshFailure,
  type SshCommandRunner,
  runSshCommand,
} from "./sshTarget.js";
import { SshRemoteError } from "./sshRemoteTypes.js";

const BOOTSTRAP_COMMAND =
  'if command -v graft-host >/dev/null 2>&1; then exec graft-host bootstrap; elif [ -x "$HOME/.local/bin/graft-host" ]; then exec "$HOME/.local/bin/graft-host" bootstrap; else exit 127; fi';

const INSTALL_SCRIPT = `set -eu
version="$1"
archive="$2"
nonce="$3"
expected_sha256="$4"
data_root="\${XDG_DATA_HOME:-$HOME/.local/share}/graft/host/installation"
versions_root="$data_root/versions"
target="$versions_root/$version"
stage="$versions_root/.stage-$version-$nonce"
current_temp="$data_root/.current-$nonce"
mkdir -p "$versions_root" "$HOME/.local/bin"
trap 'rm -rf "$stage" "$current_temp" "$archive"' EXIT
actual_sha256="$(sha256sum "$archive" | cut -d ' ' -f 1)"
if [ "$actual_sha256" != "$expected_sha256" ]; then
  echo "graft-host archive checksum mismatch" >&2
  exit 65
fi
mkdir "$stage"
tar -xzf "$archive" -C "$stage"
cd "$stage"
if ! command -v node >/dev/null 2>&1; then
  echo "graft-host requires Node.js 22 or newer" >&2
  exit 69
fi
node -e 'if (Number(process.versions.node.split(".")[0]) < 22) process.exit(1); require("better-sqlite3"); require("node-pty"); require("ws")'
chmod 755 bin/graft-host.mjs
find node_modules/node-pty -type f -name spawn-helper -exec chmod 755 {} +
if [ -e "$target" ]; then
  rm -rf "$stage"
else
  mv "$stage" "$target"
fi
ln -s "versions/$version" "$current_temp"
mv -Tf "$current_temp" "$data_root/current"
ln -sfn "$data_root/current/bin/graft-host.mjs" "$HOME/.local/bin/graft-host"
`;

export interface SshHostInstallerOptions {
  hostArchivePath: string;
  hostVersion: string;
  sshExecutable?: string;
  scpExecutable?: string;
  runner?: SshCommandRunner;
}

export class SshHostInstaller {
  private readonly runner: SshCommandRunner;

  constructor(private readonly options: SshHostInstallerOptions) {
    if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$/u.test(options.hostVersion)) {
      throw new Error("Invalid graft-host package version");
    }
    this.runner = options.runner ?? runSshCommand;
  }

  async bootstrap(target: string): Promise<GraftDesktopBootstrapResponse> {
    let result = await this.runSsh(target, BOOTSTRAP_COMMAND);
    let installedCurrentVersion = false;
    if (
      result.exitCode === 127 ||
      /graft-host.*not found/iu.test(result.stderr) ||
      result.stderr.includes("GRAFT_HOST_UPGRADE_BLOCKED")
    ) {
      await this.install(target);
      installedCurrentVersion = true;
      result = await this.runSsh(target, BOOTSTRAP_COMMAND);
    }
    if (result.exitCode !== 0)
      throw this.classifyBootstrapFailure(result.stderr);
    let bootstrap = this.parseBootstrap(result.stdout);
    if (bootstrap.daemonVersion !== this.options.hostVersion) {
      if (!installedCurrentVersion) {
        await this.install(target);
        result = await this.runSsh(target, BOOTSTRAP_COMMAND);
        if (result.exitCode !== 0) {
          throw this.classifyBootstrapFailure(result.stderr);
        }
        bootstrap = this.parseBootstrap(result.stdout);
      }
      if (bootstrap.daemonVersion !== this.options.hostVersion) {
        if (bootstrap.activeRunCount > 0 || bootstrap.activePtyCount > 0) {
          return bootstrap;
        }
        throw new SshRemoteError(
          "incompatible_host",
          "The machine kept running an older graft-host after the update",
          true,
        );
      }
    }
    return bootstrap;
  }

  private classifyBootstrapFailure(stderr: string): SshRemoteError {
    return classifySshFailure(stderr);
  }

  private parseBootstrap(stdout: string): GraftDesktopBootstrapResponse {
    try {
      return GraftDesktopBootstrapResponseSchema.parse(JSON.parse(stdout));
    } catch {
      throw new SshRemoteError(
        "incompatible_host",
        "This machine returned an incompatible graft-host response",
        false,
      );
    }
  }

  private async install(target: string): Promise<void> {
    if (!existsSync(this.options.hostArchivePath)) {
      throw new SshRemoteError(
        "install_failed",
        "The bundled graft-host package is missing",
        false,
      );
    }
    const nonce = randomUUID().replaceAll("-", "");
    const remoteArchive = `/tmp/graft-host-${nonce}.tar.gz`;
    const archiveSha256 = createHash("sha256")
      .update(readFileSync(this.options.hostArchivePath))
      .digest("hex");
    const copied = await this.runner(this.options.scpExecutable ?? "scp", [
      "-q",
      "-o",
      "BatchMode=yes",
      "-o",
      "ConnectTimeout=10",
      "--",
      this.options.hostArchivePath,
      `${target}:${remoteArchive}`,
    ]);
    if (copied.exitCode !== 0) {
      const sshError = classifySshFailure(copied.stderr);
      throw new SshRemoteError(
        sshError.code === "bootstrap_unavailable"
          ? "install_failed"
          : sshError.code,
        sshError.code === "bootstrap_unavailable"
          ? "graft-host could not be copied to the SSH machine"
          : sshError.message,
        sshError.retryable,
      );
    }
    const installed = await this.runner(
      this.options.sshExecutable ?? "ssh",
      [
        "-T",
        "-o",
        "BatchMode=yes",
        "-o",
        "ConnectTimeout=10",
        "--",
        target,
        `sh -s -- ${this.options.hostVersion} ${remoteArchive} ${nonce} ${archiveSha256}`,
      ],
      { timeoutMs: 120_000, input: Buffer.from(INSTALL_SCRIPT, "utf8") },
    );
    if (installed.exitCode !== 0) {
      throw new SshRemoteError(
        "install_failed",
        "graft-host could not be installed on the SSH machine",
        true,
      );
    }
  }

  private runSsh(target: string, command: string) {
    return this.runner(
      this.options.sshExecutable ?? "ssh",
      [
        "-T",
        "-o",
        "BatchMode=yes",
        "-o",
        "ConnectTimeout=10",
        "--",
        target,
        command,
      ],
      { timeoutMs: 30_000 },
    );
  }
}
