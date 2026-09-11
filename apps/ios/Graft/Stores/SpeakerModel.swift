import AVFoundation
import Foundation

/// Plays agent replies aloud via `POST /api/audio/speak`, which uses the TTS
/// provider configured on the host (ElevenLabs, Edge, OpenAI, ...).
@MainActor
@Observable
final class SpeakerModel: NSObject, AVAudioPlayerDelegate {
    private(set) var isSpeaking = false
    private(set) var isFetching = false
    private(set) var speakingItemID: UUID?

    /// Fired when playback ends on its OWN — natural completion of the last
    /// chunk, or a synthesis/playback failure that ends the pipeline. It is NOT
    /// fired by an external `stop()` (barge-in / Live Mode end), so a caller can
    /// use this to "listen again" without a spurious trigger when it was the one
    /// that stopped playback.
    var onPlaybackFinished: (() -> Void)?

    private var player: AVAudioPlayer?
    private var synth: (any TTSSynthesizer)?
    private var plan: [String] = []
    private var states: [ChunkState] = []
    private var fetchTasks: [Int: Task<Void, Never>] = [:]
    private var playIndex = 0
    // Bumped on every speak()/stop() so a chunk fetch that resolves after the
    // user moved on (or pressed stop) detects it's stale and bails.
    private var generation = 0

    private enum ChunkState {
        case pending
        case ready(Data)
        case failed
    }

    // MARK: Public API

    /// Begin reading `text` aloud. Returns immediately; the reply is split into
    /// chunks (first chunk = one sentence) fetched in a cancellable pipeline, so
    /// the first audio starts after ~one sentence and `stop()` interrupts
    /// instantly. Every chunk goes through the same `/api/audio/speak`, so the
    /// configured provider/voice is unchanged.
    func speak(text: String, itemID: UUID? = nil, rest: (any TTSSynthesizer)?) {
        guard let rest else { return }
        stop()
        let chunks = Self.chunks(from: Self.plainText(from: text))
        guard !chunks.isEmpty else { return }
        generation += 1
        synth = rest
        speakingItemID = itemID
        isFetching = true
        plan = chunks
        states = Array(repeating: .pending, count: chunks.count)
        playIndex = 0
        startFetch(0)
    }

    /// Append more text to the speech pipeline WITHOUT cancelling what is
    /// already fetching/playing. If the pipeline is idle this behaves like
    /// `speak`. Live Mode streams a reply sentence-by-sentence through this, so
    /// audio starts on the first sentence and later sentences join the same
    /// pipeline seamlessly.
    func enqueue(text: String, itemID: UUID? = nil, rest: (any TTSSynthesizer)?) {
        guard let rest else { return }
        if plan.isEmpty {
            speak(text: text, itemID: itemID, rest: rest)
            return
        }
        let newChunks = Self.chunks(from: Self.plainText(from: text))
        guard !newChunks.isEmpty else { return }
        synth = rest
        plan.append(contentsOf: newChunks)
        states.append(contentsOf: Array(repeating: ChunkState.pending, count: newChunks.count))
        if player == nil {
            // Pipeline was waiting on (or had just failed past) the current
            // chunk; nudge it so the appended text fetches and plays.
            playCurrent()
        } else {
            // Keep the one-chunk-ahead prefetch going now that more exists.
            startFetch(playIndex + 1)
        }
    }

    func stop() {
        let wasActive = player != nil || isSpeaking || isFetching || !fetchTasks.isEmpty
        generation += 1
        for task in fetchTasks.values { task.cancel() }
        fetchTasks.removeAll()
        states.removeAll()
        plan.removeAll()
        playIndex = 0
        synth = nil
        player?.stop()
        player = nil
        isSpeaking = false
        isFetching = false
        speakingItemID = nil
        if wasActive { Self.deactivateAudioSession() }
    }

    // MARK: Pipeline

    private func startFetch(_ i: Int) {
        guard i >= 0, i < plan.count, fetchTasks[i] == nil, let synth else { return }
        guard case .pending = states[i] else { return }
        let gen = generation
        let text = plan[i]
        fetchTasks[i] = Task { @MainActor [weak self, synth] in
            let data = try? await synth.speak(text: text)
            self?.fetchCompleted(i, gen: gen, data: data)
        }
    }

    private func fetchCompleted(_ i: Int, gen: Int, data: Data?) {
        guard gen == generation, i < states.count else { return }   // stale -> discard
        fetchTasks[i] = nil
        states[i] = data.map { ChunkState.ready($0) } ?? .failed
        if i == playIndex, player == nil {
            playCurrent()
        }
    }

    private func playCurrent() {
        guard playIndex < plan.count else { stop(); return }
        switch states[playIndex] {
        case .ready(let data):
            // Generation guards the resumption against a stop()/speak() that
            // lands while the audio session is activating.
            let gen = generation
            Task { @MainActor [weak self] in
                await Self.activateAudioSession()
                guard let self, gen == self.generation, self.player == nil else { return }
                do {
                    let p = try AVAudioPlayer(data: data)
                    p.delegate = self
                    self.player = p
                    self.isSpeaking = true
                    self.isFetching = false
                    p.play()
                    // Keep one chunk ahead without overlapping synthesis requests.
                    // Some server TTS backends are not safe under concurrent
                    // /api/audio/speak calls and can fail the second request, which
                    // ends playback after the first short chunk.
                    self.startFetch(self.playIndex + 1)
                } catch {
                    self.finishNaturally()
                }
            }
        case .failed:
            finishNaturally()
        case .pending:
            isFetching = true               // buffering until this chunk lands
            startFetch(playIndex)
        }
    }

    private func advance() {
        playIndex += 1
        if playIndex < plan.count {
            // More chunks to go: drop the finished player (so a still-pending next
            // chunk re-triggers playCurrent when it lands) and continue.
            player = nil
            isSpeaking = false
            playCurrent()
        } else {
            // Natural completion: leave player/isSpeaking set so stop() still sees
            // the session as active and deactivates it. Clearing them here first
            // made stop() compute wasActive == false and leak the audio session.
            finishNaturally()
        }
    }

    /// End playback that concluded on its own (natural completion or a chunk
    /// failure) and notify `onPlaybackFinished`. Kept distinct from `stop()` so
    /// an EXTERNAL stop (barge-in / Live Mode end) never fires the "finished"
    /// signal and can't trigger a spurious listen-again.
    private func finishNaturally() {
        stop()
        onPlaybackFinished?()
    }

    // MARK: AVAudioPlayerDelegate

    nonisolated func audioPlayerDidFinishPlaying(_ player: AVAudioPlayer, successfully flag: Bool) {
        Task { @MainActor [weak self] in
            guard let self, player === self.player else { return }   // ignore stale finishes
            self.advance()
        }
    }

    private nonisolated static func activateAudioSession() async {
        try? await GraftAudioSession.activateForPlayback()
    }

    private nonisolated static func deactivateAudioSession() {
        Task {
            try? await GraftAudioSession.deactivate()
        }
    }

    // MARK: Text chunking

    private static let targetChunkChars = 320
    private static let maxChunkChars = 600

    /// Split already-plain text into ordered TTS chunks. The first chunk is a
    /// single sentence (so audio starts fast); later sentences are grouped up to
    /// ~targetChunkChars. Sentences longer than maxChunkChars are split at
    /// whitespace.
    static func chunks(from text: String) -> [String] {
        var sentences: [String] = []
        text.enumerateSubstrings(in: text.startIndex..<text.endIndex,
                                 options: [.bySentences, .localized]) { sub, _, _, _ in
            if let s = sub?.trimmingCharacters(in: .whitespacesAndNewlines), !s.isEmpty {
                sentences.append(s)
            }
        }
        if sentences.isEmpty {
            let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
            guard !trimmed.isEmpty else { return [] }
            sentences = [trimmed]
        }

        var units: [String] = []
        for sentence in sentences {
            units.append(contentsOf: splitLong(sentence, max: maxChunkChars))
        }

        var result: [String] = []
        var buffer = ""
        for (i, unit) in units.enumerated() {
            if i == 0 {
                result.append(unit)                  // first chunk = first sentence
            } else if buffer.isEmpty {
                buffer = unit
            } else if buffer.count + 1 + unit.count <= targetChunkChars {
                buffer += " " + unit
            } else {
                result.append(buffer)
                buffer = unit
            }
        }
        if !buffer.isEmpty { result.append(buffer) }
        return result
    }

    /// Break a too-long sentence at the last whitespace before `max`.
    private static func splitLong(_ s: String, max: Int) -> [String] {
        guard s.count > max else { return [s] }
        var parts: [String] = []
        var remaining = Substring(s)
        while remaining.count > max {
            let cap = remaining.index(remaining.startIndex, offsetBy: max)
            let window = remaining[remaining.startIndex..<cap]
            if let ws = window.lastIndex(where: { $0 == " " || $0 == "\n" }) {
                let head = remaining[remaining.startIndex..<ws]
                    .trimmingCharacters(in: .whitespacesAndNewlines)
                if !head.isEmpty { parts.append(head) }
                remaining = remaining[remaining.index(after: ws)...]
            } else {
                parts.append(String(window))
                remaining = remaining[cap...]
            }
        }
        let tail = remaining.trimmingCharacters(in: .whitespacesAndNewlines)
        if !tail.isEmpty { parts.append(tail) }
        return parts
    }

    /// Strip markdown structure so TTS doesn't read syntax aloud.
    static func plainText(from markdown: String) -> String {
        var lines: [String] = []
        var inFence = false
        for rawLine in markdown.components(separatedBy: "\n") {
            let line = rawLine.trimmingCharacters(in: .whitespaces)
            if line.hasPrefix("```") {
                inFence.toggle()
                if inFence { lines.append("(code omitted)") }
                continue
            }
            if inFence { continue }
            var cleaned = rawLine
            for token in ["**", "__", "##### ", "#### ", "### ", "## ", "# ", "`"] {
                cleaned = cleaned.replacingOccurrences(of: token, with: "")
            }
            lines.append(cleaned)
        }
        return lines.joined(separator: "\n")
    }
}
