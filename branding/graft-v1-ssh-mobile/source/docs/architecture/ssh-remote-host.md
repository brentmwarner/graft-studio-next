# SSH Remote Host

Graft Desktop can connect to another user-owned machine over SSH. Connecting a
machine adds another place projects can live; it does not switch, reload, or
replace the Graft workspace. Local and remote projects remain together in the
same sidebar. For a remote project, git, terminals, and agent CLIs run on the
machine that owns that project.

This document describes the implemented v1 architecture. It reuses the host,
session, snapshot, and event concepts from
[mobile-remote.md](./mobile-remote.md), but deliberately uses a separate
desktop protocol and authorization profile. It must obey
[local-first-product-boundary.md](./local-first-product-boundary.md).

## North star

You add `user@ip` (or an `~/.ssh/config` Host). Graft SSHs there with your
existing keys, ensures `graft-host` is running, and makes the machine available
as a project location. Adding a project from it places that project beside
existing local projects. Threads,
diffs, approvals, files, git, and terminals for that project use the remote disk
and processes. RAM for that work is on the remote box.

Graft is not a visualizer of a CLI session you already started in another SSH
window. Locally, Graft already spawns the provider CLI and renders the run.
Remote is the same spawn, with `cwd` and binaries on the attached host.

## Locked decisions

| Decision                     | Choice                                                                                                                                       |
| ---------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| Product feel                 | One stable Graft workspace with local and remote projects mixed together; machine location is a property of each project                     |
| Where agents run             | On the attached machine, using CLIs installed there                                                                                          |
| What Graft installs over SSH | `graft-host` only (Cursor-style). Never auto-install `claude` / `codex` / etc.                                                               |
| How you add a machine        | A label and OpenSSH target such as `user@host` or an `~/.ssh/config` Host. Port and advanced options come from OpenSSH config. Not a QR flow |
| Tailscale                    | Not a dependency. Optional reachability (a Tailscale IP is just an IP)                                                                       |
| Full UX                      | Destination is the full desktop surface, not a chat-only remote mode                                                                         |
| Cloud                        | No Graft-hosted agents, worktrees, or SSH proxying. User-owned machines only                                                                 |

## Why not the alternatives

**SSHFS / mount the repo locally and run agents here.** Network filesystems
break watchers, git, and BYOM CLIs. It also puts RAM on the laptop, which is
the opposite of the reason to occupy a server.

**VS Code–style remote FS into the local app, with no Graft on the box.** Graft
does not implement agent tools. `SessionManager` spawns provider CLIs with a
local `cwd` (`apps/desktop/electron/src/services/sessionManager.ts`). Those
processes must run next to the files. A thin `graft-host` _is_ the Graft-shaped
equivalent of `cursor-server`.

**Chat-only remote window.** Cheaper this month, then the desktop UI permanently
forks. Files, git, and terminals have to join the same host protocol or remote
Graft will feel like the phone.

**Require Graft Desktop on every remote.** Fine for another Mac you sit at.
Wrong for a headless Linux box. `graft-host` is the same environment services
without a GUI.

## Topology

```text
┌─────────────────────────────┐     SSH (OpenSSH)      ┌─────────────────────────────┐
│ Graft Desktop (this machine)│  user@ip / ssh config  │ Remote (Linux x64 glibc v1)│
│                             │───────────────────────▶│                             │
│ Renderer = full Graft UX    │   loopback tunnel      │ graft-host                  │
│ Project environment router ─┼───────────────────────▶│  SQLite, projects, git      │
│                             │   host protocol        │  PTYs, file watchers        │
│                             │   (HTTP + WebSocket)   │  spawn claude/codex/…       │
└─────────────────────────────┘                        └─────────────────────────────┘
```

Two roles, two scoped client protocols:

- **Host** — owns execution. Today that is Electron main on this Mac. Next it is
  also `graft-host` on any user-owned machine.
- **Client** — the desktop app or phone. The desktop routes each project to
  local IPC or the owning machine's desktop-host protocol over an SSH tunnel.
  A phone continues to use mobile v1.

The desktop contract is `packages/shared/src/desktopRemote.ts`; the phone
contract remains `packages/shared/src/mobileRemote.ts`. A mobile pairing record
whose platform happens to be `"desktop"` does not receive desktop occupancy
authority.

## `graft-host`

`graft-host` is the environment: SQLite, projects, worktrees, git, files,
terminals, provider CLI spawns, approvals, and the HTTP/WebSocket gateway.

### Packaging

The host-facing domains are extracted behind an Electron-free `HostRuntime`.
`graft-host` composes headless implementations without importing Electron or a
`BrowserWindow`.

- **Local (this app):** host stays in-process. Opening Graft on this Mac still
  occupies this Mac. No SSH.
- **Remote:** a headless Node entry installed into a versioned directory under
  `${XDG_DATA_HOME:-$HOME/.local/share}/graft/host/installation`.

Do not invent a second agent engine. `crates/agent-engine` is not the
production runner. Production remains BYOM CLI spawn on the host.

Linux x64 with glibc is the supported v1 remote target. The archive is built
locally from an exact npm lock inside a digest-pinned Node 22 Linux container.
It includes `better-sqlite3`, `node-pty`, and `ws`, including the Linux native
artifacts. The remote requires Node.js 22 or newer, but it does not need npm, a
compiler, package-registry access, or install scripts. Mac and Windows remotes
remain later work.

### Lifecycle

First successful SSH connect:

1. Probe for a compatible `graft-host`.
2. If missing, copy the bundled, self-contained Linux archive with `scp`,
   verify its SHA-256 checksum and bundled runtime remotely, install it into a
   versioned directory, and atomically activate it. Do not `curl | sh` an
   unpinned script or resolve packages on the remote.
3. Start the host bound to **loopback only** on the remote.
4. Open a local loopback tunnel to that port.
5. Exchange the one-use, SSH-issued enrollment token for a
   `desktop_occupancy` session bearer. The saved session identity is independent
   of the selected local tunnel port.
6. The machine becomes available as a project location in the existing app.

After install, leave `graft-host` running. Graft can reconnect without
reinstalling, and disconnecting this laptop does not kill in-flight turns. V1
does not expose the loopback-only daemon directly to phones.

Stopping the host is an explicit action on that machine (or a “Stop host”
control in Connections).

### What the host does not install

Provider CLIs (`claude`, `codex`, `cursor-agent`, `agy`, …) and their logins
stay the user’s responsibility on that machine. On attach, the host reports
which providers are actually present. If none are usable, the window shows a
setup state on _that_ machine — not a silent installer, and not a fallback to
this laptop’s CLIs.

## Connect: “just add the SSH IP”

Transport is OpenSSH on this computer (`ssh`), including `~/.ssh/config`,
`IdentityAgent`, `ProxyJump`, and `known_hosts`. Graft does not store SSH
private keys and does not reimplement SSH in JavaScript.

Add machine fields:

- Label
- SSH target, such as `fedora`, `user@example.com`, or a Tailscale hostname

OpenSSH owns the effective user, hostname, port, key, agent, `ProxyJump`, and
host-key policy. Graft resolves that configuration with `ssh -G`.

Saved machine records live **on this computer** (SQLite / local store). They
are not a control-plane resource. The control-plane relay remains reachability
for hosts that register an uplink; it is not an SSH broker.

Tailscale is only a possible route to SSH in v1. Graft neither changes tailnet
policy nor exposes `graft-host` directly on a Tailnet, LAN, or relay.

## Connected-machine UX

- Connecting a machine only changes its connection status. It never creates a
  window, reloads the renderer, or changes the current project.
- The project picker is a modal inside the normal Graft workspace. It always
  offers `This Mac` plus saved SSH machines and includes a remote file browser.
- Adding a remote project inserts it into the same sidebar as local projects.
  A server icon and machine label identify that individual project.
- Selecting any project routes project-scoped commands to its owning machine.
  Selecting a local project routes them locally again; there is no separate
  "return to This Mac" app state.
- A terminal opened for a remote project is a PTY **on that host**, not a local
  shell that happens to have `ssh` typed in.

## Connections settings

Today Settings → Connections includes inbound phones that control this Mac and
outbound SSH machines that can own projects (`ConnectionsPanel.tsx`).

The page becomes two lists, not one QR dialog with extra fields.

1. **This machine** — enable gateway, keep-awake, endpoints, QR pairing
   (existing mobile flow).
2. **Machines** — saved SSH targets; add `user@host`; connect; last seen;
   remove. Connecting makes the machine available to the project picker; it
   does not replace the current workspace.
3. **Devices** — the existing phones that can control **this Mac**. That mobile
   section and its pairing flow are unchanged by SSH occupancy.

Copy must not call SSH “add a device.” Devices are clients. Machines are hosts.

## Protocol

Reuse the mobile design's session, snapshot, event, and capability concepts,
not its command surface or credentials. Desktop occupancy has separate
`/desktop/v1/*` endpoints, strict schemas, and a `desktop_occupancy` grant. The
host authorizes every command using:

`host capabilities ∩ session grants ∩ client-supported capabilities`

This prevents an existing mobile bearer from gaining filesystem, Git, or PTY
authority. Current desktop-host coverage is:

| Area                            | V1 behavior                                                                 |
| ------------------------------- | --------------------------------------------------------------------------- |
| Projects and threads            | Created, listed, updated, archived, and persisted on the host               |
| Runs and providers              | Provider inventory and CLI-backed turns execute on the host                 |
| Files                           | Tree, search, read, write, watch, mutations, and approved local-file import |
| Git and worktrees               | Supported commands execute against the remote repository                    |
| Terminals                       | Remote PTYs use the ephemeral multiplexed stream                            |
| Attachments and larger payloads | Approved local bytes use an authenticated, checksummed, one-use bulk upload |

The shared v1 command table is the source of truth. Desktop commands absent
from that table are not advertised as host-owned. Machine-local actions such
as Reveal in Finder, local IDE opening, thread export, and interactive OAuth
start are explicitly unavailable in a remote environment rather than
accidentally running on this Mac.

The main `BrowserWindow` remains bound to one stable application shell. Every
project row carries either a local location or a saved machine identity. The
renderer passes the selected project's machine ID with project-scoped commands;
main routes them through the local or remote `EnvironmentClient`. Bootstrap
merges saved remote project references with the local catalog, so both remain
visible even while a machine is temporarily disconnected. Connecting a machine
never reloads the renderer or replaces a window binding.

Durable events/cursors and mutation receipts live in host SQLite so reconnect
and daemon restart do not blindly repeat mutations. PTY, file-watch, LSP, and
progress traffic use ephemeral multiplexed streams; bulk bytes do not travel
in the durable event journal.

## Product boundary

This is still local-first. The executing machine is the user’s, reached with
the user’s SSH credentials. Graft cloud must not grow:

- hosted agent execution
- hosted worktrees
- an SSH jump / key-escrow service
- persistence of repo contents, prompts, or diffs on the relay

Allowed, matching the existing mobile exception: opt-in UI on one of the user’s
devices talking to a Graft environment on another of the user’s machines, with
ephemeral transport (SSH tunnel, LAN, Tailnet, relay as byte-pipe).

The boundary doc should be updated to say “user’s own machines” rather than
only “user’s Mac,” when this ships.

## Security

- SSH auth is OpenSSH’s (keys, agent, config). Graft never uploads those keys.
- Host key verification is OpenSSH’s `known_hosts`.
- Remote gateway binds loopback; the SSH tunnel is the exposure path.
- SSH bootstrap returns a short-lived, one-use enrollment token. The host then
  issues a revocable, desktop-scoped session. Tokens and bearers are stored as
  hashes by the host; the desktop bearer is kept in OS-backed secret storage.
- Auto-install only from pinned, checksummed Graft artifacts.
- Revoke: remove the machine record locally; revoke this desktop’s session on
  the host; stopping `graft-host` is separate and explicit.

## Non-goals (this design)

- Attaching to a `claude` process the user started in a raw SSH tmux session
- Graft-cloud GPUs or Graft-operated remotes
- SSH as a way for a phone to pair to this Mac (phones keep QR / `graft://`)
- Using this laptop’s provider CLIs against remote files
- A second, chat-only remote product

## Phased delivery (same destination)

These are implementation slices, not different products. Each slice must leave
the host/client split intact.

1. **EnvironmentClient** — renderer depends on a host interface; local IPC is
   the first backend. No user-visible SSH yet.
2. **Separate desktop protocol coverage** — files, git, worktrees, terminals,
   provider inventory, durable state, streams, and bulk transfer. Mobile keeps
   its existing protocol unchanged.
3. **`graft-host` package** — headless install on Linux; loopback gateway;
   same services as Electron main.
4. **SSH machines + mixed project catalog** — Connections Machines list;
   OpenSSH; install or start host; tunnel; enroll this desktop; add remote
   projects beside local projects.
5. **Mac and Windows remotes** — same connected-machine flow; OpenSSH Server on
   Windows.

Do not ship step 4 against the mobile-only command set. That would teach
people a remote Graft that cannot open files or terminals.

## Testing

- Protocol fixtures in `packages/shared/protocol-fixtures/` for any new
  capabilities; iOS fixture check stays green (`pnpm check:ios-fixtures`).
- Unit: SSH target parsing, ssh-config Host resolution, install probe
  (missing / compatible / stale host).
- Integration: fake host over loopback (no real SSH) proving
  `EnvironmentClient` remote backend can snapshot, start a turn, stream
  events, and open a PTY.
- Manual: Linux box with OpenSSH, `user@ip`, existing `claude` on the box; add a
  remote project, confirm local projects remain in the sidebar, run a turn,
  disconnect, and confirm the turn can keep running on the host.
- Boundary: tests that a remote turn’s `cwd` is the host path, not a path on
  the laptop.

## Mobile

No one-sided mobile feature. Occupying a remote host is a **desktop** client
of a host that already has a mobile protocol.

The v1 daemon is loopback-only and does not advertise a phone endpoint. Phone
access to a headless host is deferred until it has a separately designed,
explicitly enabled reachability and secret-storage path.

Android and iOS stay in parity with each other; they do not need an SSH
client for v1.

## Current validation status

The loopback host workflow, desktop component flow, Electron E2E, package
build, packaged-app launch, no-display host self-test, reconnect/restart, and
mobile fixture regressions are automated. The real `fedora` alias resolves and
the machine is online on Tailscale, but its tailnet policy currently denies SSH
as user `brentwarner` before bootstrap. Graft does not alter that policy.

The current OpenSSH subprocesses use non-interactive authentication. A key or
agent that works with `BatchMode=yes` is therefore required; password and
keyboard-interactive prompts are later UX work.
