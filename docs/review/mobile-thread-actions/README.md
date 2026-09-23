# Mobile thread actions — native capture

Captured September 23, 2026 on the existing Android emulator at 1080 × 2400,
using the isolated `studio.graft.mobile.chatcontrols` development client.
Metro loaded the edited `HomeScreen`, `ThreadActions`, `BottomSheet`, and
`EdgeFade` components directly from this checkout.

## Recordings

- [Swipe, long press, rename with the keyboard open, and archive](android-actions.mp4)
- [Controlled title update and scrolling under the unified header](android-title-and-header.mp4)

## Screenshots

- [Updated swipe actions including Delete](android-swipe-delete.png)
- [Confirmation after tapping swipe Delete](android-swipe-delete-confirmation.png)
- [Swipe actions](android-swipe-actions.png)
- [Long-press menu](android-long-press.png)
- [Rename above the keyboard](android-rename-keyboard.png)
- [Renamed chat](android-renamed.png)
- [After archive](android-archived.png)
- [Header while scrolled](android-header-scrolled.png)
- [Title placeholder](android-title-placeholder.png) → [Updated title](android-title-updated.png)

## Evidence scope

These are native emulator captures with sample data, not design mockups.
The [capture fixture](capture-fixture.tsx.txt) supplies an in-memory snapshot and
mutation callbacks to the production inbox components. Rename and archive affect
only that sample snapshot. The title demonstration inserts `New chat`, then applies
the shared prompt-title fallback after 1.8 seconds. It verifies visible title
replacement; it does not show a live provider generating a title or a paired host
processing commands. Host title generation and durable commands are covered by the
271 passing affected host tests recorded in the implementation verification.

The capture found that the keyboard covered the Rename sheet. The final recordings
include the fix: opt-in keyboard avoidance on `BottomSheet`, enabled by Rename.
The follow-up adds Delete to the swipe row on both platforms. The two updated
screenshots show the Android action and confirmation; the earlier recordings
predate that addition. All 291 Android tests pass after this change.
Swipe reveal, long press, typing and saving a title, and archiving were
exercised through ADB touch input and checked against screenshots and the
accessibility hierarchy.

iOS screenshots and recordings remain pending. The current Linux host cannot run
Xcode (`xcrun ENOENT`), and no working remote Mac connection is configured.
Older iOS recordings do not demonstrate these changes and are not reused here.

## PR integration

The PR is based on main after the native progressive-blur change (#71/#74).
It preserves that implementation and extends the shared header backdrop over the
machine filters. These captures predate that integration and show the earlier
gradient backdrop; they are evidence for the actions, not a native-blur visual check.
