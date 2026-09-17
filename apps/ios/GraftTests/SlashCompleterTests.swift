import XCTest
import UIKit

@testable import Graft

@MainActor
final class SlashCompleterTests: XCTestCase {
    func testSkillTokenRoundTripsArgumentsAndUnicodeWithoutSendingAttachmentCharacters() {
        let command = ComposerCommand(name: "swiftui-specialist", description: "Native SwiftUI", kind: "skill")
        let raw = "/swiftui-specialist Fix café 👋\nKeep formatting."
        let rendered = ComposerSkillText.render(raw, skill: command, font: nil)
        XCTAssertTrue(rendered.attribute(.attachment, at: 0, effectiveRange: nil) is ComposerSkillAttachment)
        XCTAssertEqual(ComposerSkillText.plainText(rendered), raw)
        XCTAssertEqual(command.skillLabel, "Swiftui Specialist")
        XCTAssertNil(rendered.attribute(.underlineStyle, at: 0, effectiveRange: nil))

        let edited = NSMutableAttributedString(attributedString: rendered)
        edited.replaceCharacters(in: NSRange(location: 2, length: 3), with: "Update")
        XCTAssertEqual(ComposerSkillText.plainText(edited), "/swiftui-specialist Update café 👋\nKeep formatting.")
        edited.deleteCharacters(in: NSRange(location: 0, length: 1))
        XCTAssertEqual(ComposerSkillText.plainText(edited), " Update café 👋\nKeep formatting.")
    }

    func testSelectedSkillOnlyDecoratesExactLeadingInvocation() {
        let command = ComposerCommand(name: "review", description: "Review changes", kind: "skill")
        for raw in ["/review-other fix", "hello /review", "/unknown fix"] {
            let rendered = ComposerSkillText.render(raw, skill: command, font: nil)
            XCTAssertNil(rendered.attribute(.attachment, at: 0, effectiveRange: nil))
            XCTAssertEqual(rendered.string, raw)
        }
    }

    func testEditingAndDictationPreserveSkillAndSelection() {
        let command = ComposerCommand(name: "review", description: "Review changes", kind: "skill")
        let editor = ComposerUITextView()
        editor.setDraft("/review fix chat", skill: command)
        let controller = ComposerTextController()
        controller.textView = editor
        editor.selectedRange = NSRange(location: 6, length: 4)
        controller.insert("streaming")
        XCTAssertEqual(ComposerSkillText.plainText(editor.attributedText), "/review fix streaming")
        let selection = editor.selectedRange
        XCTAssertFalse(editor.setDraft("/review fix streaming", skill: command))
        XCTAssertEqual(editor.selectedRange, selection)
        editor.setDraft("", skill: command)
        XCTAssertEqual(editor.attributedText.length, 0)
        editor.setDraft("/review fix streaming", skill: command)
        XCTAssertTrue(editor.attributedText.attribute(.attachment, at: 0, effectiveRange: nil) is ComposerSkillAttachment)
    }

    func testPreviewHidesFrontmatterButKeepsMarkdownInstructions() {
        XCTAssertEqual(SkillPreviewSheet.instructions(in: "---\r\nname: review\r\n---\r\n# Review\r\nDo this."), "# Review\nDo this.")
        XCTAssertEqual(SkillPreviewSheet.instructions(in: "# Review\nDo this."), "# Review\nDo this.")
    }

    func testSearchTermOnlyAcceptsLeadingCommandToken() {
        XCTAssertEqual(SlashCompleter.searchTerm("/"), "")
        XCTAssertEqual(SlashCompleter.searchTerm("/mod"), "mod")
        XCTAssertNil(SlashCompleter.searchTerm(" /mod"))
        XCTAssertNil(SlashCompleter.searchTerm("/model now"))
        XCTAssertNil(SlashCompleter.searchTerm("hello /model"))
    }

    func testLoadsOnceFiltersSearchAndClears() async throws {
        let completer = SlashCompleter()
        var loadCount = 0
        completer.update(query: "/", contextKey: "thread:openai") {
            loadCount += 1
            return Self.commands
        }

        try await waitUntil { !completer.isLoading }
        XCTAssertEqual(loadCount, 1)
        XCTAssertEqual(completer.items.map(\.name), ["model", "review", "fix", "tasks"])

        completer.update(query: "/rev", contextKey: "thread:openai") {
            XCTFail("Loaded catalog should be reused while context is unchanged")
            return []
        }
        XCTAssertEqual(completer.items.map(\.name), ["review"])

        completer.update(query: "plain text", contextKey: "thread:openai") {
            XCTFail("Invalid slash text should clear without loading")
            return []
        }
        XCTAssertFalse(completer.isLoading)
        XCTAssertTrue(completer.items.isEmpty)
        XCTAssertNil(completer.error)
    }

    func testContextChangeCancelsStaleCompletion() async throws {
        let completer = SlashCompleter()
        let firstLoadStarted = expectation(description: "first load started")
        let firstLoadMayReturn = expectation(description: "first load may return")
        var firstLoadCount = 0
        var secondLoadCount = 0

        completer.update(query: "/", contextKey: "thread:openai") {
            firstLoadCount += 1
            firstLoadStarted.fulfill()
            await self.fulfillment(of: [firstLoadMayReturn], timeout: 1)
            return [ComposerCommand(name: "stale", description: "Old provider command", kind: "native")]
        }
        await fulfillment(of: [firstLoadStarted], timeout: 1)

        completer.update(query: "/mod", contextKey: "thread:anthropic") {
            secondLoadCount += 1
            return Self.commands
        }
        firstLoadMayReturn.fulfill()

        try await waitUntil { !completer.isLoading }
        XCTAssertEqual(firstLoadCount, 1)
        XCTAssertEqual(secondLoadCount, 1)
        XCTAssertEqual(completer.items.map(\.name), ["model"])
        XCTAssertFalse(completer.items.contains { $0.name == "stale" })
    }

    func testLoadFailureIsReportedAndInvalidTextClearsError() async throws {
        enum FixtureError: Error { case failed }
        let completer = SlashCompleter()
        completer.update(query: "/", contextKey: "thread:openai") {
            throw FixtureError.failed
        }

        try await waitUntil { !completer.isLoading }
        XCTAssertEqual(completer.error, "Commands could not load. Reopen / to retry.")
        XCTAssertTrue(completer.items.isEmpty)

        completer.update(query: "message", contextKey: "thread:openai") { Self.commands }
        XCTAssertNil(completer.error)
        XCTAssertTrue(completer.items.isEmpty)
    }

    func testPrefetchAndReopeningUseOneCatalogWithoutWaitingForAnotherRequest() async throws {
        let completer = SlashCompleter()
        var requests = 0
        completer.prefetch(contextKey: "t1:codex") {
            requests += 1
            return Self.commands
        }
        try await waitUntil { !completer.isLoading }
        XCTAssertTrue(completer.items.isEmpty, "Prefetch must not present the palette")
        for query in ["/", "/fix ", "plain text", "/"] {
            completer.update(query: query, contextKey: "t1:codex") {
                XCTFail("Reopening must use the prefetched catalog")
                return []
            }
        }
        XCTAssertEqual(requests, 1)
        XCTAssertEqual(completer.items, Self.commands)
        XCTAssertFalse(completer.isLoading)
    }

    func testClosingPaletteDoesNotCancelInflightPrefetch() async throws {
        let completer = SlashCompleter()
        var finish: CheckedContinuation<[ComposerCommand], Never>?
        completer.prefetch(contextKey: "t1:codex") {
            await withCheckedContinuation { finish = $0 }
        }
        try await waitUntil { finish != nil }
        for query in ["/", "", "/fi"] {
            completer.update(query: query, contextKey: "t1:codex") {
                XCTFail("A pending request must be shared")
                return []
            }
        }
        finish?.resume(returning: Self.commands)
        try await waitUntil { !completer.isLoading }
        XCTAssertEqual(completer.items.map(\.name), ["fix"])
    }

    func testStaleCatalogRemainsVisibleDuringRefreshAndAfterRefreshFailure() async throws {
        enum Failure: Error { case offline }
        var clock = Date()
        let completer = SlashCompleter(now: { clock })
        completer.prefetch(contextKey: "t1:codex") { Self.commands }
        try await waitUntil { !completer.isLoading }
        clock = clock.addingTimeInterval(31)
        completer.update(query: "/", contextKey: "t1:codex") { throw Failure.offline }
        XCTAssertEqual(completer.items, Self.commands)
        XCTAssertTrue(completer.isLoading)
        try await waitUntil { !completer.isLoading }
        XCTAssertEqual(completer.items, Self.commands)
        XCTAssertNil(completer.error)
        completer.update(query: "/fi", contextKey: "t1:codex") {
            XCTFail("Failed refresh should not retry on every keystroke")
            return []
        }
        XCTAssertEqual(completer.items.map(\.name), ["fix"])
    }

    func testSentSkillOnlyDecoratesKnownExactInvocation() {
        let skill = MessageSkill(name: "swiftui-specialist", displayName: "SwiftUI Specialist")
        XCTAssertEqual(UserMessageText.leadingSkill(in: "/swiftui-specialist Fix chat", skills: [skill]), skill)
        XCTAssertEqual(UserMessageText.leadingSkill(in: "$swiftui-specialist Fix chat", skills: [skill]), skill)
        for text in ["/swiftui-specialist-extra Fix chat", "/tmp/file.swift", "/model", "plain text"] {
            XCTAssertNil(UserMessageText.leadingSkill(in: text, skills: [skill]))
        }
        XCTAssertNil(UserMessageText.leadingSkill(in: "/swiftui-specialist Fix chat", skills: []))
    }

    private func waitUntil(
        timeout: TimeInterval = 1,
        predicate: @escaping @MainActor () -> Bool
    ) async throws {
        let deadline = Date().addingTimeInterval(timeout)
        while Date() < deadline {
            if predicate() { return }
            try await Task.sleep(for: .milliseconds(10))
        }
        XCTFail("Timed out waiting for condition")
    }

    private static let commands = [
        ComposerCommand(name: "model", description: "Change model for the next turn", kind: "model"),
        ComposerCommand(name: "review", description: "Review the current diff", kind: "native"),
        ComposerCommand(name: "fix", description: "Fix the selected issue", kind: "native"),
        ComposerCommand(name: "tasks", description: "Show task progress", kind: "skill"),
    ]
}
