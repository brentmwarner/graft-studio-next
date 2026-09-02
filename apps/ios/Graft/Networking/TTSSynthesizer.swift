import Foundation

/// Anything that can turn text into ready-to-play audio bytes. The Graft host
/// has no speech endpoint yet, so nothing conforms in production — the speak
/// pipeline stays dormant until a synthesizer exists (`AppModel.tts`).
protocol TTSSynthesizer: Sendable {
    func speak(text: String) async throws -> Data
}

/// Server-side speech-to-text seam for `VoiceModel`. On-device recognition is
/// the only production path today; a future host transcription endpoint slots
/// in here without touching the recording pipeline.
protocol SpeechTranscriber: Sendable {
    func transcribe(audio: Data, mimeType: String) async throws -> String
}
