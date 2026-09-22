import Foundation

/// Lightweight user preferences for the chat surface, persisted in
/// `UserDefaults`. Mirrors the slice of the Hermes settings model the ported
/// chat views read.
@MainActor
@Observable
final class ChatSettings {
    private enum Key {
        static let showReasoning = "chat.showReasoning"
        static let streamingHaptics = "chat.streamingHaptics"
    }

    var showReasoning: Bool {
        didSet { UserDefaults.standard.set(showReasoning, forKey: Key.showReasoning) }
    }

    var streamingHaptics: Bool {
        didSet { UserDefaults.standard.set(streamingHaptics, forKey: Key.streamingHaptics) }
    }

    /// Server-side transcription needs a host speech endpoint the Graft
    /// protocol doesn't expose yet; voice input runs on-device.
    let useServerTranscription = false

    init() {
        let defaults = UserDefaults.standard
        showReasoning = defaults.object(forKey: Key.showReasoning) as? Bool ?? true
        streamingHaptics = defaults.object(forKey: Key.streamingHaptics) as? Bool ?? true
    }
}
