import UIKit
import SwiftUI

/// Lightweight block-level markdown renderer. Inline styling (bold, italic,
/// code, links) goes through `AttributedString(markdown:)`; this layer adds
/// the block structure that initializer ignores: fenced code, headings,
/// lists, and rules. No third-party dependencies.
struct MarkdownText: View {
    @Environment(WorkspaceFileLinks.self) private var fileLinks: WorkspaceFileLinks?
    let blocks: [MarkdownBlock]
    let isStreaming: Bool

    init(_ text: String, isStreaming: Bool = false) {
        blocks = MarkdownBlock.parse(text)
        self.isStreaming = isStreaming
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            ForEach(Array(blocks.enumerated()), id: \.element.id) { index, block in
                MarkdownBlockView(block: block, isStreaming: isStreaming && block.id == blocks.last?.id)
                    .padding(.top, index == 0 ? 0 : block.isHeading ? 28 : blocks[index - 1].isHeading ? 12 : MarkdownStyle.blockGap)
            }
        }
        .textSelection(.enabled)
        .tint(DS.Color.link)
        .frame(maxWidth: .infinity, alignment: .leading)
        .task(id: fileCandidates) {
            await fileLinks?.resolve(fileCandidates)
        }
    }

    private var fileCandidates: [String] {
        let prose = blocks.flatMap { block -> [String] in
            switch block.kind {
            case .paragraph(let text), .heading(_, let text), .quote(let text): [text]
            case .list(let items): items.map(\.text)
            case .table(let spec): spec.header + spec.rows.flatMap { $0 }
            case .code, .rule, .card, .cardPlaceholder, .cardFailure: []
            }
        }
        return Array(Set(prose.flatMap { InlineText.fileCandidates(in: $0) })).sorted()
    }
}

/// The reading register for assistant prose — ChatGPT-like: larger body,
/// relaxed line height, generous paragraph and list rhythm.
enum MarkdownStyle {
    static let body = Font.body
    static let lineSpacing: CGFloat = 5
    /// Gap between blocks (paragraphs, lists, headings).
    static let blockGap: CGFloat = 22
    /// Gap between items inside a list.
    static let itemGap: CGFloat = 7
}

struct MarkdownBlock: Identifiable {
    enum Kind {
        case paragraph(String)
        case heading(level: Int, text: String)
        case code(language: String, text: String)
        case list(items: [MarkdownListItem])
        case quote(String)
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

    var isHeading: Bool {
        if case .heading = kind { return true }
        return false
    }

    /// Reuse parsed blocks across unrelated updates. Bound both count and cost
    /// so intermediate snapshots of a long reply cannot fill the cache.
    private final class BlocksBox { let blocks: [MarkdownBlock]; init(_ b: [MarkdownBlock]) { blocks = b } }
    private static let cache: NSCache<NSString, BlocksBox> = {
        let c = NSCache<NSString, BlocksBox>()
        c.countLimit = 64
        c.totalCostLimit = 2 * 1024 * 1024
        return c
    }()

    static func parse(_ text: String) -> [MarkdownBlock] {
        let key = text as NSString
        if let hit = cache.object(forKey: key) { return hit.blocks }
        let blocks = parseUncached(text)
        cache.setObject(BlocksBox(blocks), forKey: key, cost: text.utf8.count)
        return blocks
    }

    private static func parseUncached(_ text: String) -> [MarkdownBlock] {
        var blocks: [MarkdownBlock] = []
        var paragraph: [String] = []
        var paragraphStart = 0
        var listItems: [MarkdownListItem] = []
        var quoteLines: [String] = []
        var quoteStart = 0
        var codeLines: [String] = []
        var codeLanguage = ""
        var fenceStart = 0
        var fenceMarker: Character = "`"
        var fenceLength = 3
        var inFence = false

        func flushParagraph() {
            if !paragraph.isEmpty {
                blocks.append(MarkdownBlock(id: paragraphStart, kind: .paragraph(joinProseLines(paragraph))))
                paragraph = []
            }
        }
        func flushLists() {
            if let first = listItems.first {
                blocks.append(MarkdownBlock(id: first.id, kind: .list(items: listItems)))
                listItems = []
            }
        }
        func flushQuote() {
            if !quoteLines.isEmpty {
                blocks.append(MarkdownBlock(id: quoteStart, kind: .quote(joinProseLines(quoteLines))))
                quoteLines = []
            }
        }
        func flushAll() {
            flushParagraph()
            flushLists()
            flushQuote()
        }

        let lines = text.components(separatedBy: "\n")
        var consumedThrough = -1
        for (idx, rawLine) in lines.enumerated() {
            if idx <= consumedThrough { continue }
            let line = rawLine.trimmingCharacters(in: .whitespaces)

            if inFence {
                let markerCount = line.prefix(while: { $0 == fenceMarker }).count
                if markerCount >= fenceLength && line.dropFirst(markerCount).trimmingCharacters(in: .whitespaces).isEmpty {
                    let body = codeLines.joined(separator: "\n")
                    let kind: Kind
                    if cardLanguages.contains(codeLanguage.lowercased()) {
                        if let spec = CardSpec.parse(body) {
                            kind = .card(spec)
                        } else {
                            // A malformed card is agent plumbing, not content —
                            // show a quiet notice instead of dumping raw JSON.
                            kind = .cardFailure
                        }
                    } else {
                        kind = .code(language: codeLanguage, text: body)
                    }
                    blocks.append(MarkdownBlock(id: fenceStart, kind: kind))
                    codeLines = []
                    codeLanguage = ""
                    inFence = false
                } else {
                    codeLines.append(rawLine)
                }
                continue
            }
            if let marker = line.first, marker == "`" || marker == "~",
               line.prefix(while: { $0 == marker }).count >= 3 {
                flushAll()
                fenceStart = idx
                fenceMarker = marker
                fenceLength = line.prefix(while: { $0 == marker }).count
                codeLanguage = String(line.dropFirst(fenceLength)).trimmingCharacters(in: .whitespaces)
                inFence = true
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
                    blocks.append(MarkdownBlock(id: idx, kind: .table(TableSpec(header: header, rows: bodyRows, alignments: aligns))))
                    continue
                }
            }

            if line.isEmpty {
                flushAll()
                continue
            }
            if line == "---" || line == "***" || line == "___" {
                flushAll()
                blocks.append(MarkdownBlock(id: idx, kind: .rule))
                continue
            }
            if line.hasPrefix("#") {
                let level = line.prefix(while: { $0 == "#" }).count
                if level <= 6, line.count > level, line[line.index(line.startIndex, offsetBy: level)] == " " {
                    flushAll()
                    blocks.append(MarkdownBlock(id: idx, kind: .heading(level: level, text: String(line.dropFirst(level + 1)))))
                    continue
                }
            }
            if let item = MarkdownListItem.parse(rawLine, line: idx) {
                flushParagraph()
                flushQuote()
                listItems.append(item)
                continue
            }
            if let last = listItems.last, rawLine.prefix(while: { $0.isWhitespace }).count >= last.contentIndent {
                listItems[listItems.count - 1].text += " " + line
                continue
            }
            if line == ">" || line.hasPrefix("> ") {
                flushParagraph()
                flushLists()
                if quoteLines.isEmpty { quoteStart = idx }
                quoteLines.append(String(line.dropFirst()).trimmingCharacters(in: .whitespaces))
                continue
            }
            flushLists()
            flushQuote()
            if paragraph.isEmpty { paragraphStart = idx }
            paragraph.append(rawLine)
        }
        if inFence {
            if cardLanguages.contains(codeLanguage.lowercased()) {
                // Mid-stream card JSON never flashes raw — show a skeleton
                // until the fence closes and parses.
                blocks.append(MarkdownBlock(id: fenceStart, kind: .cardPlaceholder))
            } else {
                blocks.append(MarkdownBlock(id: fenceStart, kind: .code(language: codeLanguage, text: codeLines.joined(separator: "\n"))))
            }
        }
        flushAll()

        return blocks
    }

    /// Markdown soft wraps are spaces; explicit hard breaks remain newlines.
    private static func joinProseLines(_ lines: [String]) -> String {
        var result = ""
        for (index, line) in lines.enumerated() {
            let hardBreak = line.hasSuffix("  ") || line.hasSuffix("\\")
            let content = line.hasSuffix("\\") ? String(line.dropLast()) : line
            result += content.trimmingCharacters(in: .whitespaces)
            if index < lines.count - 1 {
                result += hardBreak || line.isEmpty || lines[index + 1].isEmpty ? "\n" : " "
            }
        }
        return result
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

struct MarkdownListItem: Identifiable {
    enum Marker: Equatable {
        case bullet, number(Int), task(Bool)
    }

    /// Source-line identity stays fixed as text is appended to this item.
    let id: Int
    let indent: Int
    let contentIndent: Int
    let marker: Marker
    var text: String

    static func parse(_ raw: String, line: Int) -> MarkdownListItem? {
        let indent = raw.prefix(while: { $0.isWhitespace }).count
        let trimmed = raw.dropFirst(indent)
        let marker: Marker
        let prefixLength: Int
        if trimmed.hasPrefix("- ") || trimmed.hasPrefix("* ") || trimmed.hasPrefix("+ ") {
            marker = .bullet
            prefixLength = 2
        } else {
            let digits = trimmed.prefix(while: { $0.isNumber })
            let rest = trimmed.dropFirst(digits.count)
            guard !digits.isEmpty, digits.count <= 9, let number = Int(digits),
                  rest.hasPrefix(". ") || rest.hasPrefix(") ") else { return nil }
            marker = .number(number)
            prefixLength = digits.count + 2
        }
        var text = String(trimmed.dropFirst(prefixLength))
        var resolvedMarker = marker
        if marker == .bullet, text.hasPrefix("[ ] ") || text.hasPrefix("[x] ") || text.hasPrefix("[X] ") {
            resolvedMarker = .task(!text.hasPrefix("[ ]"))
            text = String(text.dropFirst(4))
        }
        return MarkdownListItem(id: line, indent: indent, contentIndent: indent + prefixLength,
                                marker: resolvedMarker, text: text)
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
    let isStreaming: Bool

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            switch block.kind {
            case .paragraph(let text):
                InlineText(text, isStreaming: isStreaming)
            case .heading(let level, let text):
                InlineText(text, isStreaming: isStreaming)
                    .font(headingFont(level))
            case .code(let language, let text):
                CodeBlockView(language: language, code: text)
            case .list(let items):
                MarkdownListView(items: items, isStreaming: isStreaming)
            case .quote(let text):
                InlineText(text, isStreaming: isStreaming)
                    .foregroundStyle(DS.Color.fgMuted)
                    .padding(.leading, 14)
                    .overlay(alignment: .leading) {
                        RoundedRectangle(cornerRadius: 1).fill(DS.Color.borderStrong).frame(width: 2)
                    }
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
        case 1: .title2.weight(.semibold)
        case 2: .title3.weight(.semibold)
        case 3: .headline
        default: .body.weight(.semibold)
        }
    }
}

private struct MarkdownListView: View {
    let items: [MarkdownListItem]
    let isStreaming: Bool
    @ScaledMetric(relativeTo: .body) private var markerWidth = 22.0
    @ScaledMetric(relativeTo: .body) private var indentWidth = 18.0

    var body: some View {
        VStack(alignment: .leading, spacing: MarkdownStyle.itemGap) {
            ForEach(items) { item in
                HStack(alignment: .firstTextBaseline, spacing: 7) {
                    marker(item.marker)
                        .frame(minWidth: markerWidth, alignment: .trailing)
                        .foregroundStyle(DS.Color.fgMuted)
                    InlineText(item.text, isStreaming: isStreaming && item.id == items.last?.id)
                        .frame(maxWidth: .infinity, alignment: .leading)
                }
                .padding(.leading, CGFloat(min(max(0, item.indent - (items.first?.indent ?? 0)) / 2, 4)) * indentWidth)
            }
        }
    }

    @ViewBuilder
    private func marker(_ marker: MarkdownListItem.Marker) -> some View {
        switch marker {
        case .bullet: Text("•")
        case .number(let value): Text("\(value).").monospacedDigit()
        case .task(let checked):
            Image(systemName: checked ? "checkmark.square.fill" : "square")
                .font(.callout)
                .accessibilityLabel(checked ? "Completed" : "Not completed")
        }
    }
}

/// Native selectable text keeps the same layout and link interaction while
/// streaming and after completion. Links retain their authored labels.
struct InlineText: View {
    @Environment(WorkspaceFileLinks.self) private var fileLinks: WorkspaceFileLinks?
    @Environment(\.transcriptSkills) private var skills
    @ScaledMetric(relativeTo: .body) private var skillIconSize: CGFloat = 18
    let text: String
    let isStreaming: Bool

    init(_ text: String, isStreaming: Bool = false) {
        self.text = text
        self.isStreaming = isStreaming
    }

    var body: some View {
        Self.renderedText(Self.linkedAttributed(from: text, isStreaming: isStreaming,
            resolvedPaths: fileLinks?.paths ?? [:], skills: skills), skillIconSize: skillIconSize)
            .tint(DS.Color.link)
    }

    static func fileCandidates(in text: String) -> [String] {
        fileRanges(in: attributed(from: text) ?? AttributedString(text)).map { $0.reference.path }
    }

    static func linkedAttributed(from text: String, isStreaming: Bool = false, resolvedPaths: [String: String], skills: [MessageSkill] = []) -> AttributedString {
        var result = attributed(from: text, isStreaming: isStreaming) ?? AttributedString(text)
        SkillMention.decorate(&result, skills: skills)
        for entry in fileRanges(in: result) {
            guard let path = resolvedPaths[entry.reference.path],
                  let url = entry.reference.url(resolvedPath: path) else {
                // A Mac path is not an iPhone URL. Only verified workspace
                // references get an action; web links remain unchanged.
                result[entry.range].link = nil
                result[entry.range].foregroundColor = nil
                continue
            }
            result[entry.range].link = url
            result[entry.range].font = .body.weight(.medium)
            result[entry.range].foregroundColor = DS.Color.link
            result[entry.range].backgroundColor = nil
            result[entry.range].underlineStyle = nil
            result[entry.range].inlinePresentationIntent?.remove(.code)
        }
        return result
    }

    private static func renderedText(_ attributed: AttributedString, skillIconSize: CGFloat) -> Text {
        var result = Text("")
        for run in attributed.runs {
            let content = Text(AttributedString(attributed[run.range]))
            if let label = run[SkillMentionAttribute.self] {
                result = Text("\(result)\(SkillMention.text(label, iconSize: skillIconSize))")
            } else if let url = run.link, let selected = WorkspaceFileSelection(url: url),
               let reference = MarkdownFileReference(selected.path) {
                let icon: Text
                switch reference.typeLabel {
                case "React": icon = Text(Image(systemName: "atom"))
                case "Swift": icon = Text(Image(systemName: "swift"))
                case "File": icon = Text(Image(systemName: "doc"))
                default: icon = Text(verbatim: reference.typeLabel)
                }
                result = Text("\(result)\(icon.font(.caption2.weight(.semibold)).foregroundStyle(DS.Color.link)) \(content)")
            } else {
                result = Text("\(result)\(content)")
            }
        }
        return result
    }

    private static func fileRanges(in attributed: AttributedString) -> [(range: Range<AttributedString.Index>, reference: MarkdownFileReference)] {
        var result: [(Range<AttributedString.Index>, MarkdownFileReference)] = []
        for run in attributed.runs {
            guard run[SkillMentionAttribute.self] == nil else { continue }
            let code = run.inlinePresentationIntent?.contains(.code) == true
            if let link = run.link {
                if let reference = MarkdownFileReference(link.relativeString.removingPercentEncoding ?? link.relativeString) {
                    result.append((run.range, reference))
                }
            } else if code {
                if let reference = MarkdownFileReference(String(attributed[run.range].characters), inlineCode: true) {
                    result.append((run.range, reference))
                }
            } else {
                let text = String(attributed[run.range].characters)
                guard let expression = try? NSRegularExpression(pattern: #"[^\s<>`\[\]()]+"#) else { continue }
                let segment = AttributedString(attributed[run.range])
                for match in expression.matches(in: text, range: NSRange(text.startIndex..., in: text)) {
                    guard let stringRange = Range(match.range, in: text) else { continue }
                    let token = String(text[stringRange]).trimmingCharacters(in: CharacterSet(charactersIn: ",.;!?"))
                    guard let reference = MarkdownFileReference(token, inlineCode: true),
                          let local = Range(NSRange(location: match.range.location, length: (token as NSString).length), in: segment) else { continue }
                    let start = attributed.characters.index(run.range.lowerBound, offsetBy: segment.characters.distance(from: segment.startIndex, to: local.lowerBound))
                    let end = attributed.characters.index(start, offsetBy: token.count)
                    result.append((start..<end, reference))
                }
            }
        }
        return result
    }

    private final class AttrBox {
        let value: AttributedString
        init(_ value: AttributedString) { self.value = value }
    }
    private static let attrCache: NSCache<NSString, AttrBox> = {
        let cache = NSCache<NSString, AttrBox>()
        cache.countLimit = 256
        cache.totalCostLimit = 1024 * 1024
        return cache
    }()

    static func attributed(from text: String, isStreaming: Bool = false) -> AttributedString? {
        let source = isStreaming ? StreamingReveal.readableMarkdownTail(text) : text
        let key = source as NSString
        if let hit = attrCache.object(forKey: key) { return hit.value }
        guard var attributed = try? AttributedString(
            markdown: source,
            options: .init(interpretedSyntax: .inlineOnlyPreservingWhitespace)
        ) else { return nil }
        linkifyBareURLs(&attributed)
        for run in attributed.runs {
            if run.inlinePresentationIntent?.contains(.code) == true {
                attributed[run.range].font = .callout.monospaced()
                if run.link == nil {
                    attributed[run.range].backgroundColor = DS.Color.bgSubtle
                }
            }
            if run.link != nil {
                attributed[run.range].foregroundColor = DS.Color.link
                attributed[run.range].underlineStyle = nil
            }
        }
        attrCache.setObject(AttrBox(attributed), forKey: key, cost: text.utf8.count)
        return attributed
    }

    /// Plain URLs are links too; URL-shaped text inside code remains literal.
    private static func linkifyBareURLs(_ attributed: inout AttributedString) {
        let plain = String(attributed.characters)
        guard plain.contains("http") || plain.contains("www."),
              let detector = try? NSDataDetector(types: NSTextCheckingResult.CheckingType.link.rawValue)
        else { return }
        for match in detector.matches(in: plain, range: NSRange(plain.startIndex..., in: plain)) {
            guard let url = match.url, ["http", "https"].contains(url.scheme?.lowercased() ?? ""),
                  let range = Range(match.range, in: attributed) else { continue }
            let isCode = attributed[range].runs.contains { $0.inlinePresentationIntent?.contains(.code) == true }
            let isLinked = attributed[range].runs.contains { $0.link != nil }
            if !isCode && !isLinked { attributed[range].link = url }
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
                    .font(.caption.monospaced())
                    .foregroundStyle(.secondary)
                Spacer()
                CopyButton(text: code, size: 13)
            }
            .padding(.leading, 14)
            .padding(.trailing, 4)
            // The header has no selectable text; disabling selection here
            // prevents taps from being swallowed by the selection gesture
            // instead of reaching the copy button.
            .textSelection(.disabled)
            ScrollView(.horizontal) {
                Text(verbatim: code)
                    .font(.footnote.monospaced())
                    .textSelection(.enabled)
                    .padding(14)
            }
        }
        .lineSpacing(3)
        .background(DS.Color.bgSubtle, in: .rect(cornerRadius: 12))
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
    private let minColumn: CGFloat = 112

    private var columnCount: Int { spec.header.count }

    var body: some View {
        let widths = resolvedColumnWidths
        ScrollView(.horizontal) {
            VStack(alignment: .leading, spacing: 0) {
                row(spec.header, isHeader: true, widths: widths)
                    .background(DS.Color.bgSubtle)
                hairline()
                ForEach(Array(spec.rows.enumerated()), id: \.offset) { index, cells in
                    row(cells, isHeader: false, widths: widths)
                    if index < spec.rows.count - 1 { hairline() }
                }
            }
            .frame(width: max(width, minColumn * CGFloat(columnCount)), alignment: .leading)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(DS.Color.bgElevated)
        .clipShape(RoundedRectangle(cornerRadius: radius))
        .onGeometryChange(for: CGFloat.self) { $0.size.width } action: { width = $0 }
        // A table isn't prose — drop the inherited reading line spacing so
        // wrapped cells stay tight.
        .lineSpacing(2)
    }

    /// Per-column widths: a `minColumn` floor for every column, then the
    /// remaining width split by each column's longest cell (character count,
    /// clamped so one long cell can't starve the rest). Nil until the width is
    /// known — the first frame falls back to equal flexible columns.
    private var resolvedColumnWidths: [CGFloat]? {
        guard columnCount > 0 else { return nil }
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
            .font(isHeader ? .subheadline.weight(.semibold) : .subheadline)
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
