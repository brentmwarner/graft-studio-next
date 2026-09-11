import AVFoundation
import CoreGraphics
import Foundation
import Speech

/// Microphone capture + transcription for the composer.
///
/// Two engines, chosen in Settings:
/// - On-device: Apple's `DictationTranscriber` streaming partials for instant feedback.
/// - Server: records an .m4a and posts it to `/api/audio/transcribe`, using
///   the host's STT chain when a transcription endpoint exists.
@MainActor
@Observable
final class VoiceModel {
    enum Phase: Equatable {
        case idle
        case recording
        case transcribing
        case denied
    }

    private(set) var phase: Phase = .idle
    private(set) var liveTranscript = ""
    private(set) var inputLevel: CGFloat = 0
    /// Rolling history of recent mic levels (newest last), driving the composer's
    /// scrolling recording waveform. Sampled on a fixed clock off `inputLevel`
    /// so it reflects the actual audio coming in, not a canned animation.
    private(set) var levelHistory: [CGFloat] = []
    private(set) var hasHeardSpeech = false
    private(set) var streamingTranscriptUnavailable = false
    private(set) var errorText: String?

    private var audioEngine: AVAudioEngine?
    private var recognitionRequest: SFSpeechAudioBufferRecognitionRequest?
    private var recognitionTask: SFSpeechRecognitionTask?
    private var recognitionFinishContinuation: CheckedContinuation<String, Never>?
    private var recognitionFallbackAccumulator: VoicePCMAccumulator?
    private var speechAnalyzer: SpeechAnalyzer?
    private var dictationTranscriber: DictationTranscriber?
    private var analyzerInputContinuation: AsyncStream<AnalyzerInput>.Continuation?
    private var analyzerTask: Task<Void, Never>?
    private var dictationResultsTask: Task<Void, Never>?
    /// Accumulates streaming dictation segments into one transcript. The
    /// transcriber emits results *per audio segment*, so a long utterance
    /// arrives as several finalized chunks that must be concatenated rather
    /// than overwritten (see ``DictationTranscriptAccumulator``).
    private var transcriptAccumulator = DictationTranscriptAccumulator()
    private var recorder: AVAudioRecorder?
    private var recordingURL: URL?
    private var usingServer = false
    private var silenceHandler: (@MainActor () -> Void)?
    private var silenceTask: Task<Void, Never>?
    private var meterTask: Task<Void, Never>?
    private var waveformTask: Task<Void, Never>?
    /// Bars in the scrolling waveform buffer. A high count packs the trace with
    /// many thin bars — the dense, fine-grained ChatGPT/Whisper dictation look —
    /// rather than a few chunky bars with gaps.
    private let waveformBarCount = 110
    /// One bar every ~33ms (~30fps). Each bar captures the loudest audio slice
    /// in its window, so the trace is a true per-slice readout — the spiky,
    /// per-syllable look of ChatGPT/Whisper dictation — not a resampled loudness
    /// envelope.
    private let waveformInterval = Duration.milliseconds(33)
    /// Peak amplitude (0…1) seen since the last waveform bar. Audio callbacks
    /// fold their slice peak in with `max`; the visual clock drains it per bar.
    private var pendingWaveformPeak: CGFloat = 0
    /// Last emitted bar, so a frame that caught no callback (engine cadence
    /// briefly slower than the tick) eases down instead of punching a hole.
    private var lastWaveformSample: CGFloat = 0
    private var lastVoiceActivityAt = Date()
    private var recordingStartedAt = Date()
    private var heardSpeech = false

    /// How long the user must stay quiet after speaking before the silence
    /// handler fires (ends the turn). Live Mode tightens this for snappier
    /// turn-taking; the defaults preserve prior behavior for other captures.
    var silenceAfterSpeech: TimeInterval = 0.85
    /// How long to wait for ANY speech before firing the silence handler.
    var initialSilenceWindow: TimeInterval = 12

    var isRecording: Bool { phase == .recording }

    // MARK: Permissions

    private func requestPermissions(needsSpeech: Bool) async -> Bool {
        guard missingUsageDescriptions(needsSpeech: needsSpeech).isEmpty else { return false }
        let micGranted = await AVAudioApplication.requestRecordPermission()
        guard micGranted else { return false }
        guard needsSpeech else { return true }
        let speechStatus = await withCheckedContinuation { continuation in
            SFSpeechRecognizer.requestAuthorization { continuation.resume(returning: $0) }
        }
        return speechStatus == .authorized
    }

    // MARK: Control

    func start(
        useServer: Bool,
        silenceHandler: (@MainActor () -> Void)? = nil,
        partialTranscriptionRest: (any SpeechTranscriber)? = nil
    ) async {
        guard phase == .idle || phase == .denied else { return }
        errorText = nil
        liveTranscript = ""
        transcriptAccumulator.reset()
        inputLevel = 0
        levelHistory = []
        hasHeardSpeech = false
        streamingTranscriptUnavailable = false
        usingServer = useServer
        self.silenceHandler = silenceHandler
        lastVoiceActivityAt = Date()
        recordingStartedAt = Date()
        heardSpeech = false

        let missingDescriptions = missingUsageDescriptions(needsSpeech: !useServer)
        guard missingDescriptions.isEmpty else {
            phase = .denied
            errorText = "Missing privacy setting: \(missingDescriptions.joined(separator: ", "))."
            return
        }

        guard await requestPermissions(needsSpeech: !useServer) else {
            phase = .denied
            errorText = "Microphone or speech permission denied — enable it in iOS Settings."
            return
        }

        do {
            try await GraftAudioSession.activateForRecording(useServer: useServer)
            if useServer {
                try startRecorder()
            } else {
                do {
                    try await startRecognizer()
                } catch {
                    tearDownRecognizer(cancelTask: true)
                    removeRecognitionFallback()
                    if partialTranscriptionRest != nil {
                        streamingTranscriptUnavailable = true
                        usingServer = true
                        try await GraftAudioSession.activateForRecording(useServer: true)
                        try startRecorder()
                    } else {
                        throw error
                    }
                }
            }
            phase = .recording
            startSilenceMonitoringIfNeeded()
            startWaveformSampling()
        } catch {
            if useServer {
                recorder?.stop()
                recorder = nil
            } else {
                tearDownRecognizer(cancelTask: true)
                removeRecognitionFallback()
            }
            deactivateAudioSession()
            errorText = error.localizedDescription
            phase = .idle
            self.silenceHandler = nil
        }
    }

    /// Stops capture and returns the final transcript (empty on failure).
    func stop(rest: (any SpeechTranscriber)?) async -> String {
        guard phase == .recording else { return "" }
        if usingServer {
            return await stopRecorderAndTranscribe(rest: rest)
        }
        return await stopRecognizer(rest: rest)
    }

    func cancel() {
        stopMonitoring()
        if usingServer {
            recorder?.stop()
            recorder = nil
        } else {
            tearDownRecognizer(cancelTask: true)
            removeRecognitionFallback()
        }
        deactivateAudioSession()
        phase = .idle
        liveTranscript = ""
        transcriptAccumulator.reset()
        inputLevel = 0
        levelHistory = []
        hasHeardSpeech = false
        streamingTranscriptUnavailable = false
        silenceHandler = nil
    }

    // MARK: On-device recognition

    private func startRecognizer() async throws {
        let matchingLocale = await DictationTranscriber.supportedLocale(equivalentTo: Locale.autoupdatingCurrent)
        let englishLocale = await DictationTranscriber.supportedLocale(equivalentTo: Locale(identifier: "en-US"))
        let installedLocale = await DictationTranscriber.installedLocales.first
        let locale = matchingLocale ?? englishLocale ?? installedLocale ?? Locale(identifier: "en-US")
        let transcriber = DictationTranscriber(
            locale: locale,
            contentHints: [.shortForm, .farField],
            transcriptionOptions: [.punctuation],
            reportingOptions: [.volatileResults, .frequentFinalization],
            attributeOptions: []
        )
        let modules: [any SpeechModule] = [transcriber]
        try await installSpeechAssetsIfNeeded(for: modules)

        let engine = AVAudioEngine()
        audioEngine = engine
        let input = engine.inputNode
        let inputFormat = input.outputFormat(forBus: 0)
        try Self.validateTapFormat(inputFormat)
        let analysisFormat = await SpeechAnalyzer.bestAvailableAudioFormat(
            compatibleWith: modules,
            considering: inputFormat
        ) ?? inputFormat
        let analyzer = SpeechAnalyzer(modules: modules)
        try await analyzer.prepareToAnalyze(in: analysisFormat)

        var continuation: AsyncStream<AnalyzerInput>.Continuation?
        let inputStream = AsyncStream<AnalyzerInput>(bufferingPolicy: .bufferingNewest(24)) { streamContinuation in
            continuation = streamContinuation
        }
        guard let continuation else {
            throw NSError(domain: "Graft", code: 2, userInfo: [
                NSLocalizedDescriptionKey: "Could not start live speech input.",
            ])
        }

        speechAnalyzer = analyzer
        dictationTranscriber = transcriber
        analyzerInputContinuation = continuation
        dictationResultsTask = Task { [weak self, transcriber] in
            do {
                for try await result in transcriber.results {
                    // Each result covers a single audio *segment*: a volatile
                    // result is the in-progress tail of the current segment, a
                    // final result commits it. The full transcript is every
                    // committed segment plus the live tail — overwriting here
                    // (the old behavior) dropped all but the last segment, so a
                    // long spoken prompt collapsed to its final few words.
                    let segment = String(result.text.characters)
                    let isFinal = result.isFinal
                    await MainActor.run {
                        guard let self, self.phase == .recording || self.phase == .transcribing || self.recognitionFinishContinuation != nil else {
                            return
                        }
                        self.transcriptAccumulator.ingest(text: segment, isFinal: isFinal)
                        let full = self.transcriptAccumulator.transcript
                        if !full.isEmpty {
                            self.liveTranscript = full
                            self.stopRecognitionFallbackCapture()
                        }
                        if isFinal {
                            self.finishRecognition(text: full)
                        }
                    }
                }
            } catch {
                await MainActor.run {
                    self?.handleRecognitionError(error)
                }
            }
        }
        analyzerTask = Task { [weak self, analyzer] in
            do {
                try await analyzer.start(inputSequence: inputStream)
            } catch {
                await MainActor.run {
                    self?.handleRecognitionError(error)
                }
            }
        }

        let fallbackAccumulator = VoicePCMAccumulator(sampleRate: analysisFormat.sampleRate)
        recognitionFallbackAccumulator = fallbackAccumulator
        let analyzerConverter = VoiceAnalyzerBufferConverter(inputFormat: inputFormat, outputFormat: analysisFormat)
        try Self.installTap(on: input, format: inputFormat) { [weak self] buffer, _ in
            guard let analyzerBuffer = analyzerConverter.convert(buffer) else { return }
            continuation.yield(AnalyzerInput(buffer: analyzerBuffer))
            fallbackAccumulator.append(analyzerBuffer)
            let power = Self.averagePower(in: buffer)
            let peak = Self.peakLevel(in: buffer)
            Task { @MainActor in
                self?.handleAudioPower(power)
                self?.foldWaveformPeak(peak)
            }
        }
        engine.prepare()
        try engine.start()
    }

    private func installSpeechAssetsIfNeeded(for modules: [any SpeechModule]) async throws {
        let status = await AssetInventory.status(forModules: modules)
        switch status {
        case .installed:
            return
        case .unsupported:
            throw NSError(domain: "Graft", code: 3, userInfo: [
                NSLocalizedDescriptionKey: "Live speech recognition is unavailable for this language.",
            ])
        case .downloading, .supported:
            if let request = try await AssetInventory.assetInstallationRequest(supporting: modules) {
                try await request.downloadAndInstall()
            }
        @unknown default:
            break
        }
    }

    private func stopRecognizer(rest: (any SpeechTranscriber)?) async -> String {
        stopMonitoring()
        phase = .transcribing
        audioEngine?.stop()
        audioEngine?.inputNode.removeTap(onBus: 0)
        audioEngine = nil
        recognitionRequest?.endAudio()
        analyzerInputContinuation?.finish()
        analyzerInputContinuation = nil
        if let speechAnalyzer {
            try? await speechAnalyzer.finalizeAndFinishThroughEndOfInput()
        }

        let recognizedText = await waitForRecognitionText()
            .trimmingCharacters(in: .whitespacesAndNewlines)
        tearDownRecognizer(cancelTask: true)
        deactivateAudioSession()

        let fallbackText: String
        if recognizedText.isEmpty {
            fallbackText = await transcribeRecognitionFallback(rest: rest)
                .trimmingCharacters(in: .whitespacesAndNewlines)
        } else {
            removeRecognitionFallback()
            fallbackText = ""
        }

        phase = .idle
        liveTranscript = ""
        transcriptAccumulator.reset()
        inputLevel = 0
        levelHistory = []
        hasHeardSpeech = false
        streamingTranscriptUnavailable = false
        silenceHandler = nil
        return recognizedText.isEmpty ? fallbackText : recognizedText
    }

    private func tearDownRecognizer(cancelTask: Bool) {
        audioEngine?.stop()
        audioEngine?.inputNode.removeTap(onBus: 0)
        audioEngine = nil
        recognitionRequest?.endAudio()
        recognitionRequest = nil
        analyzerInputContinuation?.finish()
        analyzerInputContinuation = nil
        if cancelTask {
            recognitionTask?.cancel()
            analyzerTask?.cancel()
            dictationResultsTask?.cancel()
            if let speechAnalyzer {
                Task {
                    await speechAnalyzer.cancelAndFinishNow()
                }
            }
        }
        recognitionTask = nil
        analyzerTask = nil
        dictationResultsTask = nil
        speechAnalyzer = nil
        dictationTranscriber = nil
        recognitionFinishContinuation?.resume(returning: liveTranscript)
        recognitionFinishContinuation = nil
    }

    private func waitForRecognitionText() async -> String {
        if recognitionTask == nil, analyzerTask == nil, dictationResultsTask == nil { return liveTranscript }
        return await withCheckedContinuation { continuation in
            recognitionFinishContinuation = continuation
            Task { @MainActor [weak self] in
                try? await Task.sleep(for: .milliseconds(350))
                guard let self, self.recognitionFinishContinuation != nil else { return }
                self.recognitionFinishContinuation?.resume(returning: self.liveTranscript)
                self.recognitionFinishContinuation = nil
            }
        }
    }

    private func finishRecognition(text: String) {
        let finalText = text.isEmpty ? liveTranscript : text
        if !finalText.isEmpty {
            liveTranscript = finalText
        }
        recognitionFinishContinuation?.resume(returning: finalText)
        recognitionFinishContinuation = nil
    }

    private func handleRecognitionError(_ error: Error) {
        guard phase == .recording || phase == .transcribing || recognitionFinishContinuation != nil else { return }
        if liveTranscript.isEmpty {
            streamingTranscriptUnavailable = true
            errorText = "Speech recognition failed: \(error.localizedDescription)"
        }
        finishRecognition(text: liveTranscript)
    }

    private func transcribeRecognitionFallback(rest: (any SpeechTranscriber)?) async -> String {
        guard let accumulator = recognitionFallbackAccumulator, let rest else {
            removeRecognitionFallback()
            return ""
        }
        defer { removeRecognitionFallback() }
        do {
            let transcript = try await rest.transcribe(audio: accumulator.wavData(), mimeType: "audio/wav")
            errorText = nil
            return transcript
        } catch {
            errorText = error.localizedDescription
            return ""
        }
    }

    private func stopRecognitionFallbackCapture() {
        recognitionFallbackAccumulator?.stopAcceptingData()
    }

    private func removeRecognitionFallback() {
        recognitionFallbackAccumulator?.stopAcceptingData()
        recognitionFallbackAccumulator = nil
    }

    // MARK: Server-side recording

    private func startRecorder() throws {
        let url = FileManager.default.temporaryDirectory
            .appendingPathComponent("hermes-voice-\(UUID().uuidString).m4a")
        recordingURL = url
        let recorderSettings: [String: Any] = [
            AVFormatIDKey: kAudioFormatMPEG4AAC,
            AVSampleRateKey: 16_000,
            AVNumberOfChannelsKey: 1,
            AVEncoderAudioQualityKey: AVAudioQuality.medium.rawValue,
        ]
        let recorder = try AVAudioRecorder(url: url, settings: recorderSettings)
        recorder.isMeteringEnabled = true
        recorder.record()
        self.recorder = recorder
        startMeteringRecorder()
    }

    private func stopRecorderAndTranscribe(rest: (any SpeechTranscriber)?) async -> String {
        stopMonitoring()
        recorder?.stop()
        recorder = nil
        deactivateAudioSession()
        guard let recordingURL, let rest else {
            phase = .idle
            return ""
        }
        phase = .transcribing
        defer {
            try? FileManager.default.removeItem(at: recordingURL)
            self.recordingURL = nil
            phase = .idle
            inputLevel = 0
            levelHistory = []
            silenceHandler = nil
        }
        do {
            let data = try await Task.detached(priority: .userInitiated) {
                try Data(contentsOf: recordingURL)
            }.value
            return try await rest.transcribe(audio: data, mimeType: "audio/mp4")
        } catch {
            errorText = error.localizedDescription
            return ""
        }
    }

    private func deactivateAudioSession() {
        Task {
            try? await GraftAudioSession.deactivate()
        }
    }

    private func startSilenceMonitoringIfNeeded() {
        guard silenceHandler != nil else { return }
        silenceTask?.cancel()
        silenceTask = Task { @MainActor [weak self] in
            while !Task.isCancelled {
                try? await Task.sleep(for: .milliseconds(160))
                guard let self, self.phase == .recording else { return }
                let now = Date()
                let quietFor = now.timeIntervalSince(self.lastVoiceActivityAt)
                let elapsed = now.timeIntervalSince(self.recordingStartedAt)
                if self.heardSpeech, quietFor >= self.silenceAfterSpeech {
                    self.silenceHandler?()
                    return
                }
                if !self.heardSpeech, elapsed >= self.initialSilenceWindow {
                    self.silenceHandler?()
                    return
                }
            }
        }
    }

    private func startMeteringRecorder() {
        meterTask?.cancel()
        meterTask = Task { @MainActor [weak self] in
            while !Task.isCancelled {
                try? await Task.sleep(for: .milliseconds(40))
                guard let self, self.phase == .recording, let recorder = self.recorder else { return }
                recorder.updateMeters()
                self.handleAudioPower(recorder.averagePower(forChannel: 0))
                self.foldWaveformPeak(Self.normalizedLevel(db: recorder.peakPower(forChannel: 0)))
            }
        }
    }

    /// Drains the loudest audio slice captured since the last bar into
    /// `levelHistory` on a steady clock, scrolling the trace one bar left per
    /// tick. Each bar is its own measurement — no cross-bar easing — so the
    /// waveform shows real per-slice detail (speech spikes, room tone jitters)
    /// rather than a smoothed envelope that only swells when it "hears" you.
    /// A steady clock keeps the scroll even regardless of the audio-callback
    /// cadence (the on-device tap fires ~per buffer, the server meter is polled).
    private func startWaveformSampling() {
        waveformTask?.cancel()
        levelHistory = Array(repeating: 0, count: waveformBarCount)
        pendingWaveformPeak = 0
        lastWaveformSample = 0
        let interval = waveformInterval
        waveformTask = Task { @MainActor [weak self] in
            while !Task.isCancelled {
                try? await Task.sleep(for: interval)
                guard let self, self.phase == .recording else { return }
                // Drain the loudest slice since the last bar, then reset. If a
                // frame caught no callback, ease the previous bar down so the
                // trace stays continuous instead of dropping to a hard zero.
                let captured = self.pendingWaveformPeak
                self.pendingWaveformPeak = 0
                let sample = captured > 0 ? captured : self.lastWaveformSample * 0.7
                self.lastWaveformSample = sample
                var next = self.levelHistory
                if next.count != self.waveformBarCount {
                    next = Array(repeating: 0, count: self.waveformBarCount)
                }
                next.append(sample)
                next.removeFirst()
                self.levelHistory = next
            }
        }
    }

    /// Folds one audio slice's peak amplitude (0…1) into the pending bar. The
    /// visual clock keeps the loudest value, so each bar reflects the peak of
    /// its window — the crisp, per-syllable readout, not an averaged loudness.
    private func foldWaveformPeak(_ peak: CGFloat) {
        pendingWaveformPeak = max(pendingWaveformPeak, max(0, min(1, peak)))
    }

    private func stopMonitoring() {
        silenceTask?.cancel()
        meterTask?.cancel()
        waveformTask?.cancel()
        silenceTask = nil
        meterTask = nil
        waveformTask = nil
    }

    private func handleAudioPower(_ db: Float) {
        let normalized = max(0, min(1, (Double(db) + 58) / 58))
        inputLevel = CGFloat(pow(normalized, 1.4))
        if normalized > 0.18 {
            lastVoiceActivityAt = Date()
            heardSpeech = true
            hasHeardSpeech = true
        }
    }

    nonisolated private static func averagePower(in buffer: AVAudioPCMBuffer) -> Float {
        guard buffer.frameLength > 0 else { return -100 }
        let count = Int(buffer.frameLength)
        var sum: Float = 0
        if let channel = buffer.floatChannelData?[0] {
            for i in 0..<count {
                let sample = channel[i]
                sum += sample * sample
            }
        } else if let channel = buffer.int16ChannelData?[0] {
            for i in 0..<count {
                let sample = Float(channel[i]) / Float(Int16.max)
                sum += sample * sample
            }
        } else {
            return -100
        }
        let rms = sqrt(sum / Float(count))
        guard rms > 0 else { return -100 }
        return 20 * log10(rms)
    }

    /// Peak sample magnitude in the buffer, mapped to 0…1. Peak (not average)
    /// keeps each slice crisp, so syllables read as distinct bars in the
    /// waveform instead of melting into a single loudness blob.
    nonisolated private static func peakLevel(in buffer: AVAudioPCMBuffer) -> CGFloat {
        guard buffer.frameLength > 0 else { return 0 }
        let count = Int(buffer.frameLength)
        var peak: Float = 0
        if let channel = buffer.floatChannelData?[0] {
            for i in 0..<count { peak = max(peak, abs(channel[i])) }
        } else if let channel = buffer.int16ChannelData?[0] {
            for i in 0..<count { peak = max(peak, abs(Float(channel[i]) / Float(Int16.max))) }
        } else {
            return 0
        }
        guard peak > 0 else { return 0 }
        return normalizedLevel(db: 20 * log10(peak))
    }

    /// Maps a dBFS reading (≤ 0) onto 0…1 for the waveform. The floor sits low
    /// enough that ambient room tone still paints a faint, moving baseline (so
    /// the trace reads as "recording" even in silence); the ceiling sits below
    /// 0 so normal speech reaches full height with headroom to spare.
    nonisolated private static func normalizedLevel(db: Float) -> CGFloat {
        let floor: Float = -60
        let ceiling: Float = -6
        let clamped = max(floor, min(ceiling, db))
        return CGFloat((clamped - floor) / (ceiling - floor))
    }

    private func missingUsageDescriptions(needsSpeech: Bool) -> [String] {
        var missing: [String] = []
        if Bundle.main.object(forInfoDictionaryKey: "NSMicrophoneUsageDescription") == nil {
            missing.append("NSMicrophoneUsageDescription")
        }
        if needsSpeech, Bundle.main.object(forInfoDictionaryKey: "NSSpeechRecognitionUsageDescription") == nil {
            missing.append("NSSpeechRecognitionUsageDescription")
        }
        return missing
    }

    nonisolated private static func validateTapFormat(_ format: AVAudioFormat) throws {
        guard format.sampleRate.isFinite, format.sampleRate > 0, format.channelCount > 0 else {
            throw NSError(domain: "Graft", code: 4, userInfo: [
                NSLocalizedDescriptionKey: "Microphone input is unavailable. In Simulator, choose an audio input device or try again on a physical device.",
            ])
        }
    }

    nonisolated private static func installTap(
        on input: AVAudioNode,
        format: AVAudioFormat,
        block: @escaping AVAudioNodeTapBlock
    ) throws {
        // ~1024 frames (~21ms) so each ~33ms waveform bar catches at least one
        // callback — finer than the bar cadence keeps the trace dense and avoids
        // ease-down gaps between bars.
        input.installTap(onBus: 0, bufferSize: 1024, format: format, block: block)
    }
}

/// Folds the per-segment results of a streaming dictation/speech transcriber
/// into one continuous transcript.
///
/// `DictationTranscriber` (and `SpeechTranscriber`) deliver results *per audio
/// segment*, not cumulatively. While a segment is in progress it emits
/// *volatile* results (the live tail); when the segment settles it emits a
/// *final* result that commits just that segment. With `.frequentFinalization`
/// a long utterance is split into many finalized segments, so the full
/// transcript is the concatenation of every finalized segment plus the current
/// volatile tail. Assigning each result straight onto the display string keeps
/// only the most recent segment — which is exactly how a long spoken task
/// prompt collapsed to its final two words (FET-12). This type is the single,
/// unit-testable place that accumulation logic lives.
struct DictationTranscriptAccumulator {
    /// Text from segments the transcriber has committed.
    private(set) var finalized = ""
    /// The in-progress tail of the segment currently being recognized.
    private var volatileTail = ""

    /// The full transcript so far: committed segments plus the live tail.
    var transcript: String {
        Self.join(finalized, volatileTail)
    }

    /// Fold one transcriber result in.
    /// - Parameters:
    ///   - text: the result's text for *its* segment (not the whole utterance).
    ///   - isFinal: whether the transcriber has committed this segment.
    mutating func ingest(text: String, isFinal: Bool) {
        let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
        if isFinal {
            if !trimmed.isEmpty {
                finalized = Self.join(finalized, trimmed)
            }
            // The committed text supersedes whatever volatile tail we showed.
            volatileTail = ""
        } else {
            volatileTail = trimmed
        }
    }

    mutating func reset() {
        finalized = ""
        volatileTail = ""
    }

    private static func join(_ lhs: String, _ rhs: String) -> String {
        if lhs.isEmpty { return rhs }
        if rhs.isEmpty { return lhs }
        return lhs + " " + rhs
    }
}

enum GraftAudioSession {
    static func activateForRecording(useServer: Bool) async throws {
        let session = AVAudioSession.sharedInstance()
        if useServer {
            try session.setCategory(.playAndRecord, mode: .measurement, options: [.defaultToSpeaker, .allowBluetoothHFP])
        } else {
            try session.setCategory(.record, mode: .measurement, options: [.duckOthers])
        }
        try await activate(session)
    }

    static func activateForPlayback() async throws {
        let session = AVAudioSession.sharedInstance()
        try session.setCategory(.playback, mode: .spokenAudio)
        try await activate(session)
    }

    static func deactivate() async throws {
        let session = AVAudioSession.sharedInstance()
        try await runSerial {
            try session.setActive(false, options: .notifyOthersOnDeactivation)
        }
    }

    private static func activate(_ session: AVAudioSession) async throws {
        try await runSerial {
            try session.setActive(true, options: .notifyOthersOnDeactivation)
        }
    }

    /// A single serial queue for every `setActive(_:)` call. The live loop flips
    /// the category between recording (`VoiceModel`) and playback
    /// (`SpeakerModel`) on each turn; routing all activate/deactivate work
    /// through one FIFO queue guarantees a late record-deactivate can't land
    /// *after* a fresh playback-activate (which would silently kill playback).
    /// Ordering only — the category logic is unchanged, so composer dictation is
    /// unaffected.
    private static let sessionQueue = DispatchQueue(label: "ai.hermes.audio-session", qos: .userInitiated)

    private static func runSerial<T>(_ work: @escaping () throws -> T) async throws -> T {
        try await withCheckedThrowingContinuation { continuation in
            sessionQueue.async {
                do {
                    continuation.resume(returning: try work())
                } catch {
                    continuation.resume(throwing: error)
                }
            }
        }
    }
}

private final class VoiceAnalyzerBufferConverter: @unchecked Sendable {
    private let inputFormat: AVAudioFormat
    private let outputFormat: AVAudioFormat
    private let converter: AVAudioConverter?

    init(inputFormat: AVAudioFormat, outputFormat: AVAudioFormat) {
        self.inputFormat = inputFormat
        self.outputFormat = outputFormat
        converter = inputFormat.isEqual(outputFormat) ? nil : AVAudioConverter(from: inputFormat, to: outputFormat)
    }

    func convert(_ buffer: AVAudioPCMBuffer) -> AVAudioPCMBuffer? {
        guard let converter else { return buffer }

        let sampleRateRatio = outputFormat.sampleRate / inputFormat.sampleRate
        let outputFrameCapacity = max(1, AVAudioFrameCount(ceil(Double(buffer.frameLength) * sampleRateRatio)) + 32)
        guard let outputBuffer = AVAudioPCMBuffer(pcmFormat: outputFormat, frameCapacity: outputFrameCapacity) else {
            return nil
        }

        var didProvideInput = false
        var conversionError: NSError?
        let status = converter.convert(to: outputBuffer, error: &conversionError) { _, outStatus in
            if didProvideInput {
                outStatus.pointee = .noDataNow
                return nil
            }
            didProvideInput = true
            outStatus.pointee = .haveData
            return buffer
        }

        guard conversionError == nil, outputBuffer.frameLength > 0 else { return nil }
        switch status {
        case .haveData, .inputRanDry, .endOfStream:
            return outputBuffer
        case .error:
            return nil
        @unknown default:
            return nil
        }
    }
}

private final class VoicePCMAccumulator: @unchecked Sendable {
    private let lock = NSLock()
    private let sampleRate: Double
    private var pcmData = Data()
    private var acceptingData = true

    init(sampleRate: Double) {
        self.sampleRate = sampleRate
    }

    func append(_ buffer: AVAudioPCMBuffer) {
        guard let channel = buffer.floatChannelData?[0], buffer.frameLength > 0 else { return }
        lock.lock()
        let shouldAccept = acceptingData
        lock.unlock()
        guard shouldAccept else { return }

        var data = Data()
        data.reserveCapacity(Int(buffer.frameLength) * 2)
        for index in 0..<Int(buffer.frameLength) {
            let clipped = max(-1, min(1, channel[index]))
            let scaled = Int16(clipped * Float(Int16.max)).littleEndian
            withUnsafeBytes(of: scaled) { bytes in
                data.append(contentsOf: bytes)
            }
        }
        lock.lock()
        if acceptingData {
            pcmData.append(data)
        }
        lock.unlock()
    }

    func stopAcceptingData() {
        lock.lock()
        acceptingData = false
        pcmData.removeAll(keepingCapacity: false)
        lock.unlock()
    }

    func wavData() -> Data {
        lock.lock()
        let pcm = pcmData
        lock.unlock()

        var data = Data()
        data.reserveCapacity(44 + pcm.count)
        appendASCII("RIFF", to: &data)
        appendUInt32(UInt32(36 + pcm.count), to: &data)
        appendASCII("WAVE", to: &data)
        appendASCII("fmt ", to: &data)
        appendUInt32(16, to: &data)
        appendUInt16(1, to: &data)
        appendUInt16(1, to: &data)
        appendUInt32(UInt32(sampleRate), to: &data)
        appendUInt32(UInt32(sampleRate * 2), to: &data)
        appendUInt16(2, to: &data)
        appendUInt16(16, to: &data)
        appendASCII("data", to: &data)
        appendUInt32(UInt32(pcm.count), to: &data)
        data.append(pcm)
        return data
    }

    private func appendASCII(_ string: String, to data: inout Data) {
        data.append(contentsOf: string.utf8)
    }

    private func appendUInt16(_ value: UInt16, to data: inout Data) {
        var littleEndian = value.littleEndian
        withUnsafeBytes(of: &littleEndian) { bytes in
            data.append(contentsOf: bytes)
        }
    }

    private func appendUInt32(_ value: UInt32, to data: inout Data) {
        var littleEndian = value.littleEndian
        withUnsafeBytes(of: &littleEndian) { bytes in
            data.append(contentsOf: bytes)
        }
    }
}
