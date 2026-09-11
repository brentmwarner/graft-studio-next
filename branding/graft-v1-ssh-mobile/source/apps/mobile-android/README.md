# Graft Android

Android-only Expo client for the Graft Studio remote gateway.

The iOS client remains native SwiftUI. This project shares Graft's versioned
mobile protocol, not UI code, with the rest of the monorepo.

## Current scope

- Parse Graft pairing links and pasted pairing JSON through `@graft/shared`
- Scan pairing QR codes with the Android camera
- Exchange a one-time token with the desktop gateway
- Persist the bearer token in SecureStore and non-secret metadata in SQLite
- Restore paired sessions and reconnect as the app moves between foreground and background
- Browse the same project and thread hierarchy as the iOS client
- Create threads and send, stream, or cancel turns through the authenticated gateway socket
- Render assistant Markdown, reasoning, tool activity, questions, and approval requests
- Select the thread model, reasoning effort, and approval policy offered by the host
- Show working-tree diff counts and changed files above the composer
- Follow the iOS visual language with Android-native motion, floating surfaces, and edge fades

## Development

From the repository root:

```bash
pnpm dev:android
```

Use the development client for normal device and emulator work:

```bash
pnpm --filter @graft/mobile-android start:dev-client
pnpm --filter @graft/mobile-android android:native
```

## Verification

```bash
pnpm android:test
pnpm android:typecheck
pnpm android:doctor
```

Push notifications, account sign-in, attachment transport, and full diff
review are not implemented yet.

Direct LAN and tailnet endpoints may use HTTP, so Android development builds
currently permit cleartext traffic. Pairing tokens are one-time credentials and
bearer tokens are never written to SQLite, but this setting should be narrowed
or replaced with HTTPS before a public Play release.
