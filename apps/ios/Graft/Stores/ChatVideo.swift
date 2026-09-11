import AVFoundation
import CryptoKit
import Foundation
import UIKit

/// One playable video in the transcript. Mirrors `ChatImage`'s lazy one-shot
/// resolve, but spools bytes to the caches directory instead of memory —
/// `AVPlayer` wants a file URL, and clips outlive any sane NSCache budget.
@MainActor
@Observable
final class ChatVideo: Identifiable {
    enum Source: Equatable {
        case remotePath(String)   // server media path — fetched via /api/files/read (/api/media is image-only)
        case localURL(URL)        // already on disk
    }

    let id = UUID()
    let source: Source
    private(set) var fileURL: URL?
    /// Width / height of the playable picture (rotation applied), so the
    /// player card hugs the clip's real shape instead of letterboxing.
    private(set) var aspectRatio: CGFloat?
    /// First frame, for the thumbnail tile — playback happens full-screen.
    private(set) var poster: UIImage?
    private(set) var isLoading = false
    private(set) var failed = false

    init(_ source: Source) {
        self.source = source
        if case let .localURL(url) = source {
            fileURL = url
        }
    }

    /// Idempotent: resolves `fileURL` exactly once. `.remotePath` needs the
    /// REST client; pass `app.rest`.
    func load(rest: RESTClient?) async {
        if fileURL == nil, !isLoading {
            isLoading = true
            defer { isLoading = false }

            switch source {
            case .localURL(let url):
                fileURL = url

            case .remotePath(let path):
                let spooled = Self.spoolURL(for: path)
                if FileManager.default.fileExists(atPath: spooled.path) {
                    fileURL = spooled
                } else if let rest {
                    do {
                        let data = try await rest.videoData(path: path)
                        try data.write(to: spooled, options: .atomic)
                        fileURL = spooled
                    } catch {
                        failed = true
                    }
                } else {
                    failed = true
                }
            }
        }
        if let fileURL, aspectRatio == nil {
            await resolveAspect(url: fileURL)
        }
        if let fileURL, poster == nil {
            await generatePoster(url: fileURL)
        }
    }

    private func generatePoster(url: URL) async {
        let generator = AVAssetImageGenerator(asset: AVURLAsset(url: url))
        generator.appliesPreferredTrackTransform = true
        generator.maximumSize = CGSize(width: 800, height: 800)
        guard let cgImage = try? await generator
            .image(at: CMTime(seconds: 0, preferredTimescale: 600)).image
        else { return }
        poster = UIImage(cgImage: cgImage)
    }

    /// The display aspect of the video track — `naturalSize` is the sensor
    /// shape; portrait clips carry the rotation in `preferredTransform`.
    private func resolveAspect(url: URL) async {
        let asset = AVURLAsset(url: url)
        do {
            guard let track = try await asset.loadTracks(withMediaType: .video).first else {
                NSLog("ChatVideo: no video track for %@", url.lastPathComponent)
                return
            }
            let (size, transform) = try await track.load(.naturalSize, .preferredTransform)
            let rotated = size.applying(transform)
            let width = abs(rotated.width)
            let height = abs(rotated.height)
            guard width > 0, height > 0 else {
                NSLog("ChatVideo: degenerate size %@", String(describing: size))
                return
            }
            aspectRatio = width / height
            NSLog("ChatVideo: aspect %.3f for %@", width / height, url.lastPathComponent)
        } catch {
            NSLog("ChatVideo: aspect probe failed for %@: %@", url.lastPathComponent, String(describing: error))
        }
    }

    func retry(rest: RESTClient?) async {
        guard fileURL == nil else { return }
        failed = false
        await load(rest: rest)
    }

    /// Stable per-path spool location so reopening a thread reuses the bytes
    /// (`hashValue` is seeded per launch; SHA-256 is not).
    nonisolated private static func spoolURL(for path: String) -> URL {
        let digest = SHA256.hash(data: Data(path.utf8))
            .prefix(8).map { String(format: "%02x", $0) }.joined()
        let ext = (path as NSString).pathExtension.isEmpty
            ? "mp4" : (path as NSString).pathExtension
        let dir = FileManager.default.urls(for: .cachesDirectory, in: .userDomainMask)[0]
            .appendingPathComponent("ChatVideos", isDirectory: true)
        try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        return dir.appendingPathComponent("\(digest).\(ext)")
    }
}

/// Pulls playable video refs out of agent prose. Accepts explicit `MEDIA:`
/// markers anywhere the agent can read through `/api/files/read`, and bare
/// `.hermes/` paths for compatibility with older transcript text.
enum ChatVideoExtractor {
    static func sources(inText text: String) -> [ChatVideo.Source] {
        var found: [ChatVideo.Source] = []
        let patterns = [
            #"MEDIA:\s*([^\s"'`)]+\.(?:mp4|mov|m4v))"#,
            #"(~?/?[^\s"'`)]*\.hermes/[^\s"'`)]+\.(?:mp4|mov|m4v))"#,
        ]
        let ns = text as NSString
        for pattern in patterns {
            guard let regex = try? NSRegularExpression(pattern: pattern, options: [.caseInsensitive]) else { continue }
            for match in regex.matches(in: text, range: NSRange(location: 0, length: ns.length)) {
                appendRemotePath(ns.substring(with: match.range(at: 1)), into: &found)
            }
        }
        return found
    }

    private static func appendRemotePath(_ path: String, into found: inout [ChatVideo.Source]) {
        let trimmed = path.trimmingCharacters(in: .whitespaces)
        guard !trimmed.isEmpty else { return }
        let already = found.contains {
            if case .remotePath(trimmed) = $0 { return true }
            return false
        }
        if !already {
            found.append(.remotePath(trimmed))
        }
    }
}
