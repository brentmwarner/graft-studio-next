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
- Use the AICSS Helix G4 orb as the live-status thinking indicator
- Fold settled-turn tools and commentary above the final answer, matching iOS
- Hide unfinished Markdown link destinations while a reply is still streaming
- Show the official Graft mark on splash and pairing, then Pair with Studio
- Select the thread model, reasoning effort, and approval policy offered by the host
- Keep established chats on their provider while allowing model changes
- Dictate a message with native Android speech recognition, then review or send the transcript
- Show working-tree diff counts and changed files above the composer
- Load individual file hunks on expansion, with retry for failed reads
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

The composer has a persistent settings row for provider/model, supported effort,
and permissions. These controls stay available before typing and after the
keyboard closes. The input surface expands on focus into a three-line editor
with an internal plus menu, microphone, and send controls. Longer drafts grow up
to a scrolling limit; an empty editor collapses when the keyboard is dismissed.
Model discovery is shared across composers, with loading, retry, and refresh
states. Effort choices follow the selected model's advertised capabilities.

## Verification

```bash
bun run android:test
bun run android:typecheck
bun run android:doctor
```

Push notifications and account sign-in are not implemented yet.

The Graft-based host exposes enabled providers and live-discovered models
through the same `models.list` command used by the legacy host. Selecting a
provider requires its CLI to be installed and authenticated on the host.

Direct LAN and tailnet endpoints may use HTTP. Debug builds permit it through
their manifest overlay, and the standalone `preview` profile enables it for
device testing. Production builds retain the HTTPS-only policy.

### Android preview

Check out the PR branch (or the merged commit), then build from `apps/mobile-android` with
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

Local file, photo, and camera picking is available even before the host advertises
attachment support. Sending selected files requires a compatible, connected host;
the composer explains when that support is missing and keeps the files for retry.
Install the host update along with a rebuilt Android app. Uploads use the desktop binary attachment endpoint
with the paired session's credentials; the mobile turn claims those attachments
under that same session. Failed sends keep the draft and local files for retry.

### Preview validation for Android mobile parity

The changes are on `codex/android-mobile-parity`. Unit tests cover catalog
discovery, composer menus, native picker responses, attachment sending, and diff
response matching. A rebuilt native preview still needs these device checks:

1. Open New chat with an empty editor. Switch providers and models, then select
   an effort. Verify the first turn uses those choices. Check the settings row
   with the keyboard open and closed, on a narrow screen and with larger text.
2. In an existing chat, verify model changes stay on its locked provider and
   `/model` opens the picker. Disconnect/reconnect and exercise catalog retry.
3. Use plus → Files, Photos, and Camera in both new and existing chats. Exercise
   permission denial, cancellation, attachment-only sending, removal, and retry
   after a failed send. Confirm an older host allows picking but blocks sending
   files with an explanation.
4. Open working changes and expand several files. Confirm actual added/deleted
   lines load; close/reopen and refresh during loading. Include untracked,
   renamed, deleted, binary, and oversized files where available.

Working-tree file details are live reads, so their timestamps may be newer than
the summary. Refresh updates the summary and clears cached details. Checkpoint
responses still require an exact revision match. The optional protocol source
field distinguishes these cases; PR 25 hosts without it remain supported.
The equivalent iOS matching fix and a Swift regression test are included, but
the iOS build and tests must run on macOS.
