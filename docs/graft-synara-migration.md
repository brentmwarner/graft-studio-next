# Graft migration onto the Synara base

## Repository roles

- `graft-studio` remains the releasable legacy product and rollback path.
- `graft-studio-next` is the only migration repository. Its migration branch is
  based on Synara and carries Graft-owned product work as additive commits.
- `upstream` is Synara and is fetch-only. Never push branches, tags, issues, or
  pull requests upstream as part of the Graft workflow.

No third repository is part of this migration.

## Pinned recovery points

| Purpose               | Repository          | Ref                                            | Commit                                     |
| --------------------- | ------------------- | ---------------------------------------------- | ------------------------------------------ |
| Legacy Graft rollback | `graft-studio`      | `graft-legacy/pre-synara-migration-2026-09-02` | `bd1206fe6d8c4f2f059c4bd111d8ad88797c1b09` |
| Synara migration base | `graft-studio-next` | `graft-base/synara-2026-09-02`                 | `562c5fea77cff1dacb29d5e6216ed94a05f1b6a1` |

The existing `main` branch in each repository stays untouched until the
migration is reviewed and deliberately cut over.

## Mobile compatibility boundary

Synara has desktop, server, and web applications but no production Graft mobile
clients. Both existing clients therefore live in this repository:

- `apps/ios` — native SwiftUI
- `apps/mobile-android` — Expo / React Native
- `packages/mobile-contract` — the versioned, Graft-owned wire contract shared
  by Android and the Synara server adapter; its golden fixtures also
  validate the Swift decoder.

Neither mobile app may import Synara's internal contracts. The server adapter
must translate between `@graft/mobile-contract` and Synara orchestration. This
keeps released mobile clients compatible with both the legacy host and the new
host during the rollback window.

Run `bun run migration:check` to verify this boundary and
`bun run check:ios-fixtures` to verify Swift fixtures.

## Mobile adapter

The Synara server now mounts a Graft mobile compatibility API:

- `GET /v1/health`
- `POST /v1/pair`
- `GET /v1/snapshot`
- `GET /v1/ws`
- `PUT` and `DELETE /v1/push-registration`
- owner-only `POST /v1/pairing-link`

The adapter translates mobile commands into Synara orchestration commands. It
supports project and thread browsing, model discovery, thread creation, model
and permission changes, streamed turns, cancellation and steering, approvals,
questions, and diff summaries. Cursor replay currently requests an
authoritative snapshot when the client is behind instead of replaying a large
event range.

Enabled Synara providers and their live-discovered models are returned by
`models.list`; the built-in catalog is used as a fallback when a provider CLI
cannot be queried. A model appearing in the picker does not install or sign in
to its provider CLI—the corresponding provider must still be installed and
authenticated on the host.

## Running a mobile-capable development host

For HTTPS or a tailnet reverse proxy, configure the public origin and bind the
server for remote access:

```bash
bun run apps/server/src/index.ts \
  --host 0.0.0.0 \
  --auth-token <long-random-secret> \
  --public-url https://synara.example.com \
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
token is exchanged once for a revocable Synara client bearer session.

## Cutover and rollback rules

1. Develop on `codex/graft-synara-migration`; keep both legacy `main` branches
   protected.
2. Keep the Graft mobile HTTP/WebSocket adapter over Synara orchestration as the
   compatibility boundary; do not couple either mobile client to Synara internals.
3. Ship preview builds with distinct update channels and isolated data roots.
   Mobile previews use TestFlight and Play internal testing.
4. Data migration copies into a new store. It never deletes or rewrites the
   legacy store in place.
5. Keep the legacy mobile protocol and backend operational through at least one
   stable release after cutover. Mobile binaries cannot be reliably downgraded,
   so rollback is a backend-routing decision.
6. A release remains prohibited until it receives explicit approval under the
   Graft release policy.

## Adopting later Synara updates

Fetch only `upstream/main`, review the range from the last pinned base, and merge
an approved update through a dedicated integration branch. Never auto-merge,
never rebase published Graft commits onto upstream, and never push to
`upstream`.

Local clones should enforce the push guard:

```bash
git config remote.upstream.pushurl DISABLED
```
