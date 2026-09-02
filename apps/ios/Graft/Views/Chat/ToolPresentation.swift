import Foundation

/// Maps a raw tool invocation (name + context payload) onto the friendly
/// presentation the chat shows: verb phrases, an SF symbol, and — for web
/// tools — the domain whose favicon stands in as a brand mark. Raw JSON
/// arguments never reach the collapsed surface; `detail` is only populated
/// when something human-readable (query, command, path) can be extracted.
struct ToolPresentation {
    let symbol: String
    let runningPhrase: String
    let donePhrase: String
    /// Host extracted from the context, e.g. "nytimes.com".
    var domain: String?
    /// Full URL extracted from the context, when present.
    var url: URL?
    /// One-line human context (query, command, path) — never raw JSON.
    var detail: String?

    init(name: String, context: String) {
        let name = name.trimmingCharacters(in: .whitespacesAndNewlines)
        let lower = name.lowercased()
        url = Self.firstURL(in: context)
        domain = url?.host()?.replacingOccurrences(of: "www.", with: "")
        detail = Self.presentableDetail(from: context)

        if lower.contains("search") {
            symbol = "magnifyingglass"
            runningPhrase = "Searching the web"
            donePhrase = "Searched the web"
        } else if lower.contains("fetch") || lower.contains("browse") || lower.contains("web") || lower.contains("http") {
            symbol = "globe"
            if let domain {
                runningPhrase = "Reading \(domain)"
                donePhrase = "Read \(domain)"
            } else {
                runningPhrase = "Browsing the web"
                donePhrase = "Browsed the web"
            }
        } else if lower.contains("bash") || lower.contains("shell") || lower.contains("terminal") || lower.contains("exec") || lower.contains("command") {
            symbol = "terminal"
            runningPhrase = "Running a command"
            donePhrase = "Ran a command"
        } else if lower.contains("write") || lower.contains("edit") {
            symbol = "square.and.pencil"
            runningPhrase = "Editing a file"
            donePhrase = "Edited a file"
        } else if lower.contains("read") || lower.contains("file") || lower.contains("glob") || lower.contains("grep") {
            symbol = "doc.text"
            runningPhrase = "Reading files"
            donePhrase = "Read files"
        } else if lower.contains("image") || lower.contains("vision") || lower.contains("screenshot") {
            symbol = "photo"
            runningPhrase = "Looking at an image"
            donePhrase = "Looked at an image"
        } else if lower.contains("memory") || lower.contains("recall") {
            symbol = "brain"
            runningPhrase = "Checking memory"
            donePhrase = "Checked memory"
        } else if lower.contains("task") || lower.contains("agent") {
            symbol = "person.2"
            runningPhrase = "Delegating work"
            donePhrase = "Delegated work"
        } else {
            symbol = "wrench.and.screwdriver"
            let pretty = Self.prettyName(name)
            runningPhrase = "Using \(pretty)"
            donePhrase = "Used \(pretty)"
        }
    }

    /// Stable identity for the brand circle, so four bash calls collapse to
    /// one terminal circle but three different sites show three favicons.
    var circleKey: String { domain ?? symbol }

    private static func prettyName(_ raw: String) -> String {
        let last = raw.split(separator: ".").last.map(String.init) ?? raw
        return last.replacingOccurrences(of: "_", with: " ")
            .replacingOccurrences(of: "-", with: " ")
    }

    static func firstURL(in text: String) -> URL? {
        guard let detector = try? NSDataDetector(types: NSTextCheckingResult.CheckingType.link.rawValue) else { return nil }
        let range = NSRange(text.startIndex..., in: text)
        let match = detector.firstMatch(in: text, range: range)
        guard let url = match?.url, let scheme = url.scheme?.lowercased(),
              scheme == "http" || scheme == "https" else { return nil }
        return url
    }

    /// Pull a one-line human string out of the context. JSON payloads are
    /// mined for well-known argument keys; anything else passes through
    /// only if it doesn't look like serialized data.
    static func presentableDetail(from context: String) -> String? {
        let trimmed = context.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return nil }
        if trimmed.hasPrefix("{") || trimmed.hasPrefix("[") {
            guard let data = trimmed.data(using: .utf8),
                  let object = try? JSONSerialization.jsonObject(with: data) as? [String: Any]
            else { return nil }
            for key in ["command", "query", "url", "path", "file_path", "pattern", "prompt", "description"] {
                if let value = object[key] as? String, !value.isEmpty {
                    return oneLine(value)
                }
            }
            return nil
        }
        return oneLine(trimmed)
    }

    private static func oneLine(_ text: String) -> String {
        let first = text.split(separator: "\n", omittingEmptySubsequences: true).first.map(String.init) ?? text
        return String(first.prefix(140))
    }
}
