import SwiftUI
import UIKit

/// Generative UI: the agent emits a fenced block —
///
///     ```card
///     { "title": "Daily Brief", "symbol": "sun.max",
///       "stats": [{ "label": "Meetings", "value": 3 }],
///       "items": [{ "title": "Standup", "subtitle": "9:30 — Zoom",
///                   "symbol": "video", "url": "https://…" }],
///       "footer": "Updated just now" }
///     ```
///
/// — and the chat renders this native card. All fields optional; values
/// accept strings or numbers. White card surface with a hairline border.
/// Icons are SF Symbols via `symbol`; emoji fields are accepted in the schema
/// for compatibility but ignored by the renderer.
struct CardSpec: Decodable, Equatable {
    var title: String?
    var subtitle: String?
    var emoji: String?
    var symbol: String?
    var image: String?
    var url: String?
    var footer: String?
    var stats: [Stat]?
    var items: [Item]?
    /// Rich sub-cards rendered as a horizontal carousel (image, badge, title,
    /// description, CTA) — the "hotels in Paris" layout. When present, the
    /// card renders bare: header text above free-floating white cards.
    var cards: [SubCard]?
    /// A native chart rendered in the card body (bars, line, diverging, meter,
    /// grouped/horizontal bars, heatmap). See `ChartSpec` / `GenerativeChartView`.
    var chart: ChartSpec?
    /// An ordered, composable body: the agent stacks any combination of typed
    /// blocks (metric, progress, checklist, bars, compare, …) inside the one
    /// card frame. When present and non-empty, `blocks` is the card body and the
    /// legacy body fields (`image`, `stats`, `chart`, `items`) are ignored;
    /// `title` / `subtitle` / `footer` still frame it. See `CardBlock`.
    var blocks: [CardBlock]?

    struct Stat: Decodable, Equatable {
        var label: String?
        var value: FlexibleString?
    }

    struct Item: Decodable, Equatable {
        var title: String?
        var subtitle: String?
        var value: FlexibleString?
        var emoji: String?
        var symbol: String?
        var url: String?
    }

    struct SubCard: Decodable, Equatable {
        var title: String?
        var subtitle: String?
        var image: String?
        var badge: String?
        var cta: String?
        var url: String?
    }

    static func parse(_ json: String) -> CardSpec? {
        guard let data = json.data(using: .utf8),
              let spec = try? JSONDecoder().decode(CardSpec.self, from: data)
        else { return nil }
        // An all-empty object is not a card — treat as parse failure so the
        // fence falls back to a code block.
        guard spec.title != nil
            || spec.items?.isEmpty == false
            || spec.stats?.isEmpty == false
            || spec.cards?.isEmpty == false
            || spec.chart?.kind != nil
            || spec.blocks?.contains(where: { $0.rendersContent }) == true
        else { return nil }
        return spec
    }
}

/// Resolves the agent's icon fields, ignoring emoji and invented symbol names
/// ("WMG") that aren't in the SF catalog.
enum CardIcon: Equatable {
    case symbol(String)

    static func resolve(emoji _: String?, symbol: String?) -> CardIcon? {
        if let symbol, !symbol.isEmpty {
            if UIImage(systemName: symbol) != nil { return .symbol(symbol) }
        }
        return nil
    }

    /// Quiet circular chip so icons never change the rhythm of what's next to
    /// them.
    @ViewBuilder
    func chip(size: CGFloat = 32) -> some View {
        Group {
            switch self {
            case .symbol(let symbol):
                Image(systemName: symbol)
                    .font(.system(size: size * 0.47, weight: .medium))
                    .foregroundStyle(DS.Color.fgMuted)
            }
        }
        .frame(width: size, height: size)
        .background(DS.Color.bgSubtle, in: .circle)
    }
}

/// Accepts a JSON string, number, or bool wherever display text is expected.
struct FlexibleString: Decodable, Equatable {
    let value: String

    init(from decoder: Decoder) throws {
        let container = try decoder.singleValueContainer()
        if let string = try? container.decode(String.self) {
            value = string
        } else if let int = try? container.decode(Int.self) {
            value = String(int)
        } else if let double = try? container.decode(Double.self) {
            value = double.truncatingRemainder(dividingBy: 1) == 0
                ? String(Int(double))
                : String(format: "%.2f", double)
        } else if let bool = try? container.decode(Bool.self) {
            value = bool ? "Yes" : "No"
        } else {
            value = ""
        }
    }
}

struct GenerativeCardView: View {
    let spec: CardSpec
    @Environment(\.openURL) private var openURL
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    /// Drives the staggered cascade as the card settles in — when it replaces
    /// its streaming placeholder, or on first paint. Flips true on appear.
    @State private var shown = false

    var body: some View {
        Group {
            if let cards = spec.cards, !cards.isEmpty {
                carouselLayout(cards)
            } else {
                boxedLayout
            }
        }
        // Fade the whole surface in together so the background never pops in
        // ahead of the cascading contents.
        .opacity(shown ? 1 : 0)
        .animation(reduceMotion ? DS.Motion.fast : DS.Motion.appear, value: shown)
        .onAppear { shown = true }
    }

    /// The boxed register: one white card frame holding a header, a composable
    /// body, and a footer. The body is either an ordered `blocks` stack (the
    /// flexible path) or the legacy fixed-order fields — never both.
    private var boxedLayout: some View {
        VStack(alignment: .leading, spacing: 14) {
            header
                .riseIn(shown, delay: 0)
            if let blocks = renderableBlocks {
                ForEach(Array(blocks.enumerated()), id: \.offset) { index, block in
                    CardBlockView(block: block, shown: shown,
                                  delay: 0.06 + Double(index) * 0.06)
                }
            } else {
                legacyBody
            }
            if let footer = spec.footer {
                Text(footer)
                    .font(DS.Font.caption)
                    .foregroundStyle(DS.Color.fgSubtle)
                    .riseIn(shown, delay: footerDelay)
            }
        }
        .padding(DS.Space.s2)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(DS.Color.bgElevated, in: .rect(cornerRadius: DS.Radius.lg))
        .overlay(
            RoundedRectangle(cornerRadius: DS.Radius.lg)
                .strokeBorder(DS.Color.border, lineWidth: 1)
        )
        .contentShape(.rect(cornerRadius: DS.Radius.lg))
        .onTapGesture {
            if let raw = spec.url, let url = URL(string: raw) { openURL(url) }
        }
    }

    /// The composable body, when the agent supplied one — `nil` (use the legacy
    /// body) unless at least one block actually resolves to something to draw.
    private var renderableBlocks: [CardBlock]? {
        guard let blocks = spec.blocks?.filter({ $0.rendersContent }), !blocks.isEmpty
        else { return nil }
        return blocks
    }

    /// The original fixed-order body — hero image, stat columns, one chart, then
    /// tappable rows. Used whenever the card has no `blocks`.
    @ViewBuilder
    private var legacyBody: some View {
        if let image = spec.image, let url = URL(string: image) {
            AsyncImage(url: url) { phase in
                if case .success(let loaded) = phase {
                    loaded.resizable().scaledToFill()
                } else {
                    Color.clear
                }
            }
            .frame(maxWidth: .infinity)
            .frame(height: 150)
            .clipShape(.rect(cornerRadius: DS.Radius.md))
            .riseIn(shown, delay: 0.04)
        }
        if let stats = spec.stats, !stats.isEmpty {
            statsBlock(Array(stats.prefix(4)))
        }
        if let chart = spec.chart, chart.kind != nil {
            GenerativeChartView(spec: chart)
                .riseIn(shown, delay: 0.1)
        }
        if let items = spec.items, !items.isEmpty {
            // Icons are all-or-nothing: one icon-less row would sit flush
            // against indented neighbors and break the left edge.
            let allHaveIcons = items.allSatisfy {
                CardIcon.resolve(emoji: $0.emoji, symbol: $0.symbol) != nil
            }
            VStack(alignment: .leading, spacing: 2) {
                ForEach(Array(items.enumerated()), id: \.offset) { index, item in
                    CardItemRow(item: item, showIcon: allHaveIcons)
                        .riseIn(shown, delay: 0.12 + Double(index) * 0.05)
                }
            }
        }
    }

    /// Footer settles in after the body's last element, whichever body it is.
    private var footerDelay: Double {
        if let blocks = renderableBlocks {
            return 0.12 + Double(blocks.count) * 0.06
        }
        return 0.12 + Double(spec.items?.count ?? 0) * 0.05
    }

    /// The carousel register: bare header text above free-floating white
    /// sub-cards that scroll horizontally — the "hotels in Paris" layout.
    private func carouselLayout(_ cards: [CardSpec.SubCard]) -> some View {
        VStack(alignment: .leading, spacing: 12) {
            if spec.title != nil || spec.subtitle != nil {
                VStack(alignment: .leading, spacing: 2) {
                    if let title = spec.title {
                        Text(title)
                            .font(DS.Font.title3)
                            .foregroundStyle(DS.Color.fg)
                    }
                    if let subtitle = spec.subtitle {
                        Text(subtitle)
                            .font(DS.Font.footnote)
                            .foregroundStyle(DS.Color.fgSubtle)
                    }
                }
                .riseIn(shown, delay: 0)
            }
            ScrollView(.horizontal, showsIndicators: false) {
                HStack(alignment: .top, spacing: 12) {
                    ForEach(Array(cards.prefix(10).enumerated()), id: \.offset) { index, card in
                        SubCardView(card: card)
                            .riseIn(shown, delay: 0.05 + Double(index) * 0.06)
                    }
                }
            }
            .scrollClipDisabled()
            if let footer = spec.footer {
                Text(footer)
                    .font(DS.Font.caption)
                    .foregroundStyle(DS.Color.fgSubtle)
                    .riseIn(shown, delay: 0.2)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    /// Stats render in one of two registers: short values ("3", "64°") as big
    /// columns; anything longer as quiet key–value rows so editorial text
    /// never blows up into giant truncated headlines.
    @ViewBuilder
    private func statsBlock(_ stats: [CardSpec.Stat]) -> some View {
        if stats.allSatisfy({ ($0.value?.value ?? "—").count <= 10 }) {
            HStack(alignment: .firstTextBaseline, spacing: DS.Space.s2) {
                ForEach(Array(stats.enumerated()), id: \.offset) { index, stat in
                    StatColumn(stat: stat)
                        .riseIn(shown, delay: 0.06 + Double(index) * 0.04)
                }
            }
        } else {
            VStack(alignment: .leading, spacing: 7) {
                ForEach(Array(stats.enumerated()), id: \.offset) { index, stat in
                    HStack(alignment: .firstTextBaseline, spacing: 12) {
                        Text(stat.label ?? "")
                            .font(DS.Font.footnote)
                            .foregroundStyle(DS.Color.fgSubtle)
                            .frame(width: 88, alignment: .leading)
                        Text(stat.value?.value ?? "—")
                            .font(DS.Font.subhead)
                            .foregroundStyle(DS.Color.fg)
                    }
                    .riseIn(shown, delay: 0.06 + Double(index) * 0.04)
                }
            }
        }
    }

    @ViewBuilder
    private var header: some View {
        if hasHeader {
            HStack(spacing: 10) {
                if let icon = CardIcon.resolve(emoji: spec.emoji, symbol: spec.symbol) {
                    icon.chip()
                }
                VStack(alignment: .leading, spacing: 1) {
                    if let title = spec.title {
                        Text(title)
                            .font(DS.Font.headline)
                            .foregroundStyle(DS.Color.fg)
                    }
                    if let subtitle = spec.subtitle {
                        Text(subtitle)
                            .font(DS.Font.footnote)
                            .foregroundStyle(DS.Color.fgSubtle)
                    }
                }
                Spacer(minLength: 0)
            }
        }
    }

    private var hasHeader: Bool {
        spec.title != nil
            || spec.subtitle != nil
            || CardIcon.resolve(emoji: spec.emoji, symbol: spec.symbol) != nil
    }
}

/// One big-number stat column — only short values reach this register;
/// longer strings render as key–value rows in `statsBlock`. Shared with the
/// `stats` block in `GenerativeCardBlocks.swift`.
struct StatColumn: View {
    let stat: CardSpec.Stat

    var body: some View {
        VStack(alignment: .leading, spacing: 2) {
            Text(stat.value?.value ?? "—")
                .font(DS.Font.title3)
                .monospacedDigit()
                .foregroundStyle(DS.Color.fg)
                .lineLimit(1)
            if let label = stat.label {
                Text(label)
                    .font(DS.Font.caption)
                    .foregroundStyle(DS.Color.fgSubtle)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }
}

/// One carousel sub-card: image, badge chip, title, description. White
/// surface with the hairline card anatomy. The entire card is the tap
/// target — no CTA button. Press feedback via `PressableButtonStyle`.
private struct SubCardView: View {
    let card: CardSpec.SubCard
    @Environment(\.openURL) private var openURL

    var body: some View {
        Button {
            if let raw = card.url, let url = URL(string: raw) { openURL(url) }
        } label: {
            VStack(alignment: .leading, spacing: 8) {
                if let image = card.image, let url = URL(string: image) {
                    AsyncImage(url: url) { phase in
                        if case .success(let loaded) = phase {
                            loaded.resizable().scaledToFill()
                        } else {
                            DS.Color.bgSubtle
                        }
                    }
                    .frame(width: 226, height: 140)
                    .clipShape(.rect(cornerRadius: DS.Radius.md))
                }
                if let badge = card.badge {
                    Text(badge).dsChip()
                }
                if let title = card.title {
                    Text(title)
                        .font(DS.Font.headline)
                        .foregroundStyle(DS.Color.fg)
                        .lineLimit(2)
                }
                if let subtitle = card.subtitle {
                    Text(subtitle)
                        .font(DS.Font.footnote)
                        .foregroundStyle(DS.Color.fgSubtle)
                        .lineLimit(3, reservesSpace: true)
                }
            }
            .padding(10)
            .frame(width: 246, alignment: .leading)
            .background(DS.Color.bgElevated, in: .rect(cornerRadius: DS.Radius.lg))
            .overlay(
                RoundedRectangle(cornerRadius: DS.Radius.lg)
                    .strokeBorder(DS.Color.border, lineWidth: 1)
            )
        }
        .buttonStyle(PressableButtonStyle())
        .disabled(card.url == nil)
    }
}

/// A tappable list row. Shared with the `rows` block in
/// `GenerativeCardBlocks.swift`.
struct CardItemRow: View {
    let item: CardSpec.Item
    var showIcon = true
    @Environment(\.openURL) private var openURL

    /// Models often leave the link in prose ("https://…" in the subtitle)
    /// instead of the `url` field; the row still opens it rather than
    /// rendering a dead lead.
    static func resolvedURL(for item: CardSpec.Item) -> URL? {
        if let raw = item.url, let url = URL(string: raw) { return url }
        for text in [item.subtitle, item.title] {
            if let text, let url = LinkExtractor.urls(inText: text).first {
                return url
            }
        }
        return nil
    }

    var body: some View {
        let resolvedURL = Self.resolvedURL(for: item)
        Button {
            if let resolvedURL { openURL(resolvedURL) }
        } label: {
            HStack(spacing: 10) {
                if showIcon, let icon = CardIcon.resolve(emoji: item.emoji, symbol: item.symbol) {
                    icon.chip(size: 26)
                }
                VStack(alignment: .leading, spacing: 1) {
                    if let title = item.title {
                        Text(title)
                            .font(DS.Font.callout)
                            .foregroundStyle(DS.Color.fg)
                            .multilineTextAlignment(.leading)
                    }
                    if let subtitle = item.subtitle {
                        Text(subtitle)
                            .font(DS.Font.footnote)
                            .foregroundStyle(DS.Color.fgSubtle)
                            .multilineTextAlignment(.leading)
                    }
                }
                Spacer(minLength: 0)
                if let value = item.value?.value, !value.isEmpty {
                    Text(value)
                        .font(DS.Font.subhead)
                        .foregroundStyle(DS.Color.fgMuted)
                }
            }
            .padding(.vertical, 5)
            .contentShape(.rect)
        }
        .buttonStyle(PressableButtonStyle())
        .disabled(resolvedURL == nil)
    }
}

/// Shimmer placeholder while a card fence is still streaming in — the raw
/// JSON never flashes on screen.
struct CardPlaceholderView: View {
    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            ShimmerText(text: "Composing card", font: .subheadline.weight(.medium))
            VStack(alignment: .leading, spacing: 8) {
                placeholderBar(width: 200)
                placeholderBar(width: 130)
                placeholderBar(width: 160)
            }
        }
        .padding(DS.Space.s2)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(DS.Color.bgElevated, in: .rect(cornerRadius: DS.Radius.lg))
        .overlay(
            RoundedRectangle(cornerRadius: DS.Radius.lg)
                .strokeBorder(DS.Color.border, lineWidth: 1)
        )
    }

    private func placeholderBar(width: CGFloat) -> some View {
        RoundedRectangle(cornerRadius: 4)
            .fill(DS.Color.border)
            .frame(width: width, height: 10)
    }
}

/// Quiet notice for a card fence that finished streaming but didn't parse —
/// the malformed JSON stays out of the transcript entirely.
struct CardFailureView: View {
    var body: some View {
        HStack(spacing: 7) {
            Image(systemName: "rectangle.dashed")
                .font(.system(size: 13, weight: .medium))
            Text("Couldn't display this card")
                .font(DS.Font.footnote)
        }
        .foregroundStyle(DS.Color.fgSubtle)
        .padding(.horizontal, DS.Space.s2)
        .padding(.vertical, 10)
        .background(DS.Color.bgSubtle, in: .rect(cornerRadius: DS.Radius.md))
        .overlay(
            RoundedRectangle(cornerRadius: DS.Radius.md)
                .strokeBorder(DS.Color.border, lineWidth: 1)
        )
    }
}
