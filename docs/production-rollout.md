# Graft 0.9.0 production cutover

This branch prepares the current Graft app to replace the legacy desktop app.
It starts from Graft main at `da18e6797`, including the current mobile protocol
and desktop functionality. Version 0.9.0 has not been published.

## Account continuity

The desktop uses the existing `https://api.graftapp.io` account service and its
WorkOS production environment. There is no new user database or account-ID
mapping to migrate. Browser sign-in uses the existing PKCE exchange. Only a
verified `/account/me` response opens the desktop workspace.

An encrypted legacy JWT can be imported without changing its source store.
Expired, deleted, unreadable, or unverified credentials require sign-in. A
previously verified, unexpired session can continue during a temporary outage.
Signing out, switching accounts, or losing the session disconnects this device's
relay/LAN access and paired clients. Desktop relay setup uses the same verified
account; browser/headless server authentication remains separate.

Real production sign-in and OS keychain continuity still need native validation.
No WorkOS secrets are bundled or copied into the renderer.

## Installed application and data

Stable uses the legacy `com.graft.studio` application ID and Windows installer
GUID, with the existing Blob `latest` update manifests. Dev and Canary keep
their separate identities. New data stays in `.graft` and the
`graft-studio-next` Electron profile; the legacy profile is retained for recovery.

On the first stable launch, the desktop discovers the legacy
`@graft/desktop/graft-local.db` profile. The backend takes a consistent SQLite
backup including committed WAL data before importing offline orchestration
commands. Deterministic IDs and durable command receipts make restart/retry
safe. Import failures are shown before the workspace opens.

All imported conversations are read-only. Compatible text histories appear in
the new sidebar; other providers and execution modes remain in the archive.
Original tool, reasoning, plan, event, attachment, and native-session records
remain available in the archive or preserved SQLite snapshot. Settings → Account
→ Previous Graft history provides the summary and paged conversation archive.
New work starts in a fresh chat in the same project. Native session resumption
has not been claimed or implemented by this migration.

Unknown preferences, spaces, actions, and automations remain in the original
database; they are not activated in the new app. Missing attachments and files
outside the approved profile are reported explicitly. Mobile devices may need
to pair again. The legacy account service and mobile backend must remain
available through the rollback window.

The normal updater must quit the legacy process before cutover. A snapshot
cannot include later writes from an independently running legacy app.

## Release validation

The native build matrix is macOS arm64, macOS x64, Windows x64, and Linux x64.
These targets need separate installation, keychain, sign-in, updater, migration,
and recovery evidence. Windows/Linux ARM and mobile store releases are not
implied by the desktop matrix. See [release.md](release.md) for packaging,
signing, promotion, supported OS versions, and recovery details.

Focused tests cover account lifecycle, relay cancellation, owner-only migration
routes, actual SQLite/WAL backup, interrupted import/replay through the real
orchestration engine, read-only admission, browser gates, and publication
ordering/checksums. A synthetic database assembled from the legacy v31 source
schema (21 tables and 32 additive columns) also passed real backup and import
preparation without changing its source database or WAL. No actual legacy
profile was present at the expected path on this Linux host.

`apps/web/scripts/smoke-graft-production.mjs` tests the actual Linux AppImage
with disposable profiles and synthetic legacy history, including restart.
It explicitly records real WorkOS login and legacy updater installation as
not run; its result cannot substitute for native upgrade receipts.

Full workspace formatting, lint, and type checks remain pending the user's
explicit request required by the supplied AGENTS.md. Production signing and
Blob publication credentials are not available in this local environment.
The prepared GitHub browser sign-in is needed to finish release access.

## Promotion

Publish immutable versioned payloads, verify their public checksums, preserve
the prior pointers, then update the existing stable manifests. The publisher
refuses incomplete native builds or missing upgrade evidence. It never deletes
the old installers. Deploy the marketing resolver before promotion so the
download page follows the same feed. Restoring old pointers stops further
distribution; it does not downgrade clients that already installed the update.
