import SwiftUI
import XCTest
@testable import Graft

final class MarkdownTextTests: XCTestCase {
    func testSoftWrapsReflowAndExplicitBreaksSurvive() throws {
        let blocks = MarkdownBlock.parse("First line\ncontinues here.  \nHard break\\\nAnother line.\n\nFinal paragraph.")
        XCTAssertEqual(blocks.count, 2)
        guard case .paragraph(let first) = blocks[0].kind,
              case .paragraph(let last) = blocks[1].kind else { return XCTFail("Expected paragraphs") }
        XCTAssertEqual(first, "First line continues here.\nHard break\nAnother line.")
        XCTAssertEqual(last, "Final paragraph.")
    }

    func testMixedNestedListsPreserveOrderNumbersAndTasks() {
        let blocks = MarkdownBlock.parse("3. Third step\n   - Nested bullet\n   - [x] Complete\n4) Fourth step\n   + [ ] Pending")
        guard blocks.count == 1, case .list(let items) = blocks[0].kind else { return XCTFail("Expected one list") }
        XCTAssertEqual(items.map(\.marker), [.number(3), .bullet, .task(true), .number(4), .task(false)])
        XCTAssertEqual(items.map(\.text), ["Third step", "Nested bullet", "Complete", "Fourth step", "Pending"])
        XCTAssertEqual(items.map(\.indent), [0, 3, 3, 0, 3])
        XCTAssertEqual(items.map(\.id), [0, 1, 2, 3, 4])
    }

    func testWrappedListContentStaysWithItsItem() {
        let blocks = MarkdownBlock.parse("1. A longer item\n   continues here.\n2. Next step")
        guard case .list(let items) = blocks.first?.kind else { return XCTFail("Expected list") }
        XCTAssertEqual(items.map(\.text), ["A longer item continues here.", "Next step"])
    }

    func testQuoteHasItsOwnBlockAndReflows() {
        let blocks = MarkdownBlock.parse("Before\n\n> Quoted context\n> continues here\n\nAfter")
        XCTAssertEqual(blocks.count, 3)
        guard case .quote(let text) = blocks[1].kind else { return XCTFail("Expected quote") }
        XCTAssertEqual(text, "Quoted context continues here")
    }

    func testUnfinishedCodeFenceKeepsIdentityWhenItCloses() {
        let partial = "Intro\n\n```swift\nlet value = 1"
        let streaming = MarkdownBlock.parse(partial)
        let settled = MarkdownBlock.parse(partial + "\n```\n\nFinished.")
        XCTAssertEqual(streaming.map(\.id), [0, 2])
        XCTAssertEqual(settled.map(\.id), [0, 2, 6])
        guard case .code(let language, let code) = streaming[1].kind,
              case .code(let finalLanguage, let finalCode) = settled[1].kind else { return XCTFail("Expected code") }
        XCTAssertEqual(language, "swift")
        XCTAssertEqual(code, "let value = 1")
        XCTAssertEqual(finalLanguage, language)
        XCTAssertEqual(finalCode, code)
    }

    func testLongAndTildeFencesDoNotCloseOnShorterMarkers() {
        let blocks = MarkdownBlock.parse("````text\n```\nexample\n````\n\n~~~sh\necho ok\n~~~")
        XCTAssertEqual(blocks.count, 2)
        guard case .code(_, let first) = blocks[0].kind,
              case .code(let language, let second) = blocks[1].kind else { return XCTFail("Expected code fences") }
        XCTAssertEqual(first, "```\nexample")
        XCTAssertEqual(language, "sh")
        XCTAssertEqual(second, "echo ok")
    }

    func testTableKeepsEscapedPipesAlignmentAndIncompleteRows() {
        let blocks = MarkdownBlock.parse("| Name | Count |\n| :--- | ---: |\n| A\\|B | 12 |\n| Pending |")
        guard case .table(let table) = blocks.first?.kind else { return XCTFail("Expected table") }
        XCTAssertEqual(table.header, ["Name", "Count"])
        XCTAssertEqual(table.rows, [["A|B", "12"], ["Pending", ""]])
        XCTAssertEqual(table.alignments, [.left, .right])
    }

    func testAuthoredLinksKeepTheirLabelsAndBlueStyle() throws {
        let text = try XCTUnwrap(InlineText.attributed(from: "Read [the guide](https://example.com/guide)."))
        XCTAssertEqual(String(text.characters), "Read the guide.")
        let link = try XCTUnwrap(text.runs.first { $0.link != nil })
        XCTAssertEqual(link.link?.absoluteString, "https://example.com/guide")
        XCTAssertEqual(link.foregroundColor, DS.Color.link)
        XCTAssertNil(link.underlineStyle)
    }

    func testCodeStyledLinkRemainsTappable() throws {
        let text = try XCTUnwrap(InlineText.attributed(from: "See [`guide.md`](https://example.com/guide)."))
        let link = try XCTUnwrap(text.runs.first { $0.link != nil })
        XCTAssertEqual(link.link?.absoluteString, "https://example.com/guide")
        XCTAssertEqual(link.foregroundColor, DS.Color.link)
        XCTAssertEqual(String(text.characters), "See guide.md.")
    }

    func testBareWebURLsLinkButCodeExamplesStayLiteral() throws {
        let text = try XCTUnwrap(InlineText.attributed(from: "Visit https://example.com and use `https://example.org` in code."))
        let links = text.runs.compactMap(\.link)
        XCTAssertEqual(links.map(\.absoluteString), ["https://example.com"])
        let code = try XCTUnwrap(text.runs.first { $0.inlinePresentationIntent?.contains(.code) == true })
        XCTAssertNil(code.link)
    }

    func testCompleteMarkdownHasIdenticalAttributesWhileStreamingAndSettled() throws {
        let source = "**Done.** Read [the guide](https://example.com) and run `pnpm dev`."
        XCTAssertEqual(
            try XCTUnwrap(InlineText.attributed(from: source, isStreaming: true)),
            try XCTUnwrap(InlineText.attributed(from: source, isStreaming: false))
        )
    }

    func testIncompleteLinkShowsLabelWhileStreamingWithoutChangingFinalSource() throws {
        let source = "See [the guide](https://example.com/pa"
        XCTAssertEqual(String(try XCTUnwrap(InlineText.attributed(from: source, isStreaming: true)).characters), "See the guide")
        XCTAssertEqual(String(try XCTUnwrap(InlineText.attributed(from: source)).characters), source)
    }
    func testVerifiedFileReferencesAreBlueLinksWithoutCodeStyling() throws {
        let source = "Read `src/Chat.tsx:42`, [the notes](docs/readme.md#L8), and `pnpm dev`."
        let text = InlineText.linkedAttributed(from: source, resolvedPaths: ["src/Chat.tsx": "src/Chat.tsx", "docs/readme.md": "docs/readme.md"])
        let files = text.runs.filter { $0.link?.scheme == "graft-file" }
        XCTAssertEqual(files.count, 2)
        XCTAssertEqual(files.compactMap { $0.link.flatMap(WorkspaceFileSelection.init)?.line }, [42, 8])
        for file in files {
            XCTAssertEqual(file.foregroundColor, DS.Color.link)
            XCTAssertNil(file.underlineStyle)
            XCTAssertNil(file.backgroundColor)
            XCTAssertNotEqual(file.inlinePresentationIntent?.contains(.code), true)
        }
        XCTAssertEqual(String(text.characters), "Read src/Chat.tsx:42, the notes, and pnpm dev.")
        let command = try XCTUnwrap(text.runs.first { String(text[$0.range].characters) == "pnpm dev" })
        XCTAssertNil(command.link)
        XCTAssertEqual(command.inlinePresentationIntent?.contains(.code), true)
    }

    func testUnknownFilesNeverBecomeDeadPhoneLinks() {
        let text = InlineText.linkedAttributed(from: "Read `missing.swift` or [missing](/Users/me/missing.md).", resolvedPaths: [:])
        XCTAssertTrue(text.runs.allSatisfy { $0.link == nil })
    }

    func testBareFileCandidatesRequireKnownFileTypesAndDoNotConsumeWebLinks() {
        let candidates = InlineText.fileCandidates(in: "See src/Chat.tsx, `README.md` and [web](https://example.com/readme.md). Use `value.property`, `1.2.3`, or `pnpm test`.")
        XCTAssertEqual(Set(candidates), ["src/Chat.tsx", "README.md"])
    }

    func testFileURLsAndLineReferencesPreserveLiteralSpaces() throws {
        let ref = try XCTUnwrap(MarkdownFileReference("file:///Users/me/My%20Project/README.md#L12"))
        XCTAssertEqual(ref.path, "/Users/me/My Project/README.md")
        XCTAssertEqual(ref.line, 12)
        let url = try XCTUnwrap(ref.url(resolvedPath: "My Project/README.md"))
        XCTAssertEqual(WorkspaceFileSelection(url: url)?.path, "My Project/README.md")
        XCTAssertEqual(WorkspaceFileSelection(url: url)?.line, 12)
        XCTAssertNil(MarkdownFileReference("https://example.com/source.ts"))
    }

    func testFileLinkFormattingMatchesStreamingAndCompletion() {
        let source = "Updated **the view** in `src/Chat.tsx` and [the guide](docs/readme.md)."
        let paths = ["src/Chat.tsx": "src/Chat.tsx", "docs/readme.md": "docs/readme.md"]
        XCTAssertEqual(InlineText.linkedAttributed(from: source, isStreaming: true, resolvedPaths: paths),
                       InlineText.linkedAttributed(from: source, resolvedPaths: paths))
    }

    func testAssistantSkillCodeReferencesUseTheSentSkillLabelAndBlueStyle() throws {
        let skill = MessageSkill(name: "frontend-design", displayName: "Frontend Design")
        for reference in ["$frontend-design", "/frontend-design", "frontend-design"] {
            let text = InlineText.linkedAttributed(from: "`\(reference)` is a UI implementation skill.",
                resolvedPaths: [:], skills: [skill])
            let mention = try XCTUnwrap(text.runs.first { $0[SkillMentionAttribute.self] != nil })
            XCTAssertEqual(mention[SkillMentionAttribute.self], skill.command.skillLabel)
            XCTAssertEqual(mention.foregroundColor, DS.Color.link)
            XCTAssertNil(mention.font, "Skill references inherit the prose font, not monospace")
            XCTAssertNil(mention.backgroundColor)
            XCTAssertNil(mention.underlineStyle)
            XCTAssertNil(mention.link, "A skill token does not invent an unresolved phone URL")
            XCTAssertNotEqual(mention.inlinePresentationIntent?.contains(.code), true)
        }
    }

    func testSkillReferencesInProseHandlePunctuationRepeatedMentionsAndUnicode() {
        let skills = [MessageSkill(name: "frontend-design"), MessageSkill(name: "café-ui", displayName: "Café UI")]
        let text = InlineText.linkedAttributed(
            from: "👋 Try ($frontend-design), then /frontend-design. Déjà vu: $café-ui!", resolvedPaths: [:], skills: skills)
        XCTAssertEqual(text.runs.compactMap { $0[SkillMentionAttribute.self] },
            ["Frontend Design", "Frontend Design", "Café UI"])
        XCTAssertEqual(String(text.characters), "👋 Try ($frontend-design), then /frontend-design. Déjà vu: $café-ui!")
    }

    func testSkillMentionsRequireExactNamesAndDoNotRewriteCommandsPathsOrWebLinks() throws {
        let source = """
        $frontend-design-pro $frontend-design.md $frontend-design/notes /tmp/frontend-design
        prefix$frontend-design $$frontend-design $unknown $PATH
        `echo $frontend-design` `frontend-design.ts` [$frontend-design](https://example.com)
        """
        let text = InlineText.linkedAttributed(from: source, resolvedPaths: [:], skills: [MessageSkill(name: "frontend-design")])
        XCTAssertTrue(text.runs.allSatisfy { $0[SkillMentionAttribute.self] == nil })
        let command = try XCTUnwrap(text.runs.first { String(text[$0.range].characters) == "echo $frontend-design" })
        XCTAssertEqual(command.inlinePresentationIntent?.contains(.code), true)
        XCTAssertNotNil(command.backgroundColor)
        XCTAssertEqual(text.runs.compactMap(\.link).map(\.absoluteString), ["https://example.com"])
    }

    func testSkillMentionsAndVerifiedFileLinksKeepIndependentStyles() {
        let source = "Use `$frontend-design` to update `src/Chat.tsx`, then visit https://example.com."
        let text = InlineText.linkedAttributed(from: source, resolvedPaths: ["src/Chat.tsx": "src/Chat.tsx"],
            skills: [MessageSkill(name: "frontend-design")])
        XCTAssertEqual(text.runs.compactMap { $0[SkillMentionAttribute.self] }, ["Frontend Design"])
        XCTAssertEqual(text.runs.compactMap(\.link).compactMap(WorkspaceFileSelection.init).map(\.path), ["src/Chat.tsx"])
        XCTAssertTrue(text.runs.contains { $0.link?.absoluteString == "https://example.com" })
    }

    func testSkillMentionContextDoesNotLeakIntoCachedMarkdownOrOtherChats() {
        let source = "`$frontend-design` is a skill."
        let first = InlineText.linkedAttributed(from: source, resolvedPaths: [:],
            skills: [MessageSkill(name: "frontend-design", displayName: "Frontend Design")])
        let second = InlineText.linkedAttributed(from: source, resolvedPaths: [:],
            skills: [MessageSkill(name: "frontend-design", displayName: "Web Design")])
        let unrelated = InlineText.linkedAttributed(from: source, resolvedPaths: [:])
        XCTAssertEqual(first.runs.compactMap { $0[SkillMentionAttribute.self] }, ["Frontend Design"])
        XCTAssertEqual(second.runs.compactMap { $0[SkillMentionAttribute.self] }, ["Web Design"])
        XCTAssertTrue(unrelated.runs.allSatisfy { $0[SkillMentionAttribute.self] == nil })
        XCTAssertTrue(unrelated.runs.contains { $0.inlinePresentationIntent?.contains(.code) == true })
    }

    func testSkillMentionFormattingIsIdenticalDuringStreamingAndAfterCompletion() {
        let source = "**Using** `$frontend-design` for this interface."
        let skills = [MessageSkill(name: "frontend-design")]
        XCTAssertEqual(InlineText.linkedAttributed(from: source, isStreaming: true, resolvedPaths: [:], skills: skills),
            InlineText.linkedAttributed(from: source, resolvedPaths: [:], skills: skills))
        let partial = InlineText.linkedAttributed(from: "Using `$front", isStreaming: true, resolvedPaths: [:], skills: skills)
        XCTAssertTrue(partial.runs.allSatisfy { $0[SkillMentionAttribute.self] == nil })
    }

    @MainActor
    func testTranscriptSkillContextUsesUserMetadataAndPreservesDisplayNames() {
        let skill = MessageSkill(name: "frontend-design", displayName: "Frontend Design")
        let first = TranscriptItem.user("/frontend-design Explain this", skills: [skill])
        let repeated = TranscriptItem.user("/frontend-design Again", skills: [MessageSkill(name: skill.name)])
        let assistant = TranscriptItem.assistant("`$frontend-design` is a skill.")
        assistant.skills = [MessageSkill(name: "unconfirmed")]
        XCTAssertEqual(TranscriptView.referencedSkills(in: [first, assistant, repeated]), [skill])
        XCTAssertTrue(TranscriptView.referencedSkills(in: [assistant]).isEmpty)
    }

}
