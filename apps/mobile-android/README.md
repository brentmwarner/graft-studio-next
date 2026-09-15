# Graft Android

Android-only Expo client for the Graft Studio remote gateway.

The iOS client remains native SwiftUI. This project shares Graft's versioned
mobile protocol, not UI code, with the rest of the monorepo.

## Current scope

- Parse Graft pairing links and pasted pairing JSON through `@graft/mobile-contract`
- Scan pairing QR codes with the Android camera
- Exchange a one-time token with the desktop gateway
- Persist the bearer token in SecureStore and non-secret metadata in SQLite
- Restore paired sessions and reconnect as the app moves between foreground and background
- Browse the same project and thread hierarchy as the iOS client
- Create threads and send, stream, or cancel turns through the authenticated gateway socket
- Render assistant Markdown, reasoning, tool activity, questions, and approval requests
- Select the thread model, reasoning effort, and approval policy offered by the host
- Keep established chats on their provider while allowing model changes
- Dictate a message with native Android speech recognition, then review or send the transcript
- Show working-tree diff counts and changed files above the composer
- Follow the iOS visual language with Android-native motion, floating surfaces, and edge fades

## Development

From the repository root:

```bash
bun run dev:android
```

Use the development client for normal device and emulator work:

```bash
bun run --cwd apps/mobile-android start:dev-client
bun run --cwd apps/mobile-android android:native
```

Dictation uses `expo-speech-recognition`. Rebuild the native app after pulling
this dependency; a Metro reload alone cannot add it to an existing APK. The first
microphone tap requests permission. Android also needs an enabled speech recognition service
(for example, Google's speech service). Permission and recognition failures are
shown above the composer. The recording capsule matches iOS: a live microphone
waveform, Stop and review, and Send dictation, with Cancel outside the capsule.
Stopping keeps the text for editing; sending waits for the final transcript;
cancelling restores the draft from before recording.

The composer follows the iOS layout: one compact surface at rest, expanding on
focus into a three-line editor with an internal toolbar. Longer drafts grow up to
a scrolling limit. Plus, permissions, model/effort, microphone, and send stay
inside the card; an empty composer collapses when the keyboard is dismissed.

## Verification

```bash
bun run android:test
bun run android:typecheck
bun run android:doctor
```

Push notifications, account sign-in, and full diff
review are not implemented yet.

The Synara-based host exposes enabled providers and live-discovered models
through the same `models.list` command used by the legacy host. Selecting a
provider requires its CLI to be installed and authenticated on the host.

Direct LAN and tailnet endpoints may use HTTP. Debug builds permit it through
their manifest overlay, and the standalone `preview` profile enables it for
device testing. Production builds retain the HTTPS-only policy.

### Android preview after merge

Build the merged commit from `apps/mobile-android` with
`bunx eas-cli@latest build --platform android --profile preview`.
The profile creates an internal release APK that runs without Metro and uses
the existing `brentmwarner/graft-mobile-android` EAS project. Sign in with
`bunx eas-cli@latest login` if this machine is not authenticated. Native speech
and attachment dependencies require a new APK, rather than an OTA update.

### Composer attachments and modes

The plus menu supports Files, Photos, Camera, Default/Plan/Debug mode, and Fast
speed when supported by the selected model. New and existing chats share these
controls. Files appear inside the composer above the editor and can be removed before sending;
attachment-only messages are supported. Limits match desktop: 8 attachments,
10 MB per image, and 25 MB per file.

Install this host update along with a rebuilt Android app. Older hosts show an
update message in the menu. Uploads use the desktop binary attachment endpoint
with the paired session's credentials; the mobile turn claims those attachments
under that same session. Failed sends keep the draft and local files for retry.
