import UIKit
import SwiftUI

extension EnvironmentValues {
    @Entry var transcriptSkills: [MessageSkill] = []
}

/// Presentation metadata stays separate from the cached Markdown parse.
enum SkillMentionAttribute: AttributedStringKey {
    typealias Value = String
    static let name = "graft.skillMention"
}

enum SkillMention {
    private static let icons: NSCache<NSNumber, UIImage> = {
        let cache = NSCache<NSNumber, UIImage>()
        cache.countLimit = 16
        return cache
    }()

    /// Shared by sent messages and assistant prose, including Dynamic Type.
    static func text(_ label: String, iconSize: CGFloat) -> Text {
        let title = Text(verbatim: label).fontWeight(.medium)
        guard let icon = icon(size: iconSize) else { return title.foregroundColor(DS.Color.link) }
        let symbol = Text(Image(uiImage: icon)).baselineOffset(-iconSize / 6)
        return Text("\(symbol) \(title)").foregroundColor(DS.Color.link)
    }

    private static func icon(size: CGFloat) -> UIImage? {
        let key = NSNumber(value: Double(size))
        if let image = icons.object(forKey: key) { return image }
        guard let asset = UIImage(named: "SkillIcon") else { return nil }
        let image = UIGraphicsImageRenderer(size: CGSize(width: size, height: size)).image { _ in
            asset.draw(in: CGRect(x: 0, y: 0, width: size, height: size))
        }.withRenderingMode(.alwaysTemplate)
        icons.setObject(image, forKey: key)
        return image
    }

    /// Only skills actually attached to this conversation can become tokens.
    /// Inline code must contain just the reference; commands and URLs stay literal.
    static func decorate(_ attributed: inout AttributedString, skills: [MessageSkill]) {
        guard !skills.isEmpty else { return }
        let byName = Dictionary(skills.map { ($0.name, $0) }, uniquingKeysWith: { first, next in
            next.displayName == nil ? first : next
        })
        let names = byName.keys.filter { !$0.isEmpty }
            .sorted { $0.count > $1.count }
            .map(NSRegularExpression.escapedPattern(for:)).joined(separator: "|")
        guard !names.isEmpty else { return }
        // Exact boundaries reject longer names, shell variables, and path fragments.
        // A sentence-ending period or colon can still follow a mention.
        let expression = try? NSRegularExpression(
            pattern: #"(?<![\p{L}\p{N}\p{M}_$./\\@-])[$/]("# + names
                + #")(?![\p{L}\p{N}\p{M}_$/\\-]|[.:][\p{L}\p{N}_])"#
        )
        var matches: [(Range<AttributedString.Index>, MessageSkill)] = []
        for run in attributed.runs where run.link == nil {
            let content = String(attributed[run.range].characters)
            if run.inlinePresentationIntent?.contains(.code) == true {
                let name = content.first == "$" || content.first == "/" ? String(content.dropFirst()) : content
                if let skill = byName[name] { matches.append((run.range, skill)) }
            } else if let expression, content.contains("$") || content.contains("/") {
                let segment = AttributedString(attributed[run.range])
                for match in expression.matches(in: content, range: NSRange(content.startIndex..., in: content)) {
                    guard let nameRange = Range(match.range(at: 1), in: content),
                          let skill = byName[String(content[nameRange])],
                          let local = Range(match.range, in: segment) else { continue }
                    let start = attributed.characters.index(run.range.lowerBound,
                        offsetBy: segment.characters.distance(from: segment.startIndex, to: local.lowerBound))
                    let end = attributed.characters.index(start,
                        offsetBy: segment.characters.distance(from: local.lowerBound, to: local.upperBound))
                    matches.append((start..<end, skill))
                }
            }
        }
        for (range, skill) in matches {
            attributed[range][SkillMentionAttribute.self] = skill.command.skillLabel
            attributed[range].font = nil
            attributed[range].foregroundColor = DS.Color.link
            attributed[range].backgroundColor = nil
            attributed[range].underlineStyle = nil
            attributed[range].inlinePresentationIntent?.remove(.code)
        }
    }
}
