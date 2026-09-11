import UIKit
import SwiftUI
import ImageIO
import CryptoKit

/// One renderable image in the transcript. Resolves its pixels lazily and
/// off the main thread, then caches them so scrolling back or reloading a
/// thread doesn't re-decode or re-fetch. A reference type so the owning
/// `TranscriptItem` (also a reference) holds a stable list while each image
/// loads independently.
@MainActor
@Observable
final class ChatImage: Identifiable {
    enum Source {
        case decoded(UIImage)     // pixels already in hand (composer attachments)
        case dataURL(String)      // "data:<mime>;base64,…" — decode off-main
        case remotePath(String)   // server media path — fetch via /api/media
        case remoteURL(URL)       // public http(s) image — fetched directly
    }

    let id = UUID()
    let source: Source
    private(set) var image: UIImage?
    private(set) var isLoading = false
    private(set) var failed = false

    nonisolated static let displayMaxPixelSize: CGFloat = 720
    nonisolated static let previewMaxPixelSize: CGFloat = 2400

    init(_ source: Source) {
        self.source = source
        if case let .decoded(image) = source {
            self.image = image
        }
    }

    /// Idempotent: resolves `image` exactly once. `.remotePath` needs the REST
    /// client; pass `app.rest`.
    func load(rest: RESTClient?) async {
        guard image == nil, !isLoading else { return }
        isLoading = true
        defer { isLoading = false }

        switch source {
        case .decoded(let image):
            self.image = image

        case .dataURL(let url):
            let key = Self.cacheKey(forDataURL: url)
            if let cached = ChatImageCache.shared.image(forKey: key) {
                image = cached
                return
            }
            let ui = await ChatImageLoadRegistry.shared.image(forKey: key) {
                if let cached = ChatImageCache.shared.image(forKey: key) { return cached }
                let data = await Task.detached(priority: .userInitiated) {
                    ChatImage.decodeDataURL(url)
                }.value
                guard let data,
                      let ui = await Self.decodedImage(from: data, maxPixelSize: Self.displayMaxPixelSize)
                else { return nil }
                ChatImageCache.shared.insert(ui, forKey: key)
                return ui
            }
            if let ui {
                image = ui
            } else {
                failed = true
            }

        case .remotePath(let path):
            let key = Self.cacheKey(forRemotePath: path)
            if let cached = ChatImageCache.shared.image(forKey: key) {
                image = cached
                return
            }
            guard let rest else { failed = true; return }
            let ui = await ChatImageLoadRegistry.shared.image(forKey: key) {
                if let cached = ChatImageCache.shared.image(forKey: key) { return cached }
                do {
                    let data = try await Self.loadRemoteData(path: path, rest: rest)
                    guard let ui = await Self.decodedImage(from: data, maxPixelSize: Self.displayMaxPixelSize) else {
                        return nil
                    }
                    ChatImageCache.shared.insert(ui, forKey: key)
                    return ui
                } catch {
                    return nil
                }
            }
            if let ui {
                image = ui
            } else {
                failed = true
            }

        case .remoteURL(let url):
            // A public image the agent linked (markdown `![](https://…)`, or an
            // OpenAI/Anthropic image block whose source is a URL). Fetched
            // directly — these aren't served by /api/media — mirroring how the
            // generative-UI card already loads its hero image.
            let key = Self.cacheKey(forRemoteURL: url)
            if let cached = ChatImageCache.shared.image(forKey: key) {
                image = cached
                return
            }
            let ui = await ChatImageLoadRegistry.shared.image(forKey: key) {
                if let cached = ChatImageCache.shared.image(forKey: key) { return cached }
                do {
                    let data = try await Self.remoteURLData(url)
                    guard let ui = await Self.decodedImage(from: data, maxPixelSize: Self.displayMaxPixelSize) else {
                        return nil
                    }
                    ChatImageCache.shared.insert(ui, forKey: key)
                    return ui
                } catch {
                    return nil
                }
            }
            if let ui {
                image = ui
            } else {
                failed = true
            }
        }
    }

    func retry(rest: RESTClient?) async {
        guard image == nil else { return }
        failed = false
        await load(rest: rest)
    }

    /// Write the best available preview file without re-encoding the already
    /// downsampled display thumbnail. Data URLs and fetched remote images keep
    /// their original bytes so QuickLook can show more detail than the chat row.
    func writePreviewTempFile(rest: RESTClient?) async -> URL? {
        switch source {
        case .decoded(let image):
            guard let data = await Self.pngData(from: image) else { return nil }
            return await Self.writeTemp(data, fileExtension: "png")
        case .dataURL(let url):
            guard let data = await Task.detached(priority: .userInitiated, operation: {
                ChatImage.decodeDataURL(url)
            }).value else { return nil }
            return await Self.writeTemp(data, fileExtension: Self.fileExtension(forDataURL: url))
        case .remotePath(let path):
            guard let rest,
                  let data = try? await Self.loadRemoteData(path: path, rest: rest)
            else { return nil }
            return await Self.writeTemp(data, fileExtension: Self.fileExtension(forPath: path))
        case .remoteURL(let url):
            guard let data = try? await Self.remoteURLData(url) else { return nil }
            return await Self.writeTemp(data, fileExtension: Self.fileExtension(forPath: url.path))
        }
    }

    nonisolated static func loadRemoteData(path: String, rest: RESTClient) async throws -> Data {
        do {
            return try await rest.mediaData(path: path)
        } catch let error as GraftError {
            #if DEBUG
                NSLog("ChatImage: /api/media failed for %@: %@; falling back to /api/files/read", path, error.localizedDescription)
            #endif
            if Self.shouldFallBackToFiles(for: error) {
                return try await rest.fileData(path: path)
            }
            throw error
        }
    }

    nonisolated static func remoteURLData(_ url: URL) async throws -> Data {
        let (data, response) = try await RESTClient.session.data(from: url)
        if let http = response as? HTTPURLResponse, !(200...299).contains(http.statusCode) {
            throw GraftError.http(
                status: http.statusCode,
                body: String(data: data, encoding: .utf8) ?? ""
            )
        }
        return data
    }

    /// Whether a failed `/api/media` load should be retried via
    /// `/api/files/read`. `/api/media` only serves the agent's media roots, so a
    /// screenshot the model saved elsewhere (`~/Desktop`, `/tmp`, …) comes back
    /// 403 "Path outside media roots" (or 400/404) — but the managed-file reader
    /// still serves it. FET-9 "Tap to retry": 403 was previously NOT retried, so
    /// the fallback that would have succeeded never fired. A decoding failure
    /// (media endpoint returned non-image JSON) also warrants the file reader.
    nonisolated static func shouldFallBackToFiles(for error: GraftError) -> Bool {
        switch error {
        case .http(let status, _):
            return status == 400 || status == 403 || status == 404
        case .decoding:
            return true
        default:
            return false
        }
    }

    /// Base64 payload of a `data:` URL, decoded to bytes off the main thread.
    nonisolated static func decodeDataURL(_ url: String) -> Data? {
        guard url.hasPrefix("data:"), let comma = url.firstIndex(of: ",") else { return nil }
        return Base64.decodeLenient(String(url[url.index(after: comma)...]))
    }

    nonisolated static func cacheKey(forDataURL url: String) -> String {
        let digest = SHA256.hash(data: Data(url.utf8))
        return "dataURL:" + digest.map { String(format: "%02x", $0) }.joined()
    }

    nonisolated static func cacheKey(forRemotePath path: String) -> String {
        "remotePath:\(path)"
    }

    nonisolated static func cacheKey(forRemoteURL url: URL) -> String {
        "remoteURL:\(url.absoluteString)"
    }

    nonisolated static func decodedImage(from data: Data, maxPixelSize: CGFloat = 2400) async -> UIImage? {
        await Task.detached(priority: .userInitiated) {
            decodedImageSynchronously(from: data, maxPixelSize: maxPixelSize)
        }.value
    }

    nonisolated private static func decodedImageSynchronously(from data: Data, maxPixelSize: CGFloat) -> UIImage? {
        let sourceOptions = [kCGImageSourceShouldCache: false] as CFDictionary
        guard let source = CGImageSourceCreateWithData(data as CFData, sourceOptions) else {
            return UIImage(data: data)
        }
        let decodeOptions: [CFString: Any] = [
            kCGImageSourceCreateThumbnailFromImageAlways: true,
            kCGImageSourceCreateThumbnailWithTransform: true,
            kCGImageSourceShouldCacheImmediately: true,
            kCGImageSourceThumbnailMaxPixelSize: max(1, Int(maxPixelSize)),
        ]
        guard let cgImage = CGImageSourceCreateThumbnailAtIndex(source, 0, decodeOptions as CFDictionary) else {
            return UIImage(data: data)
        }
        return UIImage(cgImage: cgImage)
    }

    nonisolated private static func pngData(from image: UIImage) async -> Data? {
        await Task.detached(priority: .userInitiated) {
            image.pngData()
        }.value
    }

    nonisolated static func fileExtension(forDataURL url: String) -> String {
        guard let semicolon = url.firstIndex(of: ";"),
              let colon = url.firstIndex(of: ":"),
              colon < semicolon
        else { return "png" }
        let mime = String(url[url.index(after: colon)..<semicolon]).lowercased()
        return fileExtension(forMIMEType: mime)
    }

    nonisolated static func fileExtension(forPath path: String) -> String {
        let ext = URL(fileURLWithPath: path).pathExtension.lowercased()
        return ["png", "jpg", "jpeg", "webp", "heic", "gif"].contains(ext) ? ext : "png"
    }

    nonisolated private static func fileExtension(forMIMEType mime: String) -> String {
        switch mime {
        case "image/jpeg", "image/jpg": return "jpg"
        case "image/png": return "png"
        case "image/webp": return "webp"
        case "image/heic", "image/heif": return "heic"
        case "image/gif": return "gif"
        default: return "png"
        }
    }

    nonisolated private static func writeTemp(_ data: Data, fileExtension: String) async -> URL? {
        await Task.detached(priority: .userInitiated) {
            let safeExtension = fileExtension.trimmingCharacters(in: CharacterSet(charactersIn: "."))
            let dir = FileManager.default.temporaryDirectory
                .appendingPathComponent("chat-image-\(UUID().uuidString)", isDirectory: true)
            let url = dir.appendingPathComponent("Image.\(safeExtension.isEmpty ? "png" : safeExtension)")
            do {
                try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
                try data.write(to: url, options: .atomic)
                return url
            } catch {
                return nil
            }
        }.value
    }
}

/// Tolerant base64 decoding for data URLs that arrive from models/gateways.
/// The raw `Data(base64Encoded:)` initializer rejects line-wrapped (MIME)
/// payloads, URL-safe alphabets, and missing `=` padding — all of which a model
/// or upstream API can legitimately emit. Each of those otherwise turns a valid
/// image into a "Tap to retry" tile, so normalize before decoding.
enum Base64 {
    static func decodeLenient(_ raw: String) -> Data? {
        // Normalize URL-safe alphabet, strip whitespace, and restore stripped
        // padding before any decode attempt. Decoding first with
        // .ignoreUnknownCharacters treats `-`/`_` as unknown and silently drops
        // them, corrupting URL-safe payloads instead of normalizing them.
        var s = raw
            .replacingOccurrences(of: "-", with: "+")
            .replacingOccurrences(of: "_", with: "/")
            .filter { !$0.isWhitespace }
        let remainder = s.count % 4
        if remainder > 0 {
            s += String(repeating: "=", count: 4 - remainder)
        }
        return Data(base64Encoded: s, options: .ignoreUnknownCharacters)
    }
}

/// Coalesces duplicate in-flight loads so identical transcript images don't
/// fetch/decode multiple times before the shared cache has a chance to fill.
actor ChatImageLoadRegistry {
    static let shared = ChatImageLoadRegistry()
    private var tasks: [String: Task<UIImage?, Never>] = [:]

    func image(forKey key: String, start: @Sendable @escaping () async -> UIImage?) async -> UIImage? {
        if let task = tasks[key] {
            return await task.value
        }
        let task = Task(priority: .userInitiated) {
            await start()
        }
        tasks[key] = task
        let image = await task.value
        tasks.removeValue(forKey: key)
        return image
    }
}

/// Process-wide decoded-image cache, cost-bounded so a long automation run
/// can't grow memory without bound. Keyed by digest/path/URL identifiers.
final class ChatImageCache: @unchecked Sendable {
    static let shared = ChatImageCache()
    private let cache = NSCache<NSString, UIImage>()

    private init() {
        cache.totalCostLimit = 64 * 1024 * 1024  // ~64 MB of decoded pixels
    }

    func image(forKey key: String) -> UIImage? {
        cache.object(forKey: key as NSString)
    }

    func insert(_ image: UIImage, forKey key: String) {
        let cost = Int(image.size.width * image.size.height * image.scale * image.scale * 4)
        cache.setObject(image, forKey: key as NSString, cost: cost)
    }
}
