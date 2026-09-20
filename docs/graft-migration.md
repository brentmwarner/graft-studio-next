# Graft Studio identity and migration notes

## Repository roles

- `graft-studio` remains the releasable legacy product and rollback path.
- `graft-studio-next` is the current Graft product repository. It was based
  on the Synara codebase and now ships Graft identity, packages, and product
  work as the only releasable next host.
- Fetch verified upstream history through the Cursor `origin` mirror. Do not
  push Graft branches, tags, issues, or pull requests to the historical Synara
  GitHub repository as part of the Graft workflow.

No third repository is part of this migration.

## Pinned recovery points

Published ref names below are historical and must not be rewritten. They
still name Synara because that is how they were published.

| Purpose                 | Repository          | Ref                                            | Commit                                     |
| ----------------------- | ------------------- | ---------------------------------------------- | ------------------------------------------ |
| Legacy Graft rollback   | `graft-studio`      | `graft-legacy/pre-synara-migration-2026-09-02` | `bd1206fe6d8c4f2f059c4bd111d8ad88797c1b09` |
| Pre-Graft-identity base | `graft-studio-next` | `graft-base/synara-2026-09-02`                 | `562c5fea77cff1dacb29d5e6216ed94a05f1b6a1` |

Graft work is now on `graft-studio-next/main`. The original pins above remain
recovery points; subsequent upstream integrations are recorded below. Legacy
`graft-studio/main` remains the rollback product.

## Mobile compatibility boundary

Graft has desktop, server, and web applications plus Graft mobile clients in
this repository:

- `apps/ios` — native SwiftUI
- `apps/mobile-android` — Expo / React Native
- `packages/mobile-contract` — the versioned, Graft-owned wire contract shared
  by Android and the Graft server adapter; its golden fixtures also
  validate the Swift decoder.

Neither mobile app may import Graft's internal desktop/server contracts. The
server adapter must translate between `@graft/mobile-contract` and Graft
orchestration. This keeps released mobile clients compatible with both the legacy
host and the new host during the rollback window.

Run `bun run migration:check` to verify this boundary and
`bun run check:ios-fixtures` to verify Swift fixtures.

## Mobile adapter

The Graft server mounts a Graft mobile compatibility API:

- `GET /v1/health`
- `POST /v1/pair`
- `GET /v1/snapshot`
- `GET /v1/ws`
- `PUT` and `DELETE /v1/push-registration`
- owner-only `POST /v1/pairing-link`

The adapter translates mobile commands into Graft orchestration commands. It
supports project and thread browsing, model discovery, thread creation, model
and permission changes, streamed turns, cancellation and steering, approvals,
questions, and diff summaries. Cursor replay currently requests an
authoritative snapshot when the client is behind instead of replaying a large
event range.

Enabled Graft providers and their live-discovered models are returned by
`models.list`; the built-in catalog is used as a fallback when a provider CLI
cannot be queried. Droid uses its built-in catalog for this request, so opening
or reconnecting a mobile composer does not launch Factory authorization. A
model appearing in the picker does not install or sign in to its provider CLI.

### Mobile conversation lifecycle

iOS keys cumulative assistant frames by message ID, including legacy
`:delta:N` and `:complete` suffixes. A completed message cannot be reopened by
a delayed delta. Authoritative snapshots settle reasoning and running tools
when their turn has ended, including completion while the phone was offline.
The gateway seeds cumulative text from the saved message after reconnecting.

The transcript keeps one shimmering progress indicator through an active turn.
On completion, earlier commentary and tools fold above the final answer.
Incoming text is coalesced every 32 milliseconds without an additional typing
delay, and final text is displayed immediately.

Mobile chats keep their provider after the first user message. Models and
supported effort levels remain selectable within that provider. The gateway
also rejects provider changes for existing turns or imported message history.
See [mobile transcript presentation](ios-transcript-design.md) for task progress,
skills, file references, and composer controls.

## Running a mobile-capable development host

For HTTPS or a tailnet reverse proxy, configure the public origin and bind the
server for remote access:

```bash
bun run apps/server/src/index.ts \
  --host 0.0.0.0 \
  --auth-token <long-random-secret> \
  --public-url https://graft.example.com \
  --no-browser
```

For temporary testing on a trusted LAN only:

```bash
bun run apps/server/src/index.ts \
  --host 0.0.0.0 \
  --auth-token <long-random-secret> \
  --allow-insecure-remote \
  --no-browser
```

Startup prints a one-time `graft://pair?...#token=...` link using the public
origin or a reachable LAN address. Open that link on either mobile app. The
token is exchanged once for a revocable Graft client bearer session.

## Cutover and rollback rules

1. Develop changes on dedicated integration branches from the existing local
   checkout; preserve published Graft history and the legacy rollback branch.
2. Keep the Graft mobile HTTP/WebSocket adapter over Graft orchestration as the
   compatibility boundary; do not couple either mobile client to Graft internals.
3. Ship preview builds with distinct update channels and isolated data roots.
   Mobile previews use TestFlight and Play internal testing.
4. Data migration copies into a new store. It never deletes or rewrites the
   legacy store in place.
5. Keep the legacy mobile protocol and backend operational through at least one
   stable release after cutover. Mobile binaries cannot be reliably downgraded,
   so rollback is a backend-routing decision.
6. A release remains prohibited until it receives explicit approval under the
   Graft release policy.

## Adopting later upstream updates

Verify the current upstream `main` SHA, fetch that commit through the Cursor
`origin` mirror, and merge it on a dedicated integration branch based on
`origin/main`. Preserve Graft changes when resolving conflicts. Never rebase
published Graft commits onto upstream, auto-merge unattended updates, or push
to the historical Synara GitHub repository.

### September 14, 2026 integration

- Graft main: `f1c3a3e6f55340404df97e88577103b03af8af7d`.
- Upstream main: `70f5ed0e4757c0f69891b258171da80d324f0e18` (0.8.4).
- Previous shared ancestor: `182208581e9436149bdfffe3418cbb78a21528f9`;
  this integration brings in all 169 subsequent upstream commits.
- Retained Graft logos, Central icon mappings, landing background, mobile
  connections, host occupancy, SSH support, and isolated Graft home paths.
- Moved the Graft task-list icon into the extracted composer footer and kept
  the model-picker layout fixes alongside upstream menu collision handling.
- Adopted the official migration 99, `InvalidateProjectionThreadsCursor`,
  which performs the same repair as the local compatibility migration.

Graft's desktop display name, window title, onboarding, settings, browser labels,
and tool activity copy use the Graft product identity. Development favicons use
the existing Graft artwork. First-party packages use the `@graft/*` scope.
Graft's desktop identity is isolated: `com.graft.studio.next` (with `.dev` and
`.canary` suffixes), `graft://app`, and `graft-studio-next*` Electron profiles.
Desktop home overrides use `GRAFT_HOME`; defaults remain `.graft*` and never
fall back to `.synara*`. The desktop always binds its private backend to
loopback. Do not set global `GRAFT_BIND_HOST`, `GRAFT_HOME`, or remote-access
overrides for Graft desktop: those also affect other Graft processes. Leftover
Synara databases and browser profiles must not be adopted implicitly. Graft's
updater channel is `graft`.

## Cellular access

The migrated host uses the existing Graft managed relay. In the signed-in desktop,
**Settings → Connections → Add device → Get started** connects the relay before
issuing the QR code. To connect it separately, turn on remote connections and choose
**Connect Graft account** if the relay is not connected. The desktop reuses its
signed-in account; browser/headless hosts open sign-in on the host computer using
the Graft PKCE flow. Once the relay says Connected, create a new pairing code and
pair the phone.

Phones previously paired to a LAN or Tailnet URL need to pair once using the relay
code. Their old saved local address cannot become internet-reachable by retrying
it. Both iOS and Android continue to use the unchanged Graft mobile protocol.

The host opens an outbound WSS connection; inbound router ports are unnecessary.
Relay pairing keeps the full `/e/<environmentId>` URL in both the QR code and the
returned mobile session. During a relay outage, pairing waits briefly and reports
the outage instead of silently switching a configured relay back to LAN.

The desktop attempts a read-only import of the existing encrypted `relay-uplink`
entry from the legacy `@graft/desktop` profile. If the OS key cannot decrypt it,
connect the Graft account again. `GRAFT_LEGACY_USER_DATA` can select a legacy
preview profile. The old profile is never modified.

New sign-ins store only the scoped relay credential in `mobile-relay.json` under
the host state directory (atomic write, mode 0600). The account JWT is used for
registration and is not persisted. Disabling remote connections stops the uplink
and cancels pending sign-in. A rejected relay credential requires signing in again.
For a headless host, `GRAFT_RELAY_CREDENTIAL_FILE` can supply a provisioned relay
registration JSON file; protect that file as a secret. `GRAFT_CONTROL_PLANE_URL`
selects the Graft account/registration service and defaults to `https://api.graftapp.io`.

The relay remains a trusted TLS terminator as in legacy Graft; this migration does
not add end-to-end encryption. Host execution remains local. Mobile operating
systems may suspend a background app; returning to it reconnects and resynchronizes
through the existing mobile snapshot protocol.
