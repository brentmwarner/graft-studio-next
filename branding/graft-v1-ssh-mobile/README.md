# Graft v1 SSH and mobile (source drop)

Extracted from `graft-studio` at `bd1206fe6d8c4f2f059c4bd111d8ad88797c1b09` for porting onto Synara-based `graft-studio-next`. Files under `source/` keep their original paths. This is a reference drop, not a runnable subtree.

**Already on `codex/graft-synara-migration`:** iOS, Android, `packages/mobile-contract`, and the Synara compatibility gateway (`apps/server/src/graftMobile/`). **Not on that branch:** SSH occupancy, `graft-host`, or `/desktop/v1/*`.

## How SSH works

- You add a label plus an OpenSSH target (`user@host` or an `~/.ssh/config` Host). Graft does not store private keys. It shells out to system `ssh`/`scp` with `BatchMode=yes` and resolves user, host, port, and jump hosts with `ssh -G`.
- First connect runs `graft-host bootstrap`. If the daemon is missing or stale, Desktop copies a checksummed Linux x64 glibc archive, installs it under `${XDG_DATA_HOME:-$HOME/.local/share}/graft/host/installation`, and starts it bound to loopback only.
- Desktop then opens `ssh -L 127.0.0.1:<local>:127.0.0.1:<remotePort>`. `ManagedSshTunnel` reconnects with backoff and re-probes `GET /desktop/v1/health` so the session identity is not tied to a tunnel port.
- Bootstrap returns a one-use enrollment token. Desktop exchanges it at `POST /desktop/v1/enroll` for a `desktop_occupancy` bearer, stores the bearer in OS secret storage, and keeps machine records in local SQLite.
- The renderer keeps one window. Each project carries a local or SSH machine id. `EnvironmentClient` routes that project to in-process IPC or `RemoteEnvironmentClient` over `WS /desktop/v1/ws`. V1 remotes are Linux x64 glibc only. This Mac stays in-process. Mac/Windows remotes are later work.

Key packages: `@graft/host` (`graft-host` CLI), `@graft/host-runtime`, `@graft/shared` (`desktopRemote.ts`), system OpenSSH, `better-sqlite3`, `node-pty`, `ws`.

Entry points: `apps/desktop/electron/src/services/sshRemote/sshRemoteConnectionManager.ts`, `sshHostInstaller.ts`, `managedSshTunnel.ts`, `apps/host/src/cli.ts` (`bootstrap` / `serve`), `apps/host/src/hostServer.ts`.

## How mobile pairing works

- Settings → Connections enables the desktop remote gateway. `networkEndpoints.ts` prefers relay, then Tailnet, then LAN, then loopback. Desktop mints a one-time token and a `graft://pair?v=1&host=<http-url>[&endpointKind=…]#token=…` URL. The token stays in the fragment.
- **iOS** (`apps/ios`, bundle `studio.graft.mobile`, URL scheme `graft`) and **Android** (`apps/mobile-android`) parse that QR, paste, or deep link, then `POST /v1/pair`. The host returns a revocable per-device bearer (iOS Keychain; Android session repository).
- While foregrounded, the phone `GET /v1/snapshot` then holds `WS /v1/ws` (hello, ping/pong, `commandId` mutations, cursor replay). Backgrounding does not keep a durable socket. Reconnect sends `afterCursor` or takes a fresh snapshot.
- Optional managed relay: Desktop authenticates to the control plane, `POST /relay/v1/environments`, and dials out `WSS /relay/v1/uplink`. The phone speaks the same `/v1/*` protocol at `/e/{environmentId}/v1/…`. TLS terminates at the relay; pairing tokens stay opaque to it.
- Server routes on the Mac: `GET /v1/health`, `POST /v1/pair`, `GET /v1/snapshot`, `WS /v1/ws`, and optional `PUT`/`DELETE /v1/push-registration`. Desktop occupancy uses a separate `/desktop/v1/*` surface so a phone bearer cannot gain filesystem or PTY grants.

## Overlap with Synara `mobile.v1` / Mobile Access

| Surface | Graft v1 | Synara `main` (this branch's base) | `codex/graft-synara-migration` |
| --- | --- | --- | --- |
| Native `graft://pair` | iOS + Android | Absent | Present (apps copied) |
| `/v1/health\|pair\|snapshot\|ws` | Electron `remoteGateway` | Absent | Synara **compatibility gateway** `apps/server/src/graftMobile/` translating `@graft/mobile-contract` onto orchestration |
| Remote Access | N/A | `REMOTE.md`: bind web server + `--auth-token`, open in a phone browser | Same plus printed `graft://pair` link |
| SSH / `graft-host` | Desktop occupancy | Absent (git SSH URLs only) | Absent |
| Device helper | N/A | iOS Simulator capture helper, not pairing | Unchanged |

Port SSH onto Synara as a new host occupancy path. Keep mobile clients on `mobile.v1` and extend the existing compatibility gateway rather than teaching phones `/desktop/v1`.

## Intentionally omitted

Domain adapters (`desktopRemoteAdapters.ts`), the full Electron IPC `channels.ts` union, host unit tests, Android/iOS UI beyond pairing, and generated app-server types. Follow `source/` paths back to `graft-studio` when you need those.

## File list

See `source/` on this branch. Origin SHA: `bd1206fe6d8c4f2f059c4bd111d8ad88797c1b09`.
