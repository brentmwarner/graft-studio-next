import LinkPresentation
import SwiftUI
import UIKit

/// Standalone web links worth previewing in assistant prose — markdown links
/// and bare URLs, minus refs that render elsewhere (images, videos).
enum LinkExtractor {
    static func urls(inText text: String) -> [URL] {
        guard let detector = try? NSDataDetector(
            types: NSTextCheckingResult.CheckingType.link.rawValue
        ) else { return [] }
        let ns = text as NSString
        var seen = Set<String>()
        var found: [URL] = []
        for match in detector.matches(in: text, range: NSRange(location: 0, length: ns.length)) {
            guard let url = match.url,
                  let scheme = url.scheme?.lowercased(),
                  scheme == "http" || scheme == "https"
            else { continue }
            let ext = url.pathExtension.lowercased()
            if ["png", "jpg", "jpeg", "gif", "webp", "heic", "mp4", "mov", "m4v"].contains(ext) {
                continue
            }
            if seen.insert(url.absoluteString).inserted {
                found.append(url)
            }
        }
        return found
    }
}

/// Fetches Open Graph metadata for one URL, once, through a process-wide
/// cache. Owned by the `TranscriptItem` (like `ChatImage`) so lazy-stack
/// row recycling doesn't refetch.
@MainActor
@Observable
final class LinkPreviewLoader: Identifiable {
    let id = UUID()
    let url: URL
    private(set) var title: String?
    private(set) var thumbnail: UIImage?
    private(set) var isLoading = false
    private(set) var failed = false

    var host: String {
        url.host(percentEncoded: false) ?? url.absoluteString
    }

    init(url: URL) {
        self.url = url
    }

    func load() async {
        guard title == nil, !isLoading else { return }
        isLoading = true
        defer { isLoading = false }

        if let cached = LinkMetadataCache.shared.metadata(for: url) {
            await apply(cached)
            return
        }
        let provider = LPMetadataProvider()
        provider.timeout = 10
        do {
            let metadata = try await provider.startFetchingMetadata(for: url)
            LinkMetadataCache.shared.insert(metadata, for: url)
            await apply(metadata)
        } catch {
            failed = true
        }
    }

    private func apply(_ metadata: LPLinkMetadata) async {
        title = metadata.title ?? host
        guard let provider = metadata.imageProvider else { return }
        thumbnail = await withCheckedContinuation { continuation in
            provider.loadObject(ofClass: UIImage.self) { object, _ in
                continuation.resume(returning: object as? UIImage)
            }
        }
    }
}

final class LinkMetadataCache: @unchecked Sendable {
    static let shared = LinkMetadataCache()
    private let cache = NSCache<NSString, LPLinkMetadata>()

    private init() {
        cache.countLimit = 200
    }

    func metadata(for url: URL) -> LPLinkMetadata? {
        cache.object(forKey: url.absoluteString as NSString)
    }

    func insert(_ metadata: LPLinkMetadata, for url: URL) {
        cache.setObject(metadata, forKey: url.absoluteString as NSString)
    }
}

/// The tapped-open list: one preview row per source, opening in the in-chat
/// browser.
struct SourcesSheet: View {
    let previews: [LinkPreviewLoader]

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 10) {
                Text("Sources")
                    .font(.title3.weight(.semibold))
                    .padding(.top, 18)
                ForEach(previews) { preview in
                    LinkPreviewCard(preview: preview)
                }
            }
            .padding(.horizontal, 16)
            .padding(.bottom, 24)
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .background(DS.Color.bg)
    }
}

/// Small favicon in a circle, neutral fill while loading.
struct FaviconCircle: View {
    let host: String
    var size: CGFloat = 18

    var body: some View {
        AsyncImage(url: URL(string: "https://\(host)/favicon.ico")) { phase in
            if case .success(let image) = phase {
                image.resizable().scaledToFit().clipShape(.circle)
            } else {
                Image(systemName: "globe")
                    .font(.system(size: size * 0.55))
                    .foregroundStyle(DS.Color.fgSubtle)
            }
        }
        .frame(width: size, height: size)
        .background(DS.Color.bgSubtle, in: .circle)
    }
}

/// Monochrome preview card for a link in assistant prose: thumbnail (when the
/// page offers one), title, host. The whole card opens the link. Matches the
/// DS card register instead of LPLinkView's opinionated styling.
struct LinkPreviewCard: View {
    @Environment(\.openURL) private var openURL
    let preview: LinkPreviewLoader

    var body: some View {
        Button {
            openURL(preview.url)
        } label: {
            HStack(spacing: 12) {
                if let thumbnail = preview.thumbnail {
                    Image(uiImage: thumbnail)
                        .resizable()
                        .scaledToFill()
                        .frame(width: 56, height: 56)
                        .clipShape(.rect(cornerRadius: DS.Radius.sm))
                } else {
                    Image(systemName: "safari")
                        .font(.system(size: 20, weight: .regular))
                        .foregroundStyle(DS.Color.fgSubtle)
                        .frame(width: 56, height: 56)
                        .background(DS.Color.bgSubtle, in: .rect(cornerRadius: DS.Radius.sm))
                }
                VStack(alignment: .leading, spacing: 3) {
                    Text(preview.title ?? preview.host)
                        .font(DS.Font.footnote.weight(.medium))
                        .foregroundStyle(DS.Color.fg)
                        .lineLimit(2)
                        .multilineTextAlignment(.leading)
                        .redacted(reason: preview.title == nil && preview.isLoading ? .placeholder : [])
                    Text(preview.host)
                        .font(DS.Font.caption)
                        .foregroundStyle(DS.Color.fgSubtle)
                        .lineLimit(1)
                }
                Spacer(minLength: 0)
                Image(systemName: "arrow.up.right")
                    .font(.caption.weight(.semibold))
                    .foregroundStyle(DS.Color.fgFaint)
            }
            .padding(10)
            .frame(maxWidth: 360, alignment: .leading)
            .background(DS.Color.bgElevated, in: .rect(cornerRadius: DS.Radius.md))
            .contentShape(.rect)
        }
        .buttonStyle(.plain)
        .task { await preview.load() }
        .accessibilityLabel("Link preview: \(preview.title ?? preview.host)")
    }
}
