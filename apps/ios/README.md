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

On iPad (regular horizontal size class), paired home uses `NavigationSplitView`
in **both** orientations:

- **Landscape** (and 13-inch portrait): pinned sidebar + chat. The Projects
  column uses the system Liquid Glass sidebar (no opaque `systemBackground`
  fill). Transcript and composer cap at a 720pt readable column instead of
  stretching edge to edge.
- **Mini / 11-inch portrait**: automatic overlay split so the sidebar can
  dismiss and chat keeps a usable width. Use the system sidebar control to
  show threads again.
- **Compact** (iPhone, iPad Slide Over): existing drawer + push stack.

### Simulator verification (portrait and landscape)

Use the **Graft** scheme. Pair first if the welcome screen is showing.

| Destination | Orientation | Expect |
| ----------- | ----------- | ------ |
| iPad Pro 13-inch (M4) | Landscape | Persistent Liquid Glass Projects sidebar + chat (translucent, not a flat white column). Composer/transcript stay a readable column, not full pane width. |
| iPad Pro 13-inch (M4) | Portrait | Still a two-column split (window is 1024pt). Chat remains usable beside the sidebar. Rotate back to landscape; sidebar stays pinned. |
| iPad Pro 11-inch (M4) or iPad mini | Landscape | Same pinned sidebar + readable chat as 13-inch landscape. |
| iPad Pro 11-inch (M4) or iPad mini | Portrait | Sidebar overlays / can hide (`automatic`); chat is the primary column. Toggle the sidebar, open a thread, rotate to landscape and confirm both columns pin. |
| iPhone 17 Pro | Portrait | Hamburger drawer and push navigation unchanged. |

Hardware → Rotate in the simulator, or `⌘←` / `⌘→`. Confirm New Chat opens in the
detail column in both orientations, and Settings still presents as a sheet.

## Welcome visuals

The welcome screen uses the official vector `GraftMark` and a native two-pass
Metal rendering of the desktop new-chat scene in
`apps/web/src/assets/unicorn-scene{,-light}.json`. It preserves the scene's
black shape input, RGBA8 compositing, UV grid, nine circle glyphs, and animation
speed, with the vignette colors from `UnicornBackground.tsx` and `index.css`.
The glyph atlas is bundled as `Graft/Resources/DitherGlyphs.png` from the same
[Unicorn Studio asset](https://assets.unicorn.studio/media/glyphs/circles.png)
used by the desktop scene, so rendering works offline.

Reduce Motion displays a still frame and skips the entrance animation. The
Metal view pauses when the app is inactive; the content's intro timeline ends
after two seconds instead of invalidating buttons and text on every wave frame.

## QR camera scanning

The pairing scanner opens full screen and requests camera permission before
checking VisionKit availability. `QRScannerHostController` embeds the scanner
and starts scanning after its view appears. It pauses while the app is inactive
or the scanner is dismissed, and preserves the camera while showing invalid-code
feedback. Denied permission includes a link to Settings; scanner failures show
the paste-link fallback.

`QRScannerTests` cover permission ordering, presentation, pause/resume, dismissal,
startup failures, and duplicate-code handling. Camera preview verification needs
a physical iPhone: open the scanner, check the live image, close it, and reopen it.

## Local pairing connections

Studio advertises HTTP endpoints on LAN, tailnet, and loopback addresses. On
iOS 17+, [Apple requires explicit IP exceptions](https://developer.apple.com/documentation/bundleresources/information-property-list/nsapptransportsecurity/nsallowslocalnetworking);
the generated Info.plist also declares explicit ATS exceptions for the private
IPv4, Tailscale IPv6, and loopback ranges Studio discovers. Public IP addresses
retain the default HTTPS requirement. These ranges are checked by
`scripts/ios-local-network-ats.node-test.mjs`.

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

# iPad (regular-width split)
xcodebuild -project Graft.xcodeproj -scheme Graft \
  -destination 'platform=iOS Simulator,name=iPad Pro 13-inch (M4),OS=26.5' \
  -quiet build
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
      RootView.swift                   # Scene root; Welcome vs Home, scenePhase hooks
      AdaptiveChrome.swift             # Regular-width split vs compact drawer policy
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
        QRScannerHostController.swift   # Camera presentation and lifecycle
      Home/
        HomeView.swift                 # Adaptive home: compact drawer, regular split + chat
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
remove its APNs token through `/v1/push-registration`. The Graft compatibility
adapter currently keeps this registration only in server memory.

This is registration scaffolding only: the project has no `aps-environment`
entitlement, APNs provider credentials, or notification-delivery code. Do not
enable it for a device build until signing and entitlement configuration is
defined.

## TODOs / known gaps

- **Push delivery** — token registration is scaffolded, but the host does not send notifications yet
- **Code signing** — `DEVELOPMENT_TEAM` is empty in `project.yml`; set your team ID before running on a device
- **Deep-link handling from terminated state** — the `onOpenURL` modifier covers foreground/background; test cold-launch URL handling separately
