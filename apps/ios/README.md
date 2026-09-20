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

On iPad (regular horizontal size class), Projects is a **floating Liquid Glass
panel**, inset 16pt from the safe-area edges with 28pt continuous corners. It
uses SwiftUI's `.glassEffect(.regular, in:)` on a background shape above the
full-bleed chat canvas. Leading safe-area padding reserves the panel's width
without painting a separate sidebar gutter; the glass supplies its own depth without
an additional shadow. This is a floating panel, not another edge-to-edge
`NavigationSplitView` material tweak; its geometry stays floating on iPadOS 26
and 27. The system glass material retains its accessibility adaptations.

The Projects / host-status header is a fixed foreground view above the clipped
scroll region. It has no navigation title or principal toolbar duplication,
and the chat stack no longer applies `backgroundExtensionEffect()` to text.

- **Regular windows**: chat always reserves the visible panel's width plus
  its margins, in portrait and landscape. The navigation stack fills the whole
  canvas. Leading safe-area padding centers the readable transcript and composer
  beside Projects; `ChatNavigationTitle` gives the principal title matching
  leading space because navigation bars center independently of content safe
  areas. Never add a background fill or spacer column behind the panel.
  The transcript, composer, and new/empty chat surfaces use the parent
  pane's proposed width, capped at 720pt, rather than container-relative window
  sizing. Selecting a thread or New Chat keeps Projects open. Use **Hide
  Projects** to reclaim the full chat width and
  **Show Projects** in the chat toolbar to restore the panel. There is no pin
  toggle or overlay mode; resizing preserves the chosen visibility.
- **Compact** (iPhone, iPad Slide Over): existing drawer + push stack.

### Simulator verification (portrait and landscape)

Use the **Graft** scheme. Pair first if the welcome screen is showing.

| Destination                   | Orientation | Expect                                                                                                  |
| ----------------------------- | ----------- | ------------------------------------------------------------------------------------------------------- |
| iPad Pro 13-inch              | Landscape   | Inset rounded glass Projects panel, crisp Projects / Mac header, chat beside it.                        |
| iPad Pro 13-inch              | Portrait    | Floating panel stays beside chat. Both the screen margin and rounded top/bottom corners remain visible. |
| iPad Pro 11-inch or iPad mini | Landscape   | Same floating panel and readable chat beside it.                                                        |
| iPad Pro 11-inch or iPad mini | Portrait    | Panel reserves chat space and stays open after selection. Hide / Show Projects changes visibility.      |
| iPhone                        | Portrait    | Hamburger drawer and push navigation unchanged.                                                         |

Check Hide / Show Projects, thread selection, New Chat, search,
Settings, and rotation. Scroll the projects while watching the fixed header:
rows must stay below it and the title must remain sharp. Opening and closing
the panel must preserve the active chat and any composer draft. With Reduce
Motion enabled, panel transitions fade without sliding or resizing animation.

`AdaptiveChromeTests` covers size-class routing, panel margins and width,
reserved chat space at all iPad widths, hide/show behavior, rendered panel/chat
separation, a chat background spanning behind the panel, and
title/transcript/composer centering within the remaining pane.
It also verifies that a narrower parent proposal wins over a wider navigation
ancestor, including compact widths, so content cannot overflow the chat pane.
Visual verification still requires the simulator; policy tests do not prove
material rendering or header sharpness.

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

# iPad (floating sidebar)
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
      AdaptiveChrome.swift             # Floating sidebar vs compact drawer policy
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
        HomeView.swift                 # Adaptive home: compact drawer, floating iPad panel
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
- `NWPathMonitor` to replace the old socket when switching Wi-Fi/cellular routes,
  pause retries offline, and dial immediately when a network returns
- A 15-second deadline for the hello/welcome handshake
- Foreground application ping every 25s, with a matching host pong required within
  10s; this checks the entire relay-to-Studio path
- `nudge()` for bounded liveness checks on foreground events
- Connection generations to ignore late handshakes and frames from a replaced socket
- Background teardown releases connection waiters and cancels all recovery timers

Cellular access requires a relay, reachable HTTPS host, or connected tailnet. A
phone paired to a LAN-only address must pair again using Studio's connected relay
address; reconnecting cannot make a private Wi-Fi address reachable over cellular.

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
