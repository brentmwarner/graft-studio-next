import Foundation

/// Pulls renderable image sources out of agent payloads. Handles both
/// multimodal content shapes the gateway emits — OpenAI `image_url` and
/// Anthropic `image`/`source` — and a conservative text fallback for markdown
/// image refs, `MEDIA:/path` markers, and bare `~/.hermes/...` screenshot paths.
///
/// The driving case: `computer_use` returns `{_multimodal, content:[{type:
/// "image_url", image_url:{url:"data:image/png;base64,…"}}]}` inside the
/// `tool.complete` result. `sources(in:)` walks that and returns `.dataURL`s.
enum ChatImageExtractor {
    /// Image sources embedded in a tool result or message `content` payload.
    static func sources(in value: JSONValue) -> [ChatImage.Source] {
        var found: [ChatImage.Source] = []
        collect(value, into: &found)
        return found
    }

    private static func collect(_ value: JSONValue, into found: inout [ChatImage.Source]) {
        if let array = value.array {
            for part in array { collect(part, into: &found) }
            return
        }
        guard let object = value.object else { return }

        // OpenAI-style: {"type":"image_url","image_url":{"url":"data:…"}}
        if let url = value["image_url"]["url"].string ?? value["image_url"].string {
            append(url, into: &found)
        }
        // Anthropic-style: {"type":"image","source":{"media_type","data"}}
        if value["type"].string == "image" {
            let src = value["source"]
            if let data = src["data"].string, !data.isEmpty {
                let mime = src["media_type"].string ?? "image/png"
                append("data:\(mime);base64,\(data)", into: &found)
            } else if let url = src["url"].string {
                append(url, into: &found)
            }
        }
        // Nested envelope: computer_use wraps parts under `content`.
        if let content = object["content"], content.array != nil {
            collect(content, into: &found)
        }
    }

    /// Markdown image refs and bare media-root image paths in free text.
    static func sources(inText text: String) -> [ChatImage.Source] {
        var found: [ChatImage.Source] = []

        // Markdown ![alt](target)
        if let regex = try? NSRegularExpression(pattern: #"!\[[^\]]*\]\(([^)\s]+)"#) {
            let ns = text as NSString
            for match in regex.matches(in: text, range: NSRange(location: 0, length: ns.length)) {
                append(ns.substring(with: match.range(at: 1)), into: &found)
            }
        }

        // Agent prose sometimes uses explicit media markers, e.g.
        // `MEDIA:/tmp/hermes_shots/desktop.png`. Treat only image extensions as
        // images; videos are handled by ChatVideoExtractor.
        if let regex = try? NSRegularExpression(pattern: #"MEDIA:\s*([^\s"'`)]+\.(?:png|jpe?g|gif|webp|heic))"#, options: [.caseInsensitive]) {
            let ns = text as NSString
            for match in regex.matches(in: text, range: NSRange(location: 0, length: ns.length)) {
                appendRemotePath(ns.substring(with: match.range(at: 1)), into: &found)
            }
        }

        // Bare agent media paths, e.g. ~/.hermes/screenshots/cap_1.png. Scoped
        // to `.hermes/` + an image extension to avoid matching arbitrary text.
        if let regex = try? NSRegularExpression(pattern: #"(~?/?[^\s"'`)]*\.hermes/[^\s"'`)]+\.(?:png|jpe?g|gif|webp|heic))"#, options: [.caseInsensitive]) {
            let ns = text as NSString
            for match in regex.matches(in: text, range: NSRange(location: 0, length: ns.length)) {
                appendRemotePath(ns.substring(with: match.range(at: 1)), into: &found)
            }
        }

        return found
    }

    private static func append(_ url: String, into found: inout [ChatImage.Source]) {
        let trimmed = url.trimmingCharacters(in: .whitespaces)
        guard !trimmed.isEmpty else { return }
        if trimmed.hasPrefix("data:") {
            found.append(.dataURL(trimmed))
        } else if trimmed.hasPrefix("http://") || trimmed.hasPrefix("https://") {
            // A public image the model linked. The system prompt actively tells
            // models to deliver images this way (markdown `![alt](url)`, card
            // hero URLs), and OpenAI/Anthropic image blocks can carry a URL
            // source — so fetch it directly (like the card's AsyncImage) instead
            // of dropping it. /api/media is for the agent's local media roots.
            if let parsed = URL(string: trimmed),
               !found.contains(where: { if case .remoteURL(parsed) = $0 { return true }; return false }) {
                found.append(.remoteURL(parsed))
            }
        } else {
            found.append(.remotePath(trimmed))
        }
    }

    private static func appendRemotePath(_ path: String, into found: inout [ChatImage.Source]) {
        let trimmed = path.trimmingCharacters(in: .whitespaces)
        guard !trimmed.isEmpty else { return }
        if !found.contains(where: { if case .remotePath(trimmed) = $0 { return true }; return false }) {
            found.append(.remotePath(trimmed))
        }
    }
}

/// Once a media ref renders as an inline thumbnail, the raw path in the prose
/// is plumbing — strip it from the displayed text (the thumbnail IS the
/// content, like any messaging app).
enum MediaRefScrubber {
    static func scrub(_ text: String) -> String {
        var out = text
        // Whole markdown image tags.
        out = out.replacingOccurrences(
            of: #"!\[[^\]]*\]\([^)]*\)"#,
            with: "", options: .regularExpression
        )
        // Explicit media markers, including paths outside the normal media
        // roots. These render as inline media and should not remain in prose.
        out = out.replacingOccurrences(
            of: #"MEDIA:\s*[^\s"'`)]+\.(?:png|jpe?g|gif|webp|heic|mp4|mov|m4v)"#,
            with: "", options: [.regularExpression, .caseInsensitive]
        )
        // Bare .hermes media paths — the same shapes the extractors render.
        out = out.replacingOccurrences(
            of: #"(~?/?[^\s"'`)]*\.hermes/[^\s"'`)]+\.(?:png|jpe?g|gif|webp|heic|mp4|mov|m4v))"#,
            with: "", options: [.regularExpression, .caseInsensitive]
        )
        // Tidy the seams the removals leave behind.
        out = out.replacingOccurrences(
            of: #"[ \t]+([.,;:!?])"#, with: "$1", options: .regularExpression
        )
        out = out.replacingOccurrences(
            of: #"[ \t]{2,}"#, with: " ", options: .regularExpression
        )
        return out.trimmingCharacters(in: .whitespacesAndNewlines)
    }
}
