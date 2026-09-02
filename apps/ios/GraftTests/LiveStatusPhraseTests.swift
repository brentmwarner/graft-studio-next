import Testing
@testable import Graft

@MainActor
struct LiveStatusPhraseTests {
    @Test func defaultsToThinking() {
        #expect(LiveStatusPhrase.current(from: []) == "Thinking")
        #expect(LiveStatusPhrase.current(runningToolName: nil) == "Thinking")
        #expect(LiveStatusPhrase.current(runningToolName: "") == "Thinking")
        #expect(LiveStatusPhrase.current(runningToolName: "   ") == "Thinking")
        #expect(LiveStatusPhrase.current(runningToolName: nil, fallback: "  ") == "Thinking")
    }

    @Test func usesFallbackWhenNoToolIsRunning() {
        #expect(
            LiveStatusPhrase.current(from: [], fallback: "Compacting conversation")
                == "Compacting conversation"
        )
    }

    @Test func mapsRunningToolsToActionPhrases() {
        #expect(LiveStatusPhrase.current(runningToolName: "bash") == "Running a command")
        #expect(LiveStatusPhrase.current(runningToolName: "read") == "Reading files")
        #expect(LiveStatusPhrase.current(runningToolName: "write") == "Editing a file")
        #expect(LiveStatusPhrase.current(runningToolName: "web_search") == "Searching the web")
        #expect(LiveStatusPhrase.current(runningToolName: "  Image  ") == "Looking at an image")
        #expect(
            LiveStatusPhrase.current(
                runningToolName: "fetch",
                context: "https://nytimes.com/story"
            ) == "Reading nytimes.com"
        )
        #expect(
            LiveStatusPhrase.current(
                runningToolName: "fetch",
                context: #"fetch({"url":"https://example.com"})"#
            ) == "Reading example.com"
        )
    }

    @Test func tracksTheLatestRunningTool() {
        let items = [
            TranscriptItem.tool(id: "t1", name: "read", context: "a.swift", status: .done),
            TranscriptItem.tool(id: "t2", name: "bash", context: "pnpm test"),
        ]
        #expect(LiveStatusPhrase.current(from: items) == "Running a command")
    }

    @Test func returnsToThinkingWhenToolsSettle() {
        let items = [
            TranscriptItem.tool(id: "t1", name: "bash", context: "ls", status: .done),
            TranscriptItem.assistant("", streaming: true),
        ]
        #expect(LiveStatusPhrase.current(from: items) == "Thinking")
    }

    @Test func ignoresAStaleRunningToolFromAnEarlierTurn() {
        let items = [
            TranscriptItem.tool(id: "t1", name: "bash", context: "ls"),
            TranscriptItem.user("Try again"),
        ]
        #expect(LiveStatusPhrase.current(from: items) == "Thinking")
    }
}
