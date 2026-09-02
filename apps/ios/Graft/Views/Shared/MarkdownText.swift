import UIKit
import SwiftUI

/// Lightweight block-level markdown renderer. Inline styling (bold, italic,
/// code, links) goes through `AttributedString(markdown:)`; this layer adds
/// the block structure that initializer ignores: fenced code, headings,
/// lists, and rules. No third-party dependencies.
struct MarkdownText: View {
    let blocks: [MarkdownBlock]
    /// When set, the final block fades its newest glyphs in (streaming tail).
    var revealTail: Double?

    init(_ text: String, revealTail: Double? = nil) {
        blocks = MarkdownBlock.parse(text)
        self.revealTail = revealTail
    }

    var body: some View {
        VStack(alignment: .leading, spacing: MarkdownStyle.blockGap) {
            ForEach(blocks) { block in
                MarkdownBlockView(
                    block: block,
                    reveal: block.id == blocks.last?.id ? revealTail : nil
                )
            }
        }
        .textSelection(.enabled)
    }
}

/// The reading register for assistant prose — ChatGPT-like: larger body,
/// relaxed line height, generous paragraph and list rhythm.
enum MarkdownStyle {
    static let body = Font.system(size: 17)
    static let lineSpacing: CGFloat = 5
    /// Gap between blocks (paragraphs, lists, headings).
    static let blockGap: CGFloat = 14
    /// Gap between items inside a list.
    static let itemGap: CGFloat = 10
}

struct MarkdownBlock: Identifiable {
    enum Kind {
        case paragraph(String)
        case heading(level: Int, text: String)
        case code(language: String, text: String)
        case bullet(items: [String])
        case numbered(items: [String])
        case table(TableSpec)
        case rule
        case card(CardSpec)
        case cardPlaceholder
        case cardFailure
    }

    /// Fence languages rendered as generative UI cards instead of code.
    static let cardLanguages: Set<String> = ["card", "cards", "hermes-card", "ui"]

    let id: Int
    let kind: Kind

    /// Block parsing is a pure function of `text`, but `MarkdownText.init` calls
    /// it on EVERY render — and a streaming reply re-renders constantly (one per
    /// delta, plus every frame of the 0.4s glyph-reveal animation), each time
    /// re-scanning the whole message from scratch (~O(N²) over a turn). The
    /// reveal frames and any unrelated invalidation re-parse text that hasn't
    /// changed at all. Memoizing by the exact string collapses all of those to a
    /// dictionary hit; only a genuinely new string does real work. NSCache caps
    /// memory and self-evicts the short-lived intermediate streaming strings.
    private final class BlocksBox { let blocks: [MarkdownBlock]; init(_ b: [MarkdownBlock]) { blocks = b } }
    private static let cache: NSCache<NSString, BlocksBox> = {
        let c = NSCache<NSString, BlocksBox>()
        c.countLimit = 256
        return c
    }()

    static func parse(_ text: String) -> [MarkdownBlock] {
        let key = text as NSString
        if let hit = cache.object(forKey: key) { return hit.blocks }
        let blocks = parseUncached(text)
        cache.setObject(BlocksBox(blocks), forKey: key)
        return blocks
    }

    private static func parseUncached(_ text: String) -> [MarkdownBlock] {
        var blocks: [Kind] = []
        var paragraph: [String] = []
        var bullets: [String] = []
        var numbers: [String] = []
        var codeLines: [String] = []
        var codeLanguage = ""
        var inFence = false

        func flushParagraph() {
            if !paragraph.isEmpty {
                blocks.append(.paragraph(paragraph.joined(separator: "\n")))
                paragraph = []
            }
        }
        func flushLists() {
            if !bullets.isEmpty {
                blocks.append(.bullet(items: bullets))
                bullets = []
            }
            if !numbers.isEmpty {
                blocks.append(.numbered(items: numbers))
                numbers = []
            }
        }
        func flushAll() {
            flushParagraph()
            flushLists()
        }

        let lines = text.components(separatedBy: "\n")
        var consumedThrough = -1
        for (idx, rawLine) in lines.enumerated() {
            if idx <= consumedThrough { continue }
            let line = rawLine.trimmingCharacters(in: .whitespaces)

            if line.hasPrefix("```") {
                if inFence {
                    let body = codeLines.joined(separator: "\n")
                    if cardLanguages.contains(codeLanguage.lowercased()) {
                        if let spec = CardSpec.parse(body) {
                            blocks.append(.card(spec))
                        } else {
                            // A malformed card is agent plumbing, not content —
                            // show a quiet notice instead of dumping raw JSON.
                            blocks.append(.cardFailure)
                        }
                    } else {
                        blocks.append(.code(language: codeLanguage, text: body))
                    }
                    codeLines = []
                    codeLanguage = ""
                    inFence = false
                } else {
                    flushAll()
                    codeLanguage = String(line.dropFirst(3)).trimmingCharacters(in: .whitespaces)
                    inFence = true
                }
                continue
            }
            if inFence {
                codeLines.append(rawLine)
                continue
            }

            // GFM table: a row of `|`-separated cells immediately followed by a
            // delimiter row (`| --- | :--: |`). The next line decides; requiring
            // the delimiter's cell count to match the header's also keeps a lone
            // `---` rule from being read as a one-column table.
            if line.contains("|"),
               idx + 1 < lines.count,
               let aligns = tableDelimiter(lines[idx + 1]) {
                let header = splitTableRow(line)
                if aligns.count == header.count {
                    flushAll()
                    var bodyRows: [[String]] = []
                    var next = idx + 2
                    while next < lines.count {
                        let bodyLine = lines[next].trimmingCharacters(in: .whitespaces)
                        guard !bodyLine.isEmpty, bodyLine.contains("|") else { break }
                        bodyRows.append(normalizeRow(splitTableRow(lines[next]), to: header.count))
                        next += 1
                    }
                    consumedThrough = next - 1
                    blocks.append(.table(TableSpec(header: header, rows: bodyRows, alignments: aligns)))
                    continue
                }
            }

            if line.isEmpty {
                flushAll()
                continue
            }
            if line == "---" || line == "***" || line == "___" {
                flushAll()
                blocks.append(.rule)
                continue
            }
            if line.hasPrefix("#") {
                let level = line.prefix(while: { $0 == "#" }).count
                if level <= 6, line.count > level, line[line.index(line.startIndex, offsetBy: level)] == " " {
                    flushAll()
                    blocks.append(.heading(level: level, text: String(line.dropFirst(level + 1))))
                    continue
                }
            }
            if line.hasPrefix("- ") || line.hasPrefix("* ") || line.hasPrefix("+ ") {
                flushParagraph()
                bullets.append(String(line.dropFirst(2)))
                continue
            }
            if let dotIndex = line.firstIndex(of: "."),
               line.distance(from: line.startIndex, to: dotIndex) <= 3,
               Int(line[line.startIndex..<dotIndex]) != nil,
               line.index(after: dotIndex) < line.endIndex,
               line[line.index(after: dotIndex)] == " " {
                flushParagraph()
                numbers.append(String(line[line.index(dotIndex, offsetBy: 2)...]))
                continue
            }
            if line == ">" || line.hasPrefix("> ") {
                flushLists()
                let unquoted = String(line.dropFirst()).trimmingCharacters(in: .whitespaces)
                if unquoted.isEmpty {
                    flushParagraph()
                } else {
                    paragraph.append(unquoted)
                }
                continue
            }
            flushLists()
            paragraph.append(rawLine)
        }
        if inFence {
            if cardLanguages.contains(codeLanguage.lowercased()) {
                // Mid-stream card JSON never flashes raw — show a skeleton
                // until the fence closes and parses.
                blocks.append(.cardPlaceholder)
            } else {
                blocks.append(.code(language: codeLanguage, text: codeLines.joined(separator: "\n")))
            }
        }
        flushAll()

        return blocks.enumerated().map { MarkdownBlock(id: $0.offset, kind: $0.element) }
    }

    // MARK: GFM table helpers

    /// Parse a delimiter row (`| --- | :--: |`) into one alignment per column,
    /// or nil if it isn't one — every cell must be `-`/`:` and contain a dash.
    private static func tableDelimiter(_ raw: String) -> [TableSpec.Align]? {
        let cells = splitTableRow(raw)
        guard !cells.isEmpty else { return nil }
        var aligns: [TableSpec.Align] = []
        for cell in cells {
            let c = cell.trimmingCharacters(in: .whitespaces)
            guard c.contains("-"), c.allSatisfy({ $0 == "-" || $0 == ":" }) else { return nil }
            let left = c.hasPrefix(":"), right = c.hasSuffix(":")
            aligns.append(left && right ? .center : right ? .right : left ? .left : .auto)
        }
        return aligns
    }

    /// Split one row into trimmed cells, honoring `\|` escapes and an optional
    /// leading/trailing pipe.
    private static func splitTableRow(_ raw: String) -> [String] {
        var line = raw.trimmingCharacters(in: .whitespaces)
        if line.hasPrefix("|") { line.removeFirst() }
        if line.hasSuffix("|") { line.removeLast() }
        var cells: [String] = []
        var current = ""
        var escaped = false
        for ch in line {
            if escaped {
                current.append(ch == "|" ? "|" : "\\\(ch)")
                escaped = false
            } else if ch == "\\" {
                escaped = true
            } else if ch == "|" {
                cells.append(current.trimmingCharacters(in: .whitespaces))
                current = ""
            } else {
                current.append(ch)
            }
        }
        if escaped { current.append("\\") }
        cells.append(current.trimmingCharacters(in: .whitespaces))
        return cells
    }

    /// Pad with empty cells or drop extras so a row matches the header width.
    private static func normalizeRow(_ cells: [String], to count: Int) -> [String] {
        if cells.count == count { return cells }
        if cells.count > count { return Array(cells.prefix(count)) }
        return cells + Array(repeating: "", count: count - cells.count)
    }
}

/// A parsed GFM table: header cells, body rows (already padded/truncated to the
/// header's column count), and one alignment per column. Recovered by the block
/// parser rather than JSON-decoded like `CardSpec`, so it lives here.
struct TableSpec: Equatable {
    enum Align: Equatable {
        case auto, left, right, center

        var text: TextAlignment {
            switch self {
            case .right: .trailing
            case .center: .center
            default: .leading
            }
        }
        var frame: Alignment {
            switch self {
            case .right: .trailing
            case .center: .center
            default: .leading
            }
        }
    }

    let header: [String]
    let rows: [[String]]
    let alignments: [Align]

    /// Resolve an `.auto` column: right-align when every non-empty body cell is
    /// numeric (so currency / percent columns line up), otherwise leading.
    func resolved(_ column: Int) -> Align {
        let align = alignments[column]
        guard align == .auto else { return align }
        let cells = rows
            .compactMap { column < $0.count ? $0[column] : nil }
            .map { $0.trimmingCharacters(in: .whitespaces) }
            .filter { !$0.isEmpty }
        guard !cells.isEmpty, cells.allSatisfy(Self.isNumeric) else { return .left }
        return .right
    }

    static func isNumeric(_ s: String) -> Bool {
        guard s.contains(where: { $0.isNumber }) else { return false }
        let allowed = Set<Character>("0123456789.,%+-$€£¥ ")
        return s.allSatisfy { allowed.contains($0) }
    }
}

private struct MarkdownBlockView: View {
    let block: MarkdownBlock
    var reveal: Double?

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            switch block.kind {
            case .paragraph(let text):
                InlineText(text, reveal: reveal)
            case .heading(let level, let text):
                InlineText(text, reveal: reveal)
                    .font(headingFont(level))
            case .code(let language, let text):
                CodeBlockView(language: language, code: text)
            case .bullet(let items):
                VStack(alignment: .leading, spacing: MarkdownStyle.itemGap) {
                    ForEach(Array(items.enumerated()), id: \.offset) { index, item in
                        HStack(alignment: .firstTextBaseline, spacing: 12) {
                            Text("•")
                            InlineText(item, reveal: index == items.count - 1 ? reveal : nil)
                        }
                    }
                }
                .padding(.leading, 6)
            case .numbered(let items):
                VStack(alignment: .leading, spacing: MarkdownStyle.itemGap) {
                    ForEach(Array(items.enumerated()), id: \.offset) { index, item in
                        HStack(alignment: .firstTextBaseline, spacing: 12) {
                            Text("\(index + 1).")
                                .monospacedDigit()
                            InlineText(item, reveal: index == items.count - 1 ? reveal : nil)
                        }
                    }
                }
                .padding(.leading, 6)
            case .table(let spec):
                MarkdownTableView(spec: spec)
            case .rule:
                Rectangle()
                    .fill(DS.Color.border)
                    .frame(height: 1)
                    .padding(.vertical, 2)
            case .card(let spec):
                GenerativeCardView(spec: spec)
            case .cardPlaceholder:
                CardPlaceholderView()
            case .cardFailure:
                CardFailureView()
            }
        }
        // Reading register for prose; headings, code, and cards set their own
        // explicit fonts and win over this environment default.
        .font(MarkdownStyle.body)
        .lineSpacing(MarkdownStyle.lineSpacing)
    }

    private func headingFont(_ level: Int) -> Font {
        switch level {
        case 1: .title2.bold()
        case 2: .title3.bold()
        case 3: .headline
        default: .subheadline.weight(.semibold)
        }
    }
}

/// Inline markdown via AttributedString; falls back to verbatim text. When
/// `reveal` is set, glyphs fade in via `RevealTextRenderer` (streaming tail).
/// Internal (not private) so card blocks can reuse the same link-aware
/// pipeline for their prose.
struct InlineText: View {
    let text: String
    var reveal: Double?

    init(_ text: String, reveal: Double? = nil) {
        self.text = text
        self.reveal = reveal
    }

    var body: some View {
        let attributed = Self.attributed(from: text)
        let composed = attributed.map(Self.composedText(from:)) ?? Text(text)
        // A custom textRenderer silently disables `.textSelection`. Use it only
        // when we actually need it — the streaming fade (`reveal != nil`) or
        // citation-badge capsules — so settled, badge-free prose stays
        // selectable.
        let needsRenderer = reveal != nil || Self.hasURLishLink(attributed)
        return Group {
            if needsRenderer {
                composed.textRenderer(ChatTextRenderer(progress: reveal ?? 1))
            } else {
                composed
            }
        }
    }

    /// Same redundancy as block parsing: `body` rebuilds the inline
    /// `AttributedString` (markdown grammar + `NSDataDetector` link scan) for
    /// EVERY paragraph on EVERY render, including the settled paragraphs above a
    /// streaming tail that never change. Memoize per-paragraph text so a
    /// re-render reuses the parse; only new/changed paragraph text pays.
    private final class AttrBox { let value: AttributedString?; init(_ v: AttributedString?) { value = v } }
    private static let attrCache: NSCache<NSString, AttrBox> = {
        let c = NSCache<NSString, AttrBox>()
        c.countLimit = 512
        return c
    }()

    static func attributed(from text: String) -> AttributedString? {
        let key = text as NSString
        if let hit = attrCache.object(forKey: key) { return hit.value }
        let value: AttributedString?
        if var attributed = try? AttributedString(
            markdown: text,
            options: AttributedString.MarkdownParsingOptions(
                interpretedSyntax: .inlineOnlyPreservingWhitespace
            )
        ) {
            linkifyBareURLs(&attributed)
            value = attributed
        } else {
            value = nil
        }
        attrCache.setObject(AttrBox(value), forKey: key)
        return value
    }

    private static func hasURLishLink(_ attributed: AttributedString?) -> Bool {
        guard let attributed else { return false }
        for run in attributed.runs where isBadgeRun(run, in: attributed) {
            return true
        }
        return false
    }

    /// The one place that decides badge vs. tappable link. A run whose
    /// visible text IS its destination is a bare URL — pasted into prose (a
    /// lead) or auto-linked by the 2027-SDK markdown parser — and must stay a
    /// tappable `.link`. Only an authored citation, whose URLish text differs
    /// from where it points (domain text over a deep URL), collapses to a
    /// badge. Text comparison, not provenance: the parser's auto-links are
    /// indistinguishable from authored `[url](url)` by attributes alone.
    static func isBadgeRun(
        _ run: AttributedString.Runs.Run, in attributed: AttributedString
    ) -> Bool {
        guard let url = run.link else { return false }
        let text = String(attributed[run.range].characters)
            .trimmingCharacters(in: .whitespaces)
        guard isURLish(text) else { return false }
        return !linkTextMatchesDestination(text, url: url)
    }

    /// "https://a.com/x" == destination, "a.com" over "https://a.com" (scheme
    /// added by the detector), and trailing-slash drift all read as "the text
    /// is the destination".
    static func linkTextMatchesDestination(_ text: String, url: URL) -> Bool {
        func canon(_ s: String) -> String {
            var s = s.lowercased()
            if s.hasSuffix("/") { s.removeLast() }
            s = s.replacingOccurrences(of: "https://", with: "")
            s = s.replacingOccurrences(of: "http://", with: "")
            return s
        }
        return canon(text) == canon(url.absoluteString)
    }

    /// Build the Text by concatenating runs: links whose visible text is just
    /// a URL become compact Grok-style host badges ("forbes") tagged with the
    /// `CitationBadge` custom attribute so the renderer draws their capsule —
    /// embedding the attribute in the AttributedString doesn't reach layout
    /// runs; `Text.customAttribute` does. Links with prose text keep their
    /// words untouched.
    private static func composedText(from attributed: AttributedString) -> Text {
        var result = Text(verbatim: "")
        for run in attributed.runs {
            let segment = attributed[run.range]
            guard let url = run.link, isBadgeRun(run, in: attributed) else {
                result = Text("\(result)\(AttributedString(segment))")
                continue
            }
            // No .link on the badge: link runs take a separate layout path
            // that drops custom attributes, and the capsule needs the
            // CitationBadge marker to reach the renderer. The Sources pill
            // owns navigation.
            var badge = AttributedString("\u{00A0}\(shortHost(of: url))\u{00A0}")
            badge.font = .caption.weight(.medium)
            badge.foregroundColor = DS.Color.fgMuted
            let badgeText = Text(badge).customAttribute(CitationBadge())
            result = Text("\(result) \(badgeText)")
        }
        return result
    }

    private static func isURLish(_ text: String) -> Bool {
        let trimmed = text.trimmingCharacters(in: .whitespaces).lowercased()
        return trimmed.hasPrefix("http://") || trimmed.hasPrefix("https://")
            || trimmed.hasPrefix("www.")
            || (trimmed.contains(".") && !trimmed.contains(" ") && trimmed.count < 80)
    }

    /// "www.forbes.com/x" → "forbes"; subdomains keep their qualifier
    /// ("finance.yahoo").
    private static func shortHost(of url: URL) -> String {
        guard var host = url.host(percentEncoded: false) else { return url.absoluteString }
        if host.hasPrefix("www.") { host.removeFirst(4) }
        let parts = host.split(separator: ".")
        if parts.count >= 2 {
            return parts.dropLast().joined(separator: ".")
        }
        return host
    }

    /// `AttributedString(markdown:)` only links `[text](url)` syntax; make
    /// bare "https://…" runs tappable too, leaving existing links alone.
    private static func linkifyBareURLs(_ attributed: inout AttributedString) {
        let plain = String(attributed.characters)
        guard plain.contains("http"),
              let detector = try? NSDataDetector(
                  types: NSTextCheckingResult.CheckingType.link.rawValue
              )
        else { return }
        let matches = detector.matches(
            in: plain, range: NSRange(location: 0, length: (plain as NSString).length)
        )
        for match in matches {
            guard let url = match.url,
                  let scheme = url.scheme?.lowercased(),
                  scheme == "http" || scheme == "https",
                  let range = Range(match.range, in: attributed)
            else { continue }
            let alreadyLinked = attributed[range].runs.contains { $0.link != nil }
            if !alreadyLinked {
                attributed[range].link = url
            }
            // The 2027-SDK parser auto-links bare URLs before we get here
            // (alreadyLinked), so the underline is applied outside the guard —
            // a bare URL reads as a link on every OS the app runs on.
            attributed[range].underlineStyle = .single
        }
    }
}

/// Marks a run as a citation badge so `ChatTextRenderer` draws a capsule
/// behind it — attributed-string backgrounds can only paint square rects.
struct CitationBadge: TextAttribute {}

/// One renderer for assistant prose: rounded-capsule backgrounds behind
/// citation-badge runs, plus the streaming glyph fade (`progress` < 1)
/// inherited from `RevealTextRenderer` — a Text can only have one renderer.
struct ChatTextRenderer: TextRenderer, Animatable {
    var progress: Double

    var animatableData: Double {
        get { progress }
        set { progress = newValue }
    }

    func draw(layout: Text.Layout, in context: inout GraphicsContext) {
        // Capsules first, behind the glyphs. One per badge run per line.
        for line in layout {
            for run in line where run[CitationBadge.self] != nil {
                var bounds: CGRect?
                for slice in run {
                    let rect = slice.typographicBounds.rect
                    bounds = bounds.map { $0.union(rect) } ?? rect
                }
                guard let bounds else { continue }
                let capsule = bounds.insetBy(dx: -1, dy: -2.5)
                context.fill(
                    Path(roundedRect: capsule, cornerRadius: capsule.height / 2),
                    with: .color(DS.Color.bgMuted.opacity(0.55))
                )
            }
        }

        let slices = layout.flatMap { line in line }.flatMap { run in run }
        let count = slices.count
        guard count > 0 else { return }
        if progress >= 1 {
            for slice in slices {
                context.draw(slice)
            }
            return
        }
        // Streaming tail: soft fade edge over the most recent glyphs.
        let span = max(0.04, 12.0 / Double(count))
        for (index, slice) in slices.enumerated() {
            let position = Double(index) / Double(count)
            let alpha = ((progress - position) / span).clamped(to: 0...1)
            guard alpha > 0 else { continue }
            var copy = context
            copy.opacity = alpha
            copy.draw(slice)
        }
    }
}

private struct CodeBlockView: View {
    let language: String
    let code: String

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            HStack {
                Text(language.isEmpty ? "code" : language)
                    .font(.caption2)
                    .foregroundStyle(.secondary)
                Spacer()
                CopyButton(text: code, size: 13)
            }
            .padding(.leading, 10)
            .padding(.trailing, 4)
            // The header has no selectable text; disabling selection here
            // prevents taps from being swallowed by the selection gesture
            // instead of reaching the copy button.
            .textSelection(.disabled)
            ScrollView(.horizontal, showsIndicators: false) {
                Text(code)
                    .font(.callout.monospaced())
                    .textSelection(.enabled)
                    .padding(10)
            }
        }
        .background(.fill.quaternary, in: .rect(cornerRadius: 10))
    }
}

/// Renders a GFM table as the "Card" treatment: an enclosed `bgElevated`
/// surface with a hairline border and `md` radius, a `bgSubtle` header band,
/// and hairline dividers between rows. Column widths are proportional to each
/// column's longest content (so a label column gets room a ✓ column doesn't),
/// measured once from the container width; cells align per the column's GFM
/// alignment.
private struct MarkdownTableView: View {
    let spec: TableSpec

    @State private var width: CGFloat = 0

    private let radius = DS.Radius.md
    private let hPad: CGFloat = 14
    private let minColumn: CGFloat = 44

    private var columnCount: Int { spec.header.count }

    var body: some View {
        let widths = resolvedColumnWidths
        VStack(alignment: .leading, spacing: 0) {
            row(spec.header, isHeader: true, widths: widths)
                .background(DS.Color.bgSubtle)
            hairline()
            ForEach(Array(spec.rows.enumerated()), id: \.offset) { index, cells in
                row(cells, isHeader: false, widths: widths)
                if index < spec.rows.count - 1 { hairline() }
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(DS.Color.bgElevated)
        .clipShape(RoundedRectangle(cornerRadius: radius))
        .overlay(
            RoundedRectangle(cornerRadius: radius)
                .strokeBorder(DS.Color.border, lineWidth: 1)
        )
        .onGeometryChange(for: CGFloat.self) { $0.size.width } action: { width = $0 }
        // A table isn't prose — drop the inherited reading line spacing so
        // wrapped cells stay tight.
        .lineSpacing(0)
    }

    /// Per-column widths: a `minColumn` floor for every column, then the
    /// remaining width split by each column's longest cell (character count,
    /// clamped so one long cell can't starve the rest). Nil until the width is
    /// known — the first frame falls back to equal flexible columns.
    private var resolvedColumnWidths: [CGFloat]? {
        guard width > 0, columnCount > 0 else { return nil }
        let weights = (0..<columnCount).map { column -> CGFloat in
            var longest = column < spec.header.count ? spec.header[column].count : 0
            for bodyRow in spec.rows where column < bodyRow.count {
                longest = max(longest, bodyRow[column].count)
            }
            return CGFloat(min(max(longest, 2), 28))
        }
        let total = weights.reduce(0, +)
        guard total > 0 else { return nil }
        let remaining = max(0, width - minColumn * CGFloat(columnCount))
        return weights.map { minColumn + remaining * ($0 / total) }
    }

    private func hairline() -> some View {
        // Internal rules read lighter than the outer frame — the card's border
        // (full-strength `border`) defines the edge; row separators just hint.
        Rectangle().fill(DS.Color.border.opacity(0.6)).frame(height: 1)
    }

    private func row(_ cells: [String], isHeader: Bool, widths: [CGFloat]?) -> some View {
        HStack(alignment: .top, spacing: 0) {
            ForEach(0..<columnCount, id: \.self) { column in
                cell(
                    column < cells.count ? cells[column] : "",
                    column: column,
                    isHeader: isHeader,
                    width: widths.map { $0[column] }
                )
            }
        }
    }

    private func cell(_ text: String, column: Int, isHeader: Bool, width: CGFloat?) -> some View {
        let align = spec.resolved(column)
        return InlineText(text)
            .font(isHeader ? .system(size: 12, weight: .semibold) : .system(size: 15))
            .foregroundStyle(
                isHeader ? DS.Color.fgSubtle : (column == 0 ? DS.Color.fg : DS.Color.fgMuted)
            )
            .multilineTextAlignment(align.text)
            .padding(.horizontal, hPad)
            .padding(.vertical, isHeader ? 9 : 11)
            .frame(width: width, alignment: align.frame)
            .frame(maxWidth: width == nil ? .infinity : nil, alignment: align.frame)
    }
}
