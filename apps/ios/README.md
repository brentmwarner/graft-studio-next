# Graft iOS

Native SwiftUI companion app for Graft Studio.

## Requirements

| Tool                  | Version                  |
| --------------------- | ------------------------ |
| Xcode (beta)          | 16.4+ (iOS 27 SDK)       |
| iOS Deployment Target | 26.0                     |
| Swift                 | 6.0 (strict concurrency) |
| XcodeGen              | 2.45+                    |

**No third-party dependencies.** The app uses only Apple frameworks: SwiftUI, SwiftData, URLSession, Security, Network, UserNotifications, OSLog.

## Bundle ID

`studio.graft.mobile` — placeholder, replace before App Store submission.

## URL Scheme

`graft` — registered in Info.plist for deep-link pairing.

Pairing URL format:

```
graft://pair?v=1&host=<encoded-host-url>[&label=<name>][&endpointKind=tailnet]#token=<one-time-token>
```

The token is placed in the **URL fragment** (`#token=…`) so it is never transmitted to intermediate servers or captured in access logs. Fragment values are local-only by the HTTP/URL spec.

## Setup

### 1. Install XcodeGen

```bash
brew install xcodegen
```

### 2. Generate the Xcode project

```bash
cd apps/ios
xcodegen generate
```

This produces `Graft.xcodeproj`. Re-run whenever `project.yml` or the file tree changes.

### 3. Open in Xcode

```bash
open Graft.xcodeproj
```

Select the **Graft** scheme and an iOS 26+ simulator to build and run.

## Build from the command line

```bash
cd apps/ios

# Build for iOS 26.5 simulator
xcodebuild -project Graft.xcodeproj -scheme Graft \
  -destination 'platform=iOS Simulator,name=iPhone 17 Pro,OS=26.5' \
  -quiet build

# Run tests
xcodebuild test -project Graft.xcodeproj -scheme Graft \
  -destination 'platform=iOS Simulator,name=iPhone 17 Pro,OS=26.5' \
  -quiet
```

If only the iOS 27 simulator is available:

```bash
-destination 'platform=iOS Simulator,name=iPhone 17 Pro,OS=27.0'
```

## Project structure

```
apps/ios/
  project.yml                          # XcodeGen spec (source of truth)
  Graft.xcodeproj                      # Generated — do not edit manually
  Graft/
    GraftApp.swift                     # @main entry point
    App/
      AppDelegate.swift                # APNs registration callbacks
      RootView.swift                   # Scene root; drives scenePhase hooks
    Core/
      Keychain.swift                   # Generic-password Keychain wrapper
      AppLog.swift                     # os.Logger categories
      GraftError.swift                 # Domain error enum
    Models/
      ProtocolModels.swift             # Codable types for mobile-v1 protocol
    Networking/
      GatewayClient.swift              # WebSocket client + reconnect loop
      RESTClient.swift                 # HTTP client (health, pair, push registration)
      ConnectionProbe.swift            # One-shot reachability check
      ReconnectPolicy.swift            # Exponential backoff + jitter
    Persistence/
      SchemaV1.swift                   # SwiftData model definitions
      LocalStore.swift                 # SwiftData facade
    Push/
      PushRegistrar.swift              # Default-off APNs registration scaffold
    Stores/
      AppModel.swift                   # Root @Observable model
      ConnectionStore.swift            # Session / bearer-token lifecycle
    Views/
      Onboarding/
        WelcomeView.swift              # First-run screen
        PairingView.swift              # Paste / QR pairing flow
        QRScannerView.swift             # VisionKit QR scanner bridge
      Home/
        HomeView.swift                 # Main screen (threads, runs, approvals)
    Resources/
      graft-app-icon.icon              # Icon Composer app icon (iOS home screen)
      Assets.xcassets                  # Raster AppIcon fallback + accent colour
      Info.plist                       # Bundle metadata + URL scheme
  GraftTests/
    KeychainTests.swift
    PairingURLTests.swift
    ProtocolFixtureTests.swift
    ReconnectPolicyTests.swift
    Fixtures/
      mobile-v1/                       # Copied from packages/mobile-contract/protocol-fixtures/
        *.json
  README.md
```

## Architecture overview

### `AppModel` (root observable)

The single `AppModel` instance is created in `GraftApp` and injected as an `@Observable` environment object. It owns:

- `ConnectionStore` — session lifecycle and bearer-token persistence
- `GatewayClient` — WebSocket connection and reconnect loop
- `LocalStore` — SwiftData container

`RootView.onChange(of: scenePhase)` calls `appModel.scenePhaseChanged(_:)`:

- `.active` → `gateway.nudge()` (ping-verifies or re-dials)
- `.background` → `gateway.suspendForBackground()` (tears down socket)

### `ConnectionStore`

Persists the paired session in SwiftData and the bearer token in Keychain. The Keychain account key is `bearerToken:<environmentId>`, stored in the `PersistedSession.keychainAccount` field (never in the SwiftData store itself).

### `GatewayClient`

`URLSessionWebSocketTask`-based WebSocket client with:

- Exponential backoff reconnect (via `ReconnectPolicy`)
- `NWPathMonitor` to dial immediately when the network recovers
- Foreground ping every 25s to detect silently-dead connections
- `nudge()` for fast-path liveness checks on foreground/network events

### Protocol

See `Graft/Models/ProtocolModels.swift` for the full Codable type hierarchy.

Pairing flow:

1. User pastes `graft://pair?v=1&host=…#token=…` or raw JSON
2. `ConnectionStore.pair(with:)` posts `PairRequest` to `POST /v1/pair` on the host
3. `PairSession` response is stored in SwiftData; bearer token in Keychain
4. `GatewayClient` connects via WebSocket; `HostWelcome` signals readiness

## Protocol fixtures

`GraftTests/Fixtures/mobile-v1/` contains a copy of `packages/mobile-contract/protocol-fixtures/mobile-v1/valid/`.

Check fixture parity from the repository root:

```bash
bun run check:ios-fixtures
```

After intentionally changing shared fixtures, refresh the byte-for-byte iOS
copy with `bun run sync:ios-fixtures`. CI runs the check and reports missing,
extra, and changed JSON fixtures.

## APNs registration scaffold

Push registration is deliberately disabled by
`GRAFT_APNS_REGISTRATION_ENABLED = false` in `project.yml`. When the iOS flag is
enabled, the paired app can request notification authorization and register or
remove its APNs token through `/v1/push-registration`. The Synara compatibility
adapter currently keeps this registration only in server memory.

This is registration scaffolding only: the project has no `aps-environment`
entitlement, APNs provider credentials, or notification-delivery code. Do not
enable it for a device build until signing and entitlement configuration is
defined.

## TODOs / known gaps

- **Push delivery** — token registration is scaffolded, but the host does not send notifications yet
- **Code signing** — `DEVELOPMENT_TEAM` is empty in `project.yml`; set your team ID before running on a device
- **Deep-link handling from terminated state** — the `onOpenURL` modifier covers foreground/background; test cold-launch URL handling separately
