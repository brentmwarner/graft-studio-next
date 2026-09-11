# Graft Mobile Remote Architecture

Graft Mobile is a native SwiftUI remote UI for a Graft environment that still
executes on the user's machine. It follows a local-first remote shape more
than a hosted-agent product:

- Desktop (or future headless host) owns projects, worktrees, providers, git,
  terminals, and agent runs.
- Mobile pairs once, then talks to that host over HTTP + WebSocket while
  foregrounded.
- When backgrounded, iOS does not treat the socket as durable. The host remains
  authoritative; future APNs delivery will be an attention channel, while
  reconnect uses a persisted event cursor and snapshot recovery.
- Auth/pairing is separate from transport. LAN, Tailscale, HTTPS tunnels, and a
  future managed relay can all carry the same session model.

## Why not copy Fetch wholesale?

Fetch is an excellent native companion for Hermes Agent and is the preferred
**UI/scaffolding reference** for Graft iOS (pairing UX, offline transcript
cache, push, SwiftUI layout). Its wire protocol, dashboard surface, and
Clerk/relay productization are Hermes-specific.

Graft already has a TypeScript monorepo and desktop domain model. The mobile
app speaks a Graft protocol defined in `@graft/shared` and implemented by the
desktop remote gateway. Fetch is not the protocol source of truth for Graft.

## Research inputs

### T3 Code (`pingdotgg/t3code`)

- `apps/server` is the environment host; web/desktop/mobile are clients.
- Remote access uses one-time pairing tokens, then session credentials.
- Transport options include LAN, Tailscale Serve, custom HTTPS, SSH launch, and
  optional managed "T3 Connect" relay discovery.
- Hosted frontend pairing does **not** proxy agent traffic; the client still
  connects to the user's backend URL.

### Local-first implementation reference

- Fork/descendant of the T3 local-server model.
- Remote access today is primarily "bind the server + open in mobile browser",
  preferably on Tailnet, with an auth token.
- Confirms the minimum viable remote path: expose the local host securely, do
  not invent a separate mobile backend first.

### Fetch (`Documents/fetch` iOS)

- Native SwiftUI client with Keychain sessions, SwiftData local replica,
  GatewayClient, reconnect, and APNs patterns worth mirroring structurally.
- Graft reuses scaffolding ideas under `apps/ios`, not Hermes API shapes.

## Graft target topology

```text
┌──────────────────────────────┐
│ Native SwiftUI app (apps/ios)│
│ Keychain · SwiftData · APNs  │
└──────────────┬───────────────┘
               │ foreground HTTP + WebSocket
               │ future APNs delivery + cursor reconcile
               ▼
┌──────────────────────────────┐
│ Transport                    │
│ LAN / Tailnet / HTTPS        │
│ optional managed relay       │
└──────────────┬───────────────┘
               ▼
┌──────────────────────────────┐
│ Desktop remote gateway       │
│ device auth · snapshots      │
│ event log · commands         │
└──────────────┬───────────────┘
               ▼
┌──────────────────────────────┐
│ Existing Graft services      │
│ DB · threads · runs · git    │
│ provider sessions · tools    │
└──────────────────────────────┘
```

The desktop is authoritative. Mobile state is a disposable local replica.

## Connection lifecycle

1. The desktop gateway is enabled explicitly in Settings.
2. Desktop creates a short-lived, one-time pairing credential.
3. Mobile scans a QR code or opens a `graft://pair` deep link.
4. Pairing creates a revocable, per-device credential stored in iOS Keychain.
5. While foregrounded, mobile holds one authenticated WebSocket and sends
   application-level ping/pong frames.
6. The desktop app or headless helper keeps the host awake when the user opts
   into remote availability.
7. When iOS backgrounds the app, the socket is not treated as durable.
8. A default-off scaffold can register APNs token metadata; notification
   delivery is not implemented.
9. On foreground/network recovery, mobile reconnects with its last persisted
   event cursor and fetches every missed event.

Never use VoIP background modes to fake an always-on socket. Silent push may be
an optimization, but correctness cannot depend on it.

## Protocol invariants

Shared contracts live in `packages/shared/src/mobileRemote.ts`.
Checked-in JSON fixtures live in
`packages/shared/protocol-fixtures/mobile-v1/` and are verified by TypeScript
tests. The valid fixtures are copied byte for byte into Swift XCTest resources,
and `pnpm check:ios-fixtures` enforces parity in CI.

### Versioning

- `GRAFT_MOBILE_PROTOCOL_VERSION` is an integer. v1 additive fields may be
  optional; removing or redefining a field requires a version bump.
- Clients send `protocolVersion` on pair and WebSocket `hello`.
- Hosts reject unsupported versions with `protocol_unsupported`.
- Capability lists allow hosts to advertise partial feature sets within a
  version without breaking older clients that ignore unknown optional data.

Every protocol version must provide:

1. **Version negotiation** — unsupported versions fail with a typed
   upgrade-required error.
2. **Durable event ordering** — monotonically increasing `cursor`; reconnect
   supplies `afterCursor`; host replays or returns `snapshot_required`.
3. **Idempotent commands** — every mutation has a client-generated `commandId`.
4. **Snapshots plus events** — snapshot endpoints seed state; WebSocket events
   update it.
5. **Typed errors** — auth, authorization, stale revision, offline, overload,
   unsupported feature, and validation failures are distinguishable.
6. **Backpressure** — bound per-client queues; disconnect slow consumers with a
   typed reason and force snapshot recovery.
7. **Security** — one-time pairing token; per-device identity; revocable
   sessions; per-command authorization; never expose Electron IPC directly.

Minimum endpoints:

| Method   | Path                    | Purpose                                        |
| -------- | ----------------------- | ---------------------------------------------- |
| `GET`    | `/v1/health`            | Liveness + protocol version                    |
| `POST`   | `/v1/pair`              | Exchange one-time token for device credential  |
| `PUT`    | `/v1/push-registration` | Store this session device's APNs registration  |
| `DELETE` | `/v1/push-registration` | Remove this session device's APNs registration |
| `GET`    | `/v1/snapshot`          | Environment snapshot + cursor                  |
| `WS`     | `/v1/ws`                | Control plane + event stream                   |

Pairing URLs use `graft://pair?host=…#token=…`. The token stays in the URL
fragment so intermediaries logging the query string do not automatically capture
it.

## Managed relay

The relay exists so a phone on cellular can reach a Mac behind NAT without the
user configuring anything. The desktop dials **out** to the relay; the relay
never dials in.

```text
phone ──HTTPS/WSS──▶ relay (control-plane) ◀──WSS (desktop dials out)── desktop
        /e/{environmentId}/v1/…              /relay/v1/uplink
```

- **Registration.** The desktop posts its Graft account JWT to
  `POST /relay/v1/environments` and receives `{ environmentId, uplinkSecret,
  httpBaseUrl, wsBaseUrl, uplinkUrl }`. The secret lives in the same encrypted
  store as mobile session bearers. Re-registering with a known `environmentId`
  rotates the secret without changing the URL paired phones already hold.
- **Uplink.** One long-lived WebSocket carries a JSON mux: `register` /
  `registered`, `http` / `http-response`, and `ws-open` / `ws-opened` /
  `ws-frame` / `ws-close`. Schemas are shared in
  `packages/shared/src/mobileRelay.ts`.
- **Phone plane.** The phone speaks the unmodified mobile protocol against
  `https://relay…/e/{environmentId}`; `/v1/health`, `/v1/pair`, `/v1/snapshot`,
  and `/v1/ws` are forwarded verbatim. With no uplink attached, the relay
  answers `503 host_offline`.
- **Local proxy.** The desktop replays each relayed request against its own
  loopback gateway over real HTTP and WebSocket rather than calling handlers
  directly, so a relayed phone and a LAN phone traverse identical code.
- **Pairing.** When the uplink is connected, the relay endpoint outranks
  Tailnet and LAN, so the QR carries an `https://relay…` host with
  `endpointKind=relay` and the phone stores relay session URLs. If the relay is
  unavailable (signed out, unreachable), pairing silently falls back to
  Tailnet/LAN and Settings → Connections shows why.

### Trust boundary (v1 is not end-to-end encrypted)

TLS terminates at the relay. Pairing tokens and per-device bearers stay opaque
to it — they are minted and verified by the desktop — but the relay does see
plaintext request and response bodies as it forwards them. Therefore:

- The relay **must not persist** request or response content. Buffers are
  in-memory, per-stream, and discarded when the socket closes.
- The relay **must not log** bodies, tokens, or headers carrying credentials.
- Only routing metadata is stored: `environmentId`, the account that owns it,
  a hash of the uplink secret, an optional label, and timestamps
  (`relay_environments`).

Treat the relay as a trusted-but-observing transport until end-to-end
encryption lands. Users who do not want that trust boundary can leave the relay
unreachable (sign out) and pair over Tailnet or LAN, which is unchanged.

Relay routes are registered only when `buildServer({ enableRelay: true })` or
`RELAY_ENABLED=1` is set, which is the Railway standalone deployment. The
Vercel serverless bundle stubs the module out entirely — it cannot hold a
long-lived socket.

Out of v1: end-to-end encryption, APNs delivery over the relay, and multi-replica
routing (a single relay replica owns each uplink today).

## Product boundary implications

Local-first still means:

- Inference and tool execution stay on the user's machine / BYOM providers.
- Graft cloud identity is not an inference credential.
- The managed relay is a transport aid only — not a prompt/code store or hosted
  agent runtime. It forwards bytes and persists nothing but routing metadata.

Remote mobile UI is allowed. The old prohibition on "remote worktree
orchestration" was aimed at Graft-hosted execution, not at a phone controlling
the user's own desktop environment.

## Implementation status

| Piece                     | Location                                           | Status                                             |
| ------------------------- | -------------------------------------------------- | -------------------------------------------------- |
| Shared protocol v1        | `packages/shared/src/mobileRemote.ts`              | In — fixtures + tests                              |
| Desktop gateway           | `apps/desktop/electron/src/services/remoteGateway` | In — durable device auth + health/pair/snapshot/WS |
| Native SwiftUI app        | `apps/ios`                                         | In — Remote projects inbox + VisionKit pairing     |
| Settings → Connections UI | desktop renderer + IPC                             | In — relay/LAN/Tailnet endpoints, local QR, revoke |
| Domain adapters           | gateway → desktop services                         | Next                                               |
| APNs registration         | host + iOS                                         | In — default-off scaffold; no delivery             |
| APNs attention delivery   | host/provider                                      | Later                                              |
| Managed relay             | `services/control-plane` + desktop uplink          | In — Railway standalone only; no E2E encryption    |

## Next implementation slices

1. Domain adapters from gateway commands onto existing desktop services.
2. Expand iOS transcript/composer, approvals, and diffs.
3. Add APNs attention delivery after signing/provider configuration.
4. End-to-end encryption across the relay, then multi-replica uplink routing.

Desktop occupying another user-owned machine over SSH (headless `graft-host`,
agents on that box) is specified in [ssh-remote-host.md](./ssh-remote-host.md).
That path reuses this design's host/session/snapshot/event concepts but has a
separate desktop wire protocol and authorization profile. Mobile v1 remains
unchanged.
