import SwiftUI

/// Short, independent fades for appended graphemes. Existing text never restarts
/// its fade when another provider chunk arrives.
struct StreamingTextFade {
    static let duration: TimeInterval = 0.1

    struct Arrival: Equatable {
        let range: Range<Int>
        let time: TimeInterval
    }

    private(set) var text: String
    private(set) var arrivals: [Arrival] = []

    mutating func receive(_ newText: String, at time: TimeInterval, enabled: Bool) {
        defer { text = newText }
        guard enabled, newText.hasPrefix(text) else {
            arrivals.removeAll()
            return
        }
        arrivals.removeAll { time - $0.time >= Self.duration }
        guard newText != text else { return }
        arrivals.append(Arrival(range: text.count..<newText.count, time: time))
    }

    mutating func settle() {
        arrivals.removeAll()
    }
}

/// Keeps native selection, links, and line wrapping; only drawing opacity changes.
struct StreamingInlineText: View {
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @Environment(\.accessibilityVoiceOverEnabled) private var voiceOver
    @Environment(\.scenePhase) private var scenePhase

    let attributed: AttributedString
    let isStreaming: Bool
    let skillIconSize: CGFloat
    @State private var displayed: AttributedString
    @State private var fade: StreamingTextFade

    init(attributed: AttributedString, isStreaming: Bool, skillIconSize: CGFloat) {
        self.attributed = attributed
        self.isStreaming = isStreaming
        self.skillIconSize = skillIconSize
        _displayed = State(initialValue: attributed)
        _fade = State(initialValue: StreamingTextFade(text: String(attributed.characters)))
    }

    private var enabled: Bool {
        isStreaming && !reduceMotion && !voiceOver && scenePhase == .active
    }

    var body: some View {
        // Markdown parsing stays outside the timeline. Native text styling also
        // works with selection enabled, which bypasses TextRenderer on iOS.
        TimelineView(.animation(paused: !enabled || fade.arrivals.isEmpty)) { context in
            InlineText.renderedText(enabled ? displayed : attributed, skillIconSize: skillIconSize,
                arrivals: enabled ? fade.arrivals : [], time: context.date.timeIntervalSinceReferenceDate)
        }
        .onChange(of: attributed) { _, value in
            fade.receive(String(value.characters), at: Date.timeIntervalSinceReferenceDate, enabled: enabled)
            displayed = value
        }
        .onChange(of: enabled) { _, _ in
            fade = StreamingTextFade(text: String(attributed.characters))
            displayed = attributed
        }
        .task(id: fade.arrivals.last?.time) {
            guard !fade.arrivals.isEmpty else { return }
            do { try await Task.sleep(for: .seconds(StreamingTextFade.duration)) }
            catch { return }
            guard !Task.isCancelled else { return }
            fade.settle()
        }
        .onDisappear { fade.settle() }
    }

}

/// A few quiet taps per turn, driven by real appended text rather than a timer.
struct StreamingHapticCadence {
    private var pendingCharacters = 0
    private var lastPulse: TimeInterval?
    private var pulseCount = 0

    mutating func receive(from oldText: String, to newText: String, at time: TimeInterval, enabled: Bool) -> Bool {
        guard enabled, newText.hasPrefix(oldText), newText != oldText else {
            pendingCharacters = 0
            return false
        }
        pendingCharacters += newText.count - oldText.count
        guard pulseCount < 3, pendingCharacters >= 48,
              lastPulse.map({ time - $0 >= 1.5 }) ?? true else { return false }
        pendingCharacters = 0
        lastPulse = time
        pulseCount += 1
        return true
    }
}

struct StreamingFeedback: ViewModifier {
    @Environment(\.scenePhase) private var scenePhase
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @Environment(\.accessibilityVoiceOverEnabled) private var voiceOver
    let chat: ChatModel
    let isFollowing: Bool
    @State private var cadence = StreamingHapticCadence()
    @State private var feedbackTick = 0

    private var enabled: Bool {
        isFollowing && scenePhase == .active && !reduceMotion && !voiceOver
            && chat.app?.settings.streamingHaptics == true
            && chat.app?.gateway.state == .connected && !chat.needsInteraction
            && chat.isStreaming && !chat.isLoadingHistory && chat.items.last?.kind == .assistant
            && chat.items.last?.isStreaming == true
    }

    func body(content: Content) -> some View {
        content
            .sensoryFeedback(.impact(flexibility: .soft, intensity: 0.35), trigger: feedbackTick)
            .sensoryFeedback(.success, trigger: chat.responseCompletionTick) { _, _ in
                scenePhase == .active && chat.app?.settings.streamingHaptics == true
                    && chat.app?.gateway.state == .connected && !chat.isLoadingHistory
            }
            .onChange(of: chat.items.last?.text ?? "") { oldText, newText in
                if cadence.receive(from: oldText, to: newText, at: Date.timeIntervalSinceReferenceDate, enabled: enabled) {
                    feedbackTick += 1
                }
            }
            .onChange(of: chat.isStreaming) { _, _ in cadence = StreamingHapticCadence() }
    }
}
