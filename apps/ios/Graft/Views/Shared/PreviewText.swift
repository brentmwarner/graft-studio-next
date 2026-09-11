import Foundation

/// Flattens a raw message body — markdown, machine wrappers, em-dashes — into
/// calm, single-line plain text for inbox previews, the way Slack / iMessage /
/// WhatsApp show the last message in a list. Pure, deterministic, offline.
///
/// None of those apps render markdown in the list; they strip formatting to
/// readable text. So this is not a compromise toward that look — it *is* that
/// look. Used by `RecentRow.previewText`.
enum PreviewText {
    /// Process at most this many leading characters. A preview only needs the
    /// first line or two, and this bounds the regex work per row during scroll.
    private static let inputCap = 600
    /// Generated card JSON can exceed the normal preview cap because of stats
    /// and item arrays. Scan a larger bounded prefix before falling back to
    /// plain-text cleanup so card rows do not leak raw braces and keys.
    private static let cardInputCap = 6_000

    static func plain(from raw: String) -> String {
        let cardProbe = String(raw.prefix(cardInputCap))
            .replacingOccurrences(of: "\r\n", with: "\n")
            .replacingOccurrences(of: "\r", with: "\n")
        var text = String(raw.prefix(inputCap))
            .replacingOccurrences(of: "\r\n", with: "\n")
            .replacingOccurrences(of: "\r", with: "\n")

        if let cardSummary = generatedCardSummary(from: text) {
            text = cardSummary
        } else if let cardSummary = generatedCardSummary(from: cardProbe) {
            text = cardSummary
        } else if looksLikeCardFence(cardProbe) {
            return ""
        }

        // Machine wrapper: "Cronjob Response: <name> (job_id: <id>)".
        text = replace("(?i)^\\s*Cronjob Response:[^\\n]*\\(job_id:[^)]*\\)[ \\t]*", with: "", in: text)

        // Line level: drop rules / table delimiters / code fences; strip leading
        // block markers (heading, blockquote, list); table pipes → spaces.
        text = text
            .components(separatedBy: "\n")
            .compactMap(cleanLine)
            .joined(separator: "\n")

        // Inline level: unwrap emphasis / code / links, drop images.
        text = stripInline(text)

        // One calm line.
        text = collapseWhitespace(text)

        // Em / en dashes (we don't want them): a spaced clause separator reads as
        // a comma ("Yes — I think" → "Yes, I think"); anything else (a range like
        // "10—20") becomes a plain hyphen.
        text = replace("[ \\t]+[—–][ \\t]+", with: ", ", in: text)
        text = replace("[—–]", with: "-", in: text)

        // Tidy artifacts left by the substitutions above.
        text = replace("\\s+,", with: ",", in: text)
        text = replace(",{2,}", with: ",", in: text)
        text = collapseWhitespace(text)
        return text.trimmingCharacters(in: CharacterSet(charactersIn: " ,"))
    }

    /// Returns the cleaned line, or nil to drop it entirely.
    private static func cleanLine(_ line: String) -> String? {
        var s = line.trimmingCharacters(in: .whitespaces)
        if s.isEmpty { return "" }
        // Code-fence marker line (```), keep the fenced content lines themselves.
        if s.hasPrefix("```") { return "" }
        // Horizontal rule: --- *** ___ === (3+ of one char, spaces allowed).
        let compact = s.replacingOccurrences(of: " ", with: "")
        if compact.count >= 3, let f = compact.first, "-*_=".contains(f),
           compact.allSatisfy({ $0 == f }) { return nil }
        // Table delimiter row: only pipes / dashes / colons, and has a dash.
        if compact.contains("-"), compact.allSatisfy({ "|-:".contains($0) }) { return nil }
        // Machine preambles from upstream agent prompts are not user-readable
        // thread previews. Drop the whole line rather than surfacing prompt junk.
        if isMachinePreambleLine(s) {
            return nil
        }
        // Leading block markers.
        s = replace("^#{1,6}\\s+", with: "", in: s)        // heading
        s = replace("^(>\\s?)+", with: "", in: s)           // blockquote(s)
        s = replace("^([-*+]|\\d+[.)])\\s+", with: "", in: s) // list item
        // Table cell separators.
        s = s.replacingOccurrences(of: "|", with: " ")
        return s
    }

    private static func generatedCardSummary(from input: String) -> String? {
        let trimmed = input.trimmingCharacters(in: .whitespacesAndNewlines)
        let candidate: String
        if trimmed.hasPrefix("```") {
            candidate = trimmed
                .components(separatedBy: "\n")
                .dropFirst()
                .prefix { !$0.trimmingCharacters(in: .whitespaces).hasPrefix("```") }
                .joined(separator: "\n")
        } else {
            candidate = trimmed
        }
        guard let json = firstJSONObject(in: candidate),
              let spec = CardSpec.parse(json)
        else { return nil }

        var parts: [String] = []
        append(spec.title, to: &parts)
        append(spec.subtitle, to: &parts)
        append(spec.footer, to: &parts)

        if let stats = spec.stats {
            for stat in stats.prefix(3) {
                let label = stat.label ?? ""
                let value = stat.value?.value ?? ""
                let text = [label, value]
                    .map { $0.trimmingCharacters(in: .whitespacesAndNewlines) }
                    .filter { !$0.isEmpty }
                    .joined(separator: " ")
                if !text.isEmpty { parts.append(text) }
            }
        }

        if let items = spec.items {
            for item in items.prefix(2) {
                append(item.title, to: &parts)
                append(item.subtitle, to: &parts)
                append(item.value?.value, to: &parts)
            }
        }

        if let cards = spec.cards {
            for card in cards.prefix(2) {
                append(card.title, to: &parts)
                append(card.subtitle, to: &parts)
                append(card.badge, to: &parts)
            }
        }

        // Composable `blocks` body — the newer card shape. Pull the readable
        // text out of each block so a block-only card (no legacy stats/items)
        // still gets a calm preview instead of leaking raw JSON.
        if let blocks = spec.blocks {
            for block in blocks.prefix(4) where block.rendersContent {
                summarizeBlock(block, into: &parts)
            }
        }

        let summary = parts
            .map { collapseWhitespace($0) }
            .filter { !$0.isEmpty }
            .joined(separator: ", ")
        // `CardSpec.parse` already gated on substance, so reaching here means
        // this is a real generated card. If no readable text came out (e.g. a
        // chart- or divider-only body), return "" to suppress the preview rather
        // than nil — nil falls through and leaks the raw card JSON into the row.
        return summary.isEmpty ? "" : summary
    }

    /// Appends the readable text of one composable card block to `parts`,
    /// matching how each block type renders (label/value, step titles, …).
    private static func summarizeBlock(_ block: CardBlock, into parts: inout [String]) {
        switch block.kind {
        case .text:
            append(block.title, to: &parts)
            append(block.bodyText, to: &parts)
        case .metric:
            let text = [block.label, block.value?.value]
                .compactMap { $0?.trimmingCharacters(in: .whitespacesAndNewlines) }
                .filter { !$0.isEmpty }
                .joined(separator: " ")
            if !text.isEmpty { parts.append(text) }
        case .stats:
            for stat in (block.stats ?? []).prefix(3) {
                let text = [stat.label, stat.value?.value]
                    .compactMap { $0?.trimmingCharacters(in: .whitespacesAndNewlines) }
                    .filter { !$0.isEmpty }
                    .joined(separator: " ")
                if !text.isEmpty { parts.append(text) }
            }
        case .rows:
            for item in (block.items ?? []).prefix(2) {
                append(item.title, to: &parts)
                append(item.subtitle, to: &parts)
            }
        case .progress:
            append(block.caption, to: &parts)
        case .checklist:
            for step in (block.steps ?? []).prefix(3) {
                append(step.title, to: &parts)
            }
        case .bars:
            for bar in (block.bars ?? []).prefix(3) {
                append(bar.label, to: &parts)
            }
        case .compare:
            for option in (block.options ?? []).prefix(3) {
                append(option.name, to: &parts)
            }
        case .chart, .divider, .none:
            break
        }
    }

    private static func isMachinePreambleLine(_ line: String) -> Bool {
        let lower = line.lowercased()
        return [
            "[important",
            "[system",
            "[internal",
            "[developer",
            "[tool",
            "[context",
        ].contains { lower.hasPrefix($0) }
    }

    private static func append(_ value: String?, to parts: inout [String]) {
        guard let value else { return }
        let text = value.trimmingCharacters(in: .whitespacesAndNewlines)
        if !text.isEmpty { parts.append(text) }
    }

    private static func looksLikeCardFence(_ text: String) -> Bool {
        let lines = text.split(separator: "\n", omittingEmptySubsequences: false)
        guard let first = lines.first?.trimmingCharacters(in: .whitespacesAndNewlines),
              first.hasPrefix("```")
        else { return false }
        let language = first.dropFirst(3).trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        return MarkdownBlock.cardLanguages.contains(language)
    }

    private static func firstJSONObject(in text: String) -> String? {
        guard let start = text.firstIndex(of: "{") else { return nil }
        var depth = 0
        var inString = false
        var escaping = false
        var i = start
        while i < text.endIndex {
            let ch = text[i]
            if inString {
                if escaping {
                    escaping = false
                } else if ch == "\\" {
                    escaping = true
                } else if ch == "\"" {
                    inString = false
                }
            } else if ch == "\"" {
                inString = true
            } else if ch == "{" {
                depth += 1
            } else if ch == "}" {
                depth -= 1
                if depth == 0 {
                    return String(text[start...i])
                }
            }
            i = text.index(after: i)
        }
        return nil
    }

    private static func stripInline(_ input: String) -> String {
        var s = stripMarkdownLinksAndImages(input)
        s = replace("(\\*\\*|__)(.+?)\\1", with: "$2", in: s)       // **bold** / __bold__
        // _italic_ — but only when bounded by non-word chars, so identifiers like
        // `hermes_inbox` survive untouched.
        s = replace("(?<![A-Za-z0-9])_(\\S(?:.*?\\S)?)_(?![A-Za-z0-9])", with: "$1", in: s)
        s = replace("(?<!\\*)\\*(\\S(?:.*?\\S)?)\\*(?!\\*)", with: "$1", in: s) // *italic*
        s = replace("~~(.+?)~~", with: "$1", in: s)                 // ~~strike~~
        s = s.replacingOccurrences(of: "```", with: "")             // stray fences
        s = replace("`([^`]+)`", with: "$1", in: s)                 // `code`
        return s
    }

    private static func stripMarkdownLinksAndImages(_ input: String) -> String {
        var output = ""
        var i = input.startIndex

        while i < input.endIndex {
            if input[i] == "!",
               let next = input.index(i, offsetBy: 1, limitedBy: input.endIndex),
               next < input.endIndex,
               input[next] == "[",
               let closeBracket = input[next...].firstIndex(of: "]"),
               let openParen = input.index(closeBracket, offsetBy: 1, limitedBy: input.endIndex),
               openParen < input.endIndex,
               input[openParen] == "(",
               let closeParen = closingMarkdownURLParen(in: input, from: openParen) {
                // Images do not contribute useful preview text; drop alt text too.
                i = input.index(after: closeParen)
                continue
            }

            if input[i] == "[",
               let closeBracket = input[i...].firstIndex(of: "]"),
               let openParen = input.index(closeBracket, offsetBy: 1, limitedBy: input.endIndex),
               openParen < input.endIndex,
               input[openParen] == "(",
               let closeParen = closingMarkdownURLParen(in: input, from: openParen) {
                output.append(contentsOf: input[input.index(after: i)..<closeBracket])
                i = input.index(after: closeParen)
                continue
            }

            output.append(input[i])
            i = input.index(after: i)
        }

        return output
    }

    private static func closingMarkdownURLParen(in input: String, from openParen: String.Index) -> String.Index? {
        var depth = 0
        var i = openParen
        while i < input.endIndex {
            switch input[i] {
            case "(":
                depth += 1
            case ")":
                depth -= 1
                if depth == 0 { return i }
            default:
                break
            }
            i = input.index(after: i)
        }
        return nil
    }

    private static func collapseWhitespace(_ s: String) -> String {
        replace("\\s+", with: " ", in: s).trimmingCharacters(in: .whitespaces)
    }

    private static let regexLock = NSLock()
    private static var regexCache: [String: NSRegularExpression] = [:]

    private static func replace(_ pattern: String, with template: String, in s: String) -> String {
        let re: NSRegularExpression
        regexLock.lock()
        if let cached = regexCache[pattern] {
            re = cached
        } else if let compiled = try? NSRegularExpression(pattern: pattern) {
            regexCache[pattern] = compiled
            re = compiled
        } else {
            regexLock.unlock()
            return s
        }
        regexLock.unlock()
        let range = NSRange(s.startIndex..<s.endIndex, in: s)
        return re.stringByReplacingMatches(in: s, range: range, withTemplate: template)
    }
}
