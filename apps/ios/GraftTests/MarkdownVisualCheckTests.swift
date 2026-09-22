import SwiftUI
import UIKit
import Vision
import XCTest

@testable import Graft

@MainActor
final class MarkdownVisualCheckTests: XCTestCase {
    func testInboxViewsCollapsedProjectsAndSearchOnPhoneAndIPad() async throws {
        func captureInbox(_ view: RemoteInboxScreen, width: CGFloat) async throws -> ViewCapture {
            let size = CGSize(width: width, height: 900)
            let controller = UIHostingController(rootView: view)
            let window = host(controller, size: size)
            defer {
                window.isHidden = true
                window.rootViewController = nil
            }
            // Allow the lazy stack and its accessibility tree to settle on iPadOS.
            try await Task.sleep(for: .milliseconds(250))
            controller.view.layoutIfNeeded()
            return captureHostedView(controller.view, size: size)
        }
        func visibleText(_ capture: ViewCapture) throws -> String {
            // Assert rendered text: detached SwiftUI test windows on iPadOS can
            // render correctly while exposing an empty accessibility tree.
            let request = VNRecognizeTextRequest()
            request.recognitionLevel = .accurate
            request.recognitionLanguages = ["en-US"]
            request.usesLanguageCorrection = false
            try VNImageRequestHandler(cgImage: XCTUnwrap(capture.image.cgImage)).perform([request])
            return (request.results ?? []).compactMap { $0.topCandidates(1).first?.string }
                .joined().lowercased().filter(\.isLetter)
        }
        let base = InboxGroupingTests.viewFixture
        let snapshot = EnvironmentSnapshot(environment: base.environment,
            projects: base.projects + [ProjectInfo(id: "chats", name: "Chats", kind: "desktop", path: nil)],
            threads: base.threads + [ThreadInfo(id: "chat", projectId: "chats", title: "Plan weekend", updatedAt: 1, status: "idle")],
            activeRuns: base.activeRuns, pendingApprovals: base.pendingApprovals,
            pendingQuestions: base.pendingQuestions, selectedTranscript: nil, cursor: base.cursor)
        let projects = InboxGrouping.projects(from: snapshot, searchQuery: "", unreadThreadIds: ["chat"])
        for width: CGFloat in [440, 384] {
            for mode in InboxViewMode.allCases {
                let view = RemoteInboxScreen(
                    projects: projects, isLoading: false, expandedProjectIds: .constant([]), mode: mode,
                    sections: InboxGrouping.sections(from: snapshot, mode: mode, searchQuery: "",
                        now: InboxGroupingTests.viewDate(20, hour: 12), calendar: InboxGroupingTests.viewCalendar),
                    onToggleProject: { _ in }, onSelectThread: { _ in }, onComposeInProject: { _ in }, onRefresh: {}
                )
                let capture = try await captureInbox(view, width: width)
                let attachment = XCTAttachment(image: capture.image)
                attachment.name = "Inbox-\(mode.rawValue)-\(Int(width))"
                attachment.lifetime = .keepAlways
                add(attachment)
                let text = try visibleText(capture)
                if mode == .project {
                    XCTAssertTrue(text.contains("graft"))
                    XCTAssertTrue(text.contains("chats"))
                    XCTAssertTrue(text.contains("planweekend"))
                    XCTAssertFalse(text.contains("todaynewest"), "Project children start collapsed.")
                } else {
                    XCTAssertTrue(text.contains("todaynewest"))
                    XCTAssertTrue(text.contains("today"))
                }
            }
        }
        let search = RemoteInboxScreen(
            projects: InboxGrouping.projects(from: snapshot, searchQuery: "newest"), isLoading: false,
            expandedProjectIds: .constant([]), searchQuery: "newest",
            onToggleProject: { _ in }, onSelectThread: { _ in }, onComposeInProject: { _ in }, onRefresh: {}
        )
        let capture = try await captureInbox(search, width: 440)
        XCTAssertTrue(try visibleText(capture).contains("todaynewest"), "Search reveals a match without opening all projects permanently.")
    }

    func testMarkdownProseVisualAttachments() throws {
        try renderFixtures(
            fixtureName: "prose",
            markdown: Self.proseFixture,
            height: 1_060
        )
    }

    func testMarkdownCodeAndTableVisualAttachments() throws {
        try renderFixtures(
            fixtureName: "code-table",
            markdown: Self.codeTableFixture,
            height: 1_020
        )
    }

    func testTranscriptStreamingAndSettledVisualAttachments() throws {
        let streaming = makeTranscriptScenario(settled: false)
        let settled = makeTranscriptScenario(settled: true)

        let streamingAssistant = try XCTUnwrap(streaming.chat.items.last { $0.kind == .assistant })
        let settledAssistant = try XCTUnwrap(settled.chat.items.last { $0.kind == .assistant })
        XCTAssertEqual(streamingAssistant.text, settledAssistant.text)
        XCTAssertEqual(settledAssistant.text, Self.transcriptAnswer)
        XCTAssertTrue(streaming.chat.isStreaming)
        XCTAssertTrue(streamingAssistant.isStreaming)
        XCTAssertEqual(streaming.chat.liveStatusText, "Thinking")
        XCTAssertFalse(streaming.chat.canChangeProvider)
        XCTAssertFalse(settled.chat.isStreaming)
        XCTAssertFalse(settled.chat.items.contains { $0.isStreaming })
        XCTAssertNil(settled.chat.liveStatusText)
        XCTAssertFalse(settled.chat.canChangeProvider)

        try renderTranscriptFixtures(name: "streaming", scenario: streaming)
        try renderTranscriptFixtures(name: "settled", scenario: settled)
    }

    func testSentSkillUserBubbleVisualAttachments() throws {
        let scenario = makeSentSkillUserBubbleScenario(
            text: "/tasks polish composer controls",
            skill: Self.tasksMessageSkill
        )
        let user = try XCTUnwrap(scenario.chat.items.last { $0.kind == .user })
        XCTAssertEqual(user.skills, [Self.tasksMessageSkill])
        XCTAssertEqual(UserMessageText.leadingSkill(in: user.text, skills: user.skills), Self.tasksMessageSkill)

        try renderSentSkillUserBubbleFixtures(
            name: "sent-skill-user-bubble",
            scenario: scenario,
            expectedLabel: "Tasks polish composer controls",
            variants: [
                .init(name: "light", colorScheme: .light, dynamicTypeSize: .large),
                .init(name: "dark", colorScheme: .dark, dynamicTypeSize: .large),
            ]
        )
    }

    func testSentSkillUserBubbleLongLabelWrapsVisualAttachments() throws {
        let longSkill = MessageSkill(
            name: "very-long-blueprint-review-skill",
            displayName: "Very Long Blueprint Review Skill"
        )
        let scenario = makeSentSkillUserBubbleScenario(
            text: "/very-long-blueprint-review-skill compare the active transcript chrome against desktop wrapping",
            skill: longSkill
        )
        let user = try XCTUnwrap(scenario.chat.items.last { $0.kind == .user })
        XCTAssertEqual(UserMessageText.leadingSkill(in: user.text, skills: user.skills), longSkill)

        try renderSentSkillUserBubbleFixtures(
            name: "sent-skill-user-bubble-long-label",
            scenario: scenario,
            expectedLabel: "Very Long Blueprint Review Skill compare the active transcript chrome against desktop wrapping",
            variants: [
                .init(name: "light-accessibility", colorScheme: .light, dynamicTypeSize: .accessibility1),
                .init(name: "dark-accessibility", colorScheme: .dark, dynamicTypeSize: .accessibility1),
            ]
        )
    }

    func testAssistantSkillReferenceStreamingAndSettledVisualAttachments() throws {
        let skill = Self.frontendDesignMessageSkill
        let variants: [MarkdownFixtureVariant] = [
            .init(name: "light", colorScheme: .light, dynamicTypeSize: .large),
            .init(name: "dark", colorScheme: .dark, dynamicTypeSize: .large),
        ]

        for variant in variants {
            let scenario = makeAssistantSkillReferenceScenario(
                skill: skill,
                answer: Self.assistantSkillReferenceAnswer,
                isStreaming: true
            )
            XCTAssertEqual(TranscriptView.referencedSkills(in: scenario.chat.items), [skill])
            let assistant = try XCTUnwrap(scenario.chat.items.last { $0.kind == .assistant })
            XCTAssertTrue(assistant.skills.isEmpty, "The assistant must receive skill metadata through TranscriptView.")
            XCTAssertTrue(assistant.isStreaming)

            let surface = TranscriptVisualFixture(chat: scenario.chat)
                .environment(scenario.app)
                .environment(\.colorScheme, variant.colorScheme)
                .environment(\.dynamicTypeSize, variant.dynamicTypeSize)
            let controller = UIHostingController(rootView: surface)
            let size = CGSize(width: 440, height: 956)
            let window = host(controller, size: size)
            defer {
                window.isHidden = true
                window.rootViewController = nil
            }

            let paragraph = "Frontend Design is a UI implementation skill for building polished web interfaces."
            let expectedLabels = [
                "Frontend Design what does this skill do?",
                paragraph,
                "Use Frontend Design for the next page.",
            ]
            let streaming = captureHostedView(controller.view, size: size)
            attachAssistantSkillCapture(
                streaming,
                name: "streaming-\(variant.name)",
                expectedLabels: expectedLabels,
                forbiddenLabels: ["$frontend-design", "/frontend-design"]
            )
            let streamingFrame = try XCTUnwrap(firstAccessibilityFrame(containingLabel: paragraph, in: controller.view))

            scenario.chat.fold(event(
                id: "reply-skill-reference", cursor: 3, kind: "assistant.message", runId: "run-skill-reference",
                text: Self.assistantSkillReferenceAnswer, createdAt: 2_000, completedAt: 3_000
            ))
            scenario.chat.fold(event(
                id: "done-skill-reference", cursor: 4, kind: "run.status", runId: "run-skill-reference",
                runStatus: "completed", createdAt: 3_000
            ))
            RunLoop.main.run(until: Date().addingTimeInterval(0.1))
            controller.view.setNeedsLayout()
            controller.view.layoutIfNeeded()
            XCTAssertFalse(scenario.chat.isStreaming)
            XCTAssertFalse(assistant.isStreaming)

            let settled = captureHostedView(controller.view, size: size)
            attachAssistantSkillCapture(
                settled,
                name: "settled-\(variant.name)",
                expectedLabels: expectedLabels,
                forbiddenLabels: ["$frontend-design", "/frontend-design"]
            )
            let settledFrame = try XCTUnwrap(firstAccessibilityFrame(containingLabel: paragraph, in: controller.view))
            XCTAssertEqual(streamingFrame.width, settledFrame.width, accuracy: 0.5)
            XCTAssertEqual(streamingFrame.height, settledFrame.height, accuracy: 0.5,
                "Settling must preserve the assistant paragraph's line wrapping.")
        }
    }

    func testAssistantSkillReferenceLongLabelWrapsVisualAttachments() throws {
        let skill = MessageSkill(
            name: "very-long-blueprint-review-skill",
            displayName: "Very Long Blueprint Review Skill"
        )
        let answer = "`$very-long-blueprint-review-skill` reviews the current screen and keeps normal prose wrapping.\n\nThe same skill name should stay readable in both messages."
        let scenario = makeAssistantSkillReferenceScenario(skill: skill, answer: answer)
        let variants: [MarkdownFixtureVariant] = [
            .init(name: "light-accessibility", colorScheme: .light, dynamicTypeSize: .accessibility1),
            .init(name: "dark-accessibility", colorScheme: .dark, dynamicTypeSize: .accessibility1),
        ]
        try renderAssistantSkillReferenceFixtures(
            name: "long-label",
            scenario: scenario,
            expectedLabels: [
                "Very Long Blueprint Review Skill what does this skill do?",
                "Very Long Blueprint Review Skill reviews the current screen and keeps normal prose wrapping.",
                "The same skill name should stay readable in both messages.",
            ],
            forbiddenLabels: ["$very-long-blueprint-review-skill", "/very-long-blueprint-review-skill"],
            variants: variants
        )
    }

    func testAssistantSkillReferenceKeepsCodeAndLinksLiteralVisualAttachments() throws {
        let scenario = makeAssistantSkillReferenceScenario(
            skill: Self.frontendDesignMessageSkill,
            answer: Self.assistantSkillReferenceLiteralAnswer
        )
        try renderAssistantSkillReferenceFixtures(
            name: "literal-code-links",
            scenario: scenario,
            expectedLabels: [
                "Frontend Design what does this skill do?",
                "Frontend Design is a prose reference.",
                "echo $frontend-design",
                "export SKILL=$frontend-design",
                "Authored link: $frontend-design",
                "Unknown reference: $unknown-skill",
            ],
            forbiddenLabels: [],
            variants: [
                .init(name: "light", colorScheme: .light, dynamicTypeSize: .large),
                .init(name: "dark", colorScheme: .dark, dynamicTypeSize: .large),
            ]
        )
    }

    func testActiveFooterClearsFloatingControlsVisualAttachment() throws {
        let scenario = makeInterleavedStreamingScenario(stage: .thinking)
        XCTAssertEqual(scenario.chat.liveStatusText, "Thinking")

        let capture = try captureActiveFooterWithControls(scenario: scenario)
        XCTAssertTrue(capture.capture.hierarchy.contains("Thinking"))
        XCTAssertTrue(capture.capture.hierarchy.contains("Message Graft"))
        XCTAssertLessThanOrEqual(
            capture.statusFrame.maxY,
            capture.composerFrame.minY - 8,
            "Live status must clear the floating composer controls."
        )

        let imageAttachment = XCTAttachment(image: capture.capture.image)
        imageAttachment.name = "ActiveFooter-clears-floating-controls"
        imageAttachment.lifetime = .keepAlways
        add(imageAttachment)

        let hierarchyAttachment = XCTAttachment(string: capture.capture.hierarchy)
        hierarchyAttachment.name = "ActiveFooter-clears-floating-controls-hierarchy"
        hierarchyAttachment.lifetime = .keepAlways
        add(hierarchyAttachment)
    }

    func testCompletedTurnCollapseAndFileReferenceVisualAttachments() async throws {
        let scenario = makeCompletedTurnCollapseScenario()
        let assistant = try XCTUnwrap(scenario.chat.items.last { $0.kind == .assistant && !$0.text.isEmpty })
        let links = try XCTUnwrap(scenario.fileLinks)

        XCTAssertEqual(assistant.text, Self.fileReferenceTranscriptAnswer)
        XCTAssertFalse(scenario.chat.isStreaming)
        XCTAssertFalse(scenario.chat.items.contains { $0.isStreaming })
        XCTAssertNil(scenario.chat.liveStatusText)
        XCTAssertFalse(scenario.chat.canChangeProvider)

        await links.resolve(Self.resolvedFixtureFilePaths)
        XCTAssertEqual(links.paths, Self.resolvedFixtureFileMap)

        try renderTranscriptFixtures(name: "completed-turn-file-refs", scenario: scenario)

        let disclosure = try captureCompletedWorkDisclosureExpansion(scenario: scenario)
        XCTAssertTrue(disclosure.didActivateDisclosure)
        XCTAssertTrue(disclosure.collapsed.hierarchy.contains("Worked for 8s"))
        XCTAssertFalse(disclosure.collapsed.hierarchy.contains("Inspecting the transcript grouping"))
        XCTAssertTrue(disclosure.expanded.hierarchy.contains("Thought"))
        XCTAssertTrue(disclosure.expanded.hierarchy.contains("Read files"))
        XCTAssertTrue(disclosure.expanded.hierarchy.contains("Edited a file"))
        XCTAssertTrue(disclosure.expanded.hierarchy.contains("apps/ios/Graft/Views/Chat/TranscriptView.swift"))
        XCTAssertTrue(disclosure.expanded.hierarchy.contains("apps/ios/Graft/Views/Chat/TranscriptRow.swift"))

        let collapsedImage = XCTAttachment(image: disclosure.collapsed.image)
        collapsedImage.name = "CompletedTurnDisclosure-collapsed"
        collapsedImage.lifetime = .keepAlways
        add(collapsedImage)

        let collapsedHierarchy = XCTAttachment(string: disclosure.collapsed.hierarchy)
        collapsedHierarchy.name = "CompletedTurnDisclosure-collapsed-hierarchy"
        collapsedHierarchy.lifetime = .keepAlways
        add(collapsedHierarchy)

        let expandedImage = XCTAttachment(image: disclosure.expanded.image)
        expandedImage.name = "CompletedTurnDisclosure-expanded"
        expandedImage.lifetime = .keepAlways
        add(expandedImage)

        let expandedHierarchy = XCTAttachment(string: disclosure.expanded.hierarchy)
        expandedHierarchy.name = "CompletedTurnDisclosure-expanded-hierarchy"
        expandedHierarchy.lifetime = .keepAlways
        add(expandedHierarchy)

        let selection = try captureWorkspaceFileSelection(
            scenario: scenario,
            targetLabel: "Markdown renderer",
            expectedPath: "apps/ios/Graft/Views/Shared/MarkdownText.swift",
            expectedLine: 508
        )
        XCTAssertNotNil(selection.linkURL)
        XCTAssertTrue(selection.didOpenLinkURL)
        XCTAssertEqual(selection.selectedPath, "apps/ios/Graft/Views/Shared/MarkdownText.swift")
        XCTAssertEqual(selection.selectedLine, 508)
        XCTAssertTrue(selection.beforeTap.hierarchy.contains("apps/web/src/components/chat/MessagesTimeline.tsx"))
        XCTAssertTrue(selection.afterTap.hierarchy.contains("MessagesTimeline.tsx"))

        let beforeImage = XCTAttachment(image: selection.beforeTap.image)
        beforeImage.name = "WorkspaceFileLink-before-selection"
        beforeImage.lifetime = .keepAlways
        add(beforeImage)

        let beforeHierarchy = XCTAttachment(string: selection.beforeTap.hierarchy)
        beforeHierarchy.name = "WorkspaceFileLink-before-selection-hierarchy"
        beforeHierarchy.lifetime = .keepAlways
        add(beforeHierarchy)

        let afterImage = XCTAttachment(image: selection.afterTap.image)
        afterImage.name = "WorkspaceFileLink-after-selection"
        afterImage.lifetime = .keepAlways
        add(afterImage)

        let afterHierarchy = XCTAttachment(string: selection.afterTap.hierarchy)
        afterHierarchy.name = "WorkspaceFileLink-after-selection-hierarchy"
        afterHierarchy.lifetime = .keepAlways
        add(afterHierarchy)
    }

    func testLiveStatusPersistsAcrossInterleavedStreamingFrames() throws {
        let thinking = makeInterleavedStreamingScenario(stage: .thinking)
        let textAndTool = makeInterleavedStreamingScenario(stage: .textAndTool)
        let settled = makeInterleavedStreamingScenario(stage: .settled)

        XCTAssertNotNil(thinking.chat.liveStatusText)
        XCTAssertTrue(thinking.chat.isStreaming)
        XCTAssertNotNil(textAndTool.chat.liveStatusText)
        XCTAssertTrue(textAndTool.chat.isStreaming)
        XCTAssertTrue(textAndTool.chat.items.contains { $0.kind == .assistant && !$0.text.isEmpty })
        XCTAssertNil(settled.chat.liveStatusText)
        XCTAssertFalse(settled.chat.isStreaming)
        XCTAssertFalse(settled.chat.items.contains { $0.isStreaming || $0.toolStatus == .running })

        try renderTranscriptFixtures(name: "live-status-thinking", scenario: thinking)
        try renderTranscriptFixtures(name: "live-status-text-tool", scenario: textAndTool)
        try renderTranscriptFixtures(name: "live-status-settled", scenario: settled)

        let motionPair = try captureLiveStatusMotionPair(scenario: textAndTool)
        XCTAssertTrue(motionPair.first.hierarchy.contains("Reading files"))
        XCTAssertTrue(motionPair.second.hierarchy.contains("Reading files"))

        let firstImage = XCTAttachment(image: motionPair.first.image)
        firstImage.name = "LiveStatus-shimmer-motion-first"
        firstImage.lifetime = .keepAlways
        add(firstImage)

        let secondImage = XCTAttachment(image: motionPair.second.image)
        secondImage.name = "LiveStatus-shimmer-motion-second"
        secondImage.lifetime = .keepAlways
        add(secondImage)
    }

    func testShimmerTextAndDotLoaderProduceMotionFrames() throws {
        let motionPair = try captureLiveStatusStandaloneMotionPair(reduceMotion: false)

        XCTAssertTrue(motionPair.first.hierarchy.contains("Reading files"))
        XCTAssertTrue(motionPair.second.hierarchy.contains("Reading files"))
        XCTAssertNotEqual(motionPair.first.image.pngData(), motionPair.second.image.pngData())

        let firstImage = XCTAttachment(image: motionPair.first.image)
        firstImage.name = "ShimmerText-dot-loader-motion-first"
        firstImage.lifetime = .keepAlways
        add(firstImage)

        let firstHierarchy = XCTAttachment(string: motionPair.first.hierarchy)
        firstHierarchy.name = "ShimmerText-dot-loader-motion-first-hierarchy"
        firstHierarchy.lifetime = .keepAlways
        add(firstHierarchy)

        let secondImage = XCTAttachment(image: motionPair.second.image)
        secondImage.name = "ShimmerText-dot-loader-motion-second"
        secondImage.lifetime = .keepAlways
        add(secondImage)
    }

    func testShimmerTextAndDotLoaderStaySteadyWithReduceMotion() throws {
        let motionPair = try captureLiveStatusStandaloneMotionPair(reduceMotion: true)

        XCTAssertTrue(motionPair.first.hierarchy.contains("Reading files"))
        XCTAssertTrue(motionPair.second.hierarchy.contains("Reading files"))
        XCTAssertEqual(motionPair.first.image.pngData(), motionPair.second.image.pngData())

        let firstImage = XCTAttachment(image: motionPair.first.image)
        firstImage.name = "ShimmerText-dot-loader-reduce-motion-first"
        firstImage.lifetime = .keepAlways
        add(firstImage)

        let firstHierarchy = XCTAttachment(string: motionPair.first.hierarchy)
        firstHierarchy.name = "ShimmerText-dot-loader-reduce-motion-first-hierarchy"
        firstHierarchy.lifetime = .keepAlways
        add(firstHierarchy)

        let secondImage = XCTAttachment(image: motionPair.second.image)
        secondImage.name = "ShimmerText-dot-loader-reduce-motion-second"
        secondImage.lifetime = .keepAlways
        add(secondImage)
    }

    func testThreadComposerDockTaskExpansionAndScrollArrowVisualAttachments() throws {
        let scenario = makeTaskProgressScenario()
        let progress = try XCTUnwrap(scenario.chat.taskProgress)
        XCTAssertEqual(progress.completedCount, 2)
        XCTAssertEqual(progress.items.count, 5)
        scenario.chat.isAwayFromLatest = true

        try renderThreadComposerDockFixtures(chat: scenario.chat, app: scenario.app)
    }

    func testComposerSoftScrollEdgeAndTrailingArrowOnPhoneAndIPad() async throws {
        for size in [CGSize(width: 440, height: 956), CGSize(width: 1_024, height: 900)] {
            for scheme in [ColorScheme.light, .dark] {
                let app = AppModel(store: LocalStore(inMemory: true))
                let chat = ChatModel(threadId: "scroll-edge", title: "Scroll edge", app: app)
                chat.isAwayFromLatest = true
                let surface = ZStack {
                    DS.Color.bg.ignoresSafeArea()
                    ScrollView {
                        VStack(alignment: .leading, spacing: 24) {
                            ForEach(1..<31) { number in
                                Text("\(number). Review the remaining changes and finish the final checks.")
                                    .font(.title3)
                                    .frame(maxWidth: .infinity, alignment: .leading)
                            }
                        }
                        .padding(.horizontal, 16)
                    }
                    .scrollEdgeEffectStyle(.soft, for: .bottom)
                    .readableChatColumn()
                }
                .safeAreaBar(edge: .bottom, spacing: 0) {
                    ThreadComposerDock(chat: chat)
                        .readableChatColumn()
                }
                .environment(app)
                .environment(\.colorScheme, scheme)
                let controller = UIHostingController(rootView: surface)
                let window = host(controller, size: size)
                defer {
                    window.isHidden = true
                    window.rootViewController = nil
                }
                let scroll = try XCTUnwrap(findFirstSubview(ofType: UIScrollView.self, in: controller.view))
                scroll.setContentOffset(CGPoint(x: 0, y: 240), animated: false)
                try await Task.sleep(for: .milliseconds(250))
                controller.view.layoutIfNeeded()
                XCTAssertGreaterThan(scroll.adjustedContentInset.bottom, 44, "The native bar must reserve the composer and safe area.")
                let attachment = XCTAttachment(image: captureHostedView(window, size: size).image)
                attachment.name = "Composer-soft-scroll-edge-\(Int(size.width))-\(scheme)"
                attachment.lifetime = .keepAlways
                add(attachment)
                let arrow = try XCTUnwrap(firstAccessibilityFrame(containingLabel: "Scroll to latest message", in: controller.view))
                let columnRight = (size.width + min(size.width, AdaptiveChrome.readableColumnMaxWidth)) / 2
                XCTAssertEqual(arrow.maxX, columnRight - 12, accuracy: 1, "The jump button stays on the right edge of the composer.")
                let before = chat.scrollToLatestTick
                XCTAssertTrue(activateAccessibilityControl(identifier: "scroll-to-latest",
                    fallbackLabel: "Scroll to latest message", fallbackValue: nil, in: controller.view))
                XCTAssertEqual(chat.scrollToLatestTick, before + 1)

            }
        }
    }

    func testUsagePopoverHugsContentAndCapsLongAllowanceLists() async throws {
        let context = ContextUsageInfo(percent: 62, tokensUsed: 148_000, tokensMax: 238_000, source: "measured")
        func allowance(count: Int) -> ProviderAllowanceInfo {
            ProviderAllowanceInfo(providerId: "codex", status: "available", updatedAt: nil,
                stale: false, planName: "Pro", limits: (0..<count).map { _ in
                    .init(label: "Weekly · 5h", remainingPercent: 22, resetsAt: "2099-09-22T12:33:00Z")
                })
        }
        for size in [DynamicTypeSize.large, .accessibility3] {
            for count in [0, 1, 8] {
                let controller = UIHostingController(rootView: ThreadUsageDetails(context: context,
                    allowance: allowance(count: count), loading: false, failed: false, onRetry: {})
                    .environment(\.dynamicTypeSize, size))
                let fitted = controller.sizeThatFits(in: CGSize(width: 440, height: 900))
                XCTAssertEqual(fitted.width, 280, accuracy: 0.5)
                XCTAssertLessThanOrEqual(fitted.height, 380.5)
                if count == 1, size == .large {
                    XCTAssertLessThan(fitted.height, 300, "The usage panel should end just below the reset time.")
                }
                if count == 8 { XCTAssertEqual(fitted.height, 380, accuracy: 0.5) }
            }
        }
        for loading in [true, false] {
            let controller = UIHostingController(rootView: ThreadUsageDetails(context: context,
                allowance: nil, loading: loading, failed: !loading, onRetry: {}))
            XCTAssertLessThan(controller.sizeThatFits(in: CGSize(width: 440, height: 900)).height, 300)
        }

        let size = CGSize(width: 440, height: 956)
        let controller = UIHostingController(rootView: ThreadUsagePopoverFixture(context: context, allowance: allowance(count: 1)))
        let window = host(controller, size: size)
        defer {
            controller.dismiss(animated: false)
            window.isHidden = true
            window.rootViewController = nil
        }
        try await Task.sleep(for: .milliseconds(900))
        let popover = try XCTUnwrap(controller.presentedViewController)
        XCTAssertLessThan(popover.view.bounds.height, 320, "The native popover must also hug the usage rows.")
        XCTAssertGreaterThan(popover.view.bounds.height, 180)
        let attachment = XCTAttachment(image: captureHostedView(window, size: size).image)
        attachment.name = "Context-account-usage-content-fitting-popover"
        attachment.lifetime = .keepAlways
        add(attachment)
    }

    func testStreamingArrivalVisualFramesPreserveTextAndWrapping() throws {
        let scenario = makeTranscriptScenario(settled: false)
        let assistant = try XCTUnwrap(scenario.chat.items.last { $0.kind == .assistant })
        assistant.text = "The menu "
        let surface = VStack(alignment: .leading, spacing: 24) {
            Text("Streaming reply").font(.headline).foregroundStyle(.secondary)
            TranscriptRow(item: assistant, showInlineReasoning: false, showMessageActions: false)
            Spacer()
        }
        .padding(24)
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
        .background(DS.Color.bg)
        .environment(scenario.app)
        .environment(\.scenePhase, .active)
        .environment(\.colorScheme, .light)
        let size = CGSize(width: 390, height: 320)
        let controller = UIHostingController(rootView: surface)
        let window = host(controller, size: size)
        defer {
            window.isHidden = true
            window.rootViewController = nil
        }

        var frame = 0
        for chunk in ["now fits ", "its contents. ", "New text ", "arrives softly, ", "while the rest ", "stays steady."] {
            assistant.text += chunk
            for _ in 0..<6 {
                RunLoop.main.run(until: Date().addingTimeInterval(0.04))
                controller.view.layoutIfNeeded()
                let capture = captureHostedView(window, size: size)
                let attachment = XCTAttachment(image: capture.image)
                attachment.name = String(format: "StreamingArrival-%03d", frame)
                attachment.lifetime = .keepAlways
                add(attachment)
                frame += 1
            }
        }
        let streaming = try XCTUnwrap(firstAccessibilityFrame(containingLabel: assistant.text, in: controller.view))
        assistant.isStreaming = false
        RunLoop.main.run(until: Date().addingTimeInterval(0.1))
        controller.view.layoutIfNeeded()
        let settled = try XCTUnwrap(firstAccessibilityFrame(containingLabel: assistant.text, in: controller.view))
        XCTAssertEqual(streaming.width, settled.width, accuracy: 0.5)
        XCTAssertEqual(streaming.height, settled.height, accuracy: 0.5)
    }

    func testStreamingRendererFadesNewTextWithNativeSelectionEnabled() throws {
        let attributed = AttributedString("Steady text, incoming text")
        var images: [Data] = []
        for time in [0.0, 1.0] {
            let surface = InlineText.renderedText(attributed, skillIconSize: 18,
                arrivals: [.init(range: 13..<26, time: 0)], time: time)
                .font(.body)
                .textSelection(.enabled)
                .padding(24)
                .frame(width: 390, height: 160)
                .background(.white)
                .environment(\.colorScheme, .light)
            let controller = UIHostingController(rootView: surface)
            let size = CGSize(width: 390, height: 160)
            let window = host(controller, size: size)
            let capture = captureHostedView(window, size: size)
            images.append(try XCTUnwrap(capture.image.pngData()))
            let attachment = XCTAttachment(image: capture.image)
            attachment.name = "StreamingRenderer-\(time)"
            attachment.lifetime = .keepAlways
            add(attachment)
            window.isHidden = true
            window.rootViewController = nil
        }
        XCTAssertNotEqual(images[0], images[1], "Incoming text must draw more softly before its fade finishes.")
    }

    func testDiffBubbleDismissesFocusedComposerAndPresentsSheet() throws {
        let app = AppModel(store: LocalStore(inMemory: true))
        let chat = ChatModel(threadId: "visual-thread", title: "Visual diff check")

        let surface = DiffBubbleSheetFixture(chat: chat, diff: Self.zeroLineDiffSummary)
            .environment(app)
            .environment(\.colorScheme, ColorScheme.light)
            .environment(\.dynamicTypeSize, DynamicTypeSize.large)
        let capture = try captureDiffBubbleSheet(surface, size: CGSize(width: 440, height: 720))

        XCTAssertEqual(capture.visibleDiffButtonCount, 1)
        XCTAssertTrue(capture.beforeTapFocusedComposer)
        XCTAssertTrue(capture.didActivateDiff)
        XCTAssertFalse(capture.afterTapFocusedComposer)
        XCTAssertTrue(capture.afterTap.hierarchy.contains("1 file changed"))
        XCTAssertTrue(capture.afterTap.hierarchy.contains("1 file"))
        XCTAssertTrue(capture.afterTap.hierarchy.contains("apps/ios/Graft/Views/Chat/ComposerDiffBubble.swift"))

        let beforeImage = XCTAttachment(image: capture.beforeTap.image)
        beforeImage.name = "DiffBubble-before-focused-composer"
        beforeImage.lifetime = .keepAlways
        add(beforeImage)

        let beforeHierarchy = XCTAttachment(string: capture.beforeTap.hierarchy)
        beforeHierarchy.name = "DiffBubble-before-focused-composer-hierarchy"
        beforeHierarchy.lifetime = .keepAlways
        add(beforeHierarchy)

        let afterImage = XCTAttachment(image: capture.afterTap.image)
        afterImage.name = "DiffBubble-after-sheet-keyboard-dismissed"
        afterImage.lifetime = .keepAlways
        add(afterImage)

        let afterHierarchy = XCTAttachment(string: capture.afterTap.hierarchy)
        afterHierarchy.name = "DiffBubble-after-sheet-keyboard-dismissed-hierarchy"
        afterHierarchy.lifetime = .keepAlways
        add(afterHierarchy)
    }

    func testSlashPaletteVisualAttachment() throws {
        var picked: ComposerCommand?
        let surface = SlashPaletteFixture { command in
            picked = command
        }
        .environment(\.colorScheme, ColorScheme.light)
        .environment(\.dynamicTypeSize, DynamicTypeSize.large)

        let capture = try captureView(surface, size: CGSize(width: 440, height: 220))
        XCTAssertTrue(capture.hierarchy.contains("Slash commands"))
        XCTAssertTrue(capture.hierarchy.contains("/model"))
        XCTAssertTrue(capture.hierarchy.contains("/review"))
        XCTAssertTrue(capture.hierarchy.contains("/tasks"))
        XCTAssertNil(picked)

        let imageAttachment = XCTAttachment(image: capture.image)
        imageAttachment.name = "SlashPalette-visible-commands"
        imageAttachment.lifetime = .keepAlways
        add(imageAttachment)

        let hierarchyAttachment = XCTAttachment(string: capture.hierarchy)
        hierarchyAttachment.name = "SlashPalette-visible-commands-hierarchy"
        hierarchyAttachment.lifetime = .keepAlways
        add(hierarchyAttachment)
    }

    func testComposerSlashOverlayDoesNotMoveTranscriptVisualAttachments() throws {
        let app = AppModel(store: LocalStore(inMemory: true))
        let chat = ChatModel(threadId: "visual-thread", title: "Slash overlay check")
        let surface = ComposerSlashOverlayFixture(chat: chat)
            .environment(app)
            .environment(\.colorScheme, ColorScheme.light)
            .environment(\.dynamicTypeSize, DynamicTypeSize.large)

        let capture = try captureComposerSlashOverlay(surface, size: CGSize(width: 440, height: 620))

        XCTAssertTrue(capture.before.hierarchy.contains("Transcript content stays fixed"))
        XCTAssertTrue(capture.after.hierarchy.contains("Transcript content stays fixed"))
        XCTAssertTrue(capture.after.hierarchy.contains("Slash commands"))
        XCTAssertTrue(
            capture.after.hierarchy.contains("Loading commands")
                || capture.after.hierarchy.contains("Commands could not load")
                || capture.after.hierarchy.contains("No matching commands")
        )
        XCTAssertEqual(capture.beforeTranscriptFrame.midY, capture.afterTranscriptFrame.midY, accuracy: 1.5)
        XCTAssertEqual(capture.beforeComposerFrame.midY, capture.afterComposerFrame.midY, accuracy: 1.5)
        XCTAssertLessThanOrEqual(
            capture.afterSlashPaletteFrame.maxY,
            capture.afterComposerFrame.minY - 12,
            "Slash palette must sit above the text editor instead of covering the typed command."
        )

        let beforeImage = XCTAttachment(image: capture.before.image)
        beforeImage.name = "ComposerSlashOverlay-before"
        beforeImage.lifetime = .keepAlways
        add(beforeImage)

        let beforeHierarchy = XCTAttachment(string: capture.before.hierarchy)
        beforeHierarchy.name = "ComposerSlashOverlay-before-hierarchy"
        beforeHierarchy.lifetime = .keepAlways
        add(beforeHierarchy)

        let afterImage = XCTAttachment(image: capture.after.image)
        afterImage.name = "ComposerSlashOverlay-after"
        afterImage.lifetime = .keepAlways
        add(afterImage)

        let afterHierarchy = XCTAttachment(string: capture.after.hierarchy)
        afterHierarchy.name = "ComposerSlashOverlay-after-hierarchy"
        afterHierarchy.lifetime = .keepAlways
        add(afterHierarchy)
    }

    func testSlashPaletteVisualRowsPreviewControlAndSkillTokenAttachments() throws {
        let surface = SlashPalette(
            completions: Self.slashCommands,
            status: nil,
            onPreview: { _ in },
            onPick: { _ in }
        )
        .frame(width: 440, height: 280, alignment: .bottom)
        .background(DS.Color.bg)
        .environment(\.colorScheme, ColorScheme.light)
        .environment(\.dynamicTypeSize, DynamicTypeSize.large)

        let capture = try captureView(surface, size: CGSize(width: 440, height: 280))
        XCTAssertTrue(capture.hierarchy.contains("Slash commands"))
        XCTAssertTrue(capture.hierarchy.contains("/tasks: Show task progress"))
        XCTAssertTrue(capture.hierarchy.contains("Preview Tasks"))

        let imageAttachment = XCTAttachment(image: capture.image)
        imageAttachment.name = "SlashPalette-roomy-preview-skill-row"
        imageAttachment.lifetime = .keepAlways
        add(imageAttachment)

        let hierarchyAttachment = XCTAttachment(string: capture.hierarchy)
        hierarchyAttachment.name = "SlashPalette-roomy-preview-skill-row-hierarchy"
        hierarchyAttachment.lifetime = .keepAlways
        add(hierarchyAttachment)

        let tokenCapture = try captureComposerSkillToken(command: Self.tasksSkillCommand)
        XCTAssertEqual(tokenCapture.plainText, "/tasks polish composer")
        XCTAssertTrue(tokenCapture.hasSkillAttachment)

        let tokenImage = XCTAttachment(image: tokenCapture.capture.image)
        tokenImage.name = "ComposerSkillToken-blue-atomic-token"
        tokenImage.lifetime = .keepAlways
        add(tokenImage)

        let tokenHierarchy = XCTAttachment(string: tokenCapture.capture.hierarchy)
        tokenHierarchy.name = "ComposerSkillToken-blue-atomic-token-hierarchy"
        tokenHierarchy.lifetime = .keepAlways
        add(tokenHierarchy)
    }

    func testSkillPreviewSheetLoadsInstructionsVisualAttachment() throws {
        let surface = SkillPreviewSheet(
            command: Self.tasksSkillCommand,
            load: {
                ComposerSkillPreview(
                    name: "tasks",
                    description: "Track active task progress without leaving the composer.",
                    contents: """
                    ---
                    title: Tasks
                    hidden: true
                    ---
                    # Tasks

                    Use this skill to inspect the current task list, expand progress, and jump back into the active plan.

                    - Keep the transcript anchored.
                    - Keep the composer visible.
                    """,
                    truncated: true
                )
            },
            onUse: {}
        )
        .frame(width: 440, height: 620)
        .background(DS.Color.bg)
        .environment(\.colorScheme, ColorScheme.light)
        .environment(\.dynamicTypeSize, DynamicTypeSize.large)

        let controller = UIHostingController(rootView: surface)
        let window = host(controller, size: CGSize(width: 440, height: 620))
        defer {
            window.isHidden = true
            window.rootViewController = nil
        }
        RunLoop.main.run(until: Date().addingTimeInterval(0.5))

        let capture = captureHostedView(window, size: CGSize(width: 440, height: 620))
        XCTAssertTrue(capture.hierarchy.contains("Skill preview"))
        XCTAssertTrue(capture.hierarchy.contains("Tasks"))
        XCTAssertTrue(capture.hierarchy.contains("Track active task progress without leaving the composer."))
        XCTAssertTrue(capture.hierarchy.contains("Use this skill to inspect the current task list"))
        XCTAssertTrue(capture.hierarchy.contains("Showing the beginning of this skill"))
        XCTAssertFalse(capture.hierarchy.contains("hidden: true"))

        let imageAttachment = XCTAttachment(image: capture.image)
        imageAttachment.name = "SkillPreviewSheet-loaded-instructions"
        imageAttachment.lifetime = .keepAlways
        add(imageAttachment)

        let hierarchyAttachment = XCTAttachment(string: capture.hierarchy)
        hierarchyAttachment.name = "SkillPreviewSheet-loaded-instructions-hierarchy"
        hierarchyAttachment.lifetime = .keepAlways
        add(hierarchyAttachment)
    }

    private func renderFixtures(
        fixtureName: String,
        markdown: String,
        height: CGFloat,
        file: StaticString = #filePath,
        line: UInt = #line
    ) throws {
        let variants: [MarkdownFixtureVariant] = [
            .init(name: "light", colorScheme: .light, dynamicTypeSize: .large),
            .init(name: "dark", colorScheme: .dark, dynamicTypeSize: .large),
            .init(name: "large-type", colorScheme: .light, dynamicTypeSize: .accessibility1),
        ]

        for variant in variants {
            let surface = MarkdownVisualFixture(markdown: markdown, height: height)
                .environment(\.colorScheme, variant.colorScheme)
                .environment(\.dynamicTypeSize, variant.dynamicTypeSize)

            let capture = try captureView(
                surface,
                size: CGSize(width: 390, height: height),
                file: file,
                line: line
            )

            let imageAttachment = XCTAttachment(image: capture.image)
            imageAttachment.name = "MarkdownText-\(fixtureName)-\(variant.name)"
            imageAttachment.lifetime = .keepAlways
            add(imageAttachment)

            let hierarchyAttachment = XCTAttachment(string: capture.hierarchy)
            hierarchyAttachment.name = "MarkdownText-\(fixtureName)-\(variant.name)-hierarchy"
            hierarchyAttachment.lifetime = .keepAlways
            add(hierarchyAttachment)
        }
    }

    private func renderTranscriptFixtures(name: String, scenario: TranscriptScenario) throws {
        let variants: [MarkdownFixtureVariant] = [
            .init(name: "light", colorScheme: .light, dynamicTypeSize: .large),
            .init(name: "dark", colorScheme: .dark, dynamicTypeSize: .large),
            .init(name: "large-type", colorScheme: .light, dynamicTypeSize: .accessibility1),
        ]

        for variant in variants {
            let surface = TranscriptVisualFixture(chat: scenario.chat, fileLinks: scenario.fileLinks)
                .environment(scenario.app)
                .environment(\.colorScheme, variant.colorScheme)
                .environment(\.dynamicTypeSize, variant.dynamicTypeSize)

            let capture = try captureView(
                surface,
                size: CGSize(width: 440, height: 956)
            )

            let imageAttachment = XCTAttachment(image: capture.image)
            imageAttachment.name = "TranscriptView-\(name)-\(variant.name)"
            imageAttachment.lifetime = .keepAlways
            add(imageAttachment)

            let hierarchyAttachment = XCTAttachment(string: capture.hierarchy)
            hierarchyAttachment.name = "TranscriptView-\(name)-\(variant.name)-hierarchy"
            hierarchyAttachment.lifetime = .keepAlways
            add(hierarchyAttachment)
        }
    }

    private func renderSentSkillUserBubbleFixtures(
        name: String,
        scenario: TranscriptScenario,
        expectedLabel: String,
        variants: [MarkdownFixtureVariant]
    ) throws {
        for variant in variants {
            let surface = TranscriptVisualFixture(chat: scenario.chat, fileLinks: scenario.fileLinks)
                .environment(scenario.app)
                .environment(\.colorScheme, variant.colorScheme)
                .environment(\.dynamicTypeSize, variant.dynamicTypeSize)

            let capture = try captureView(surface, size: CGSize(width: 440, height: 956))
            XCTAssertTrue(capture.hierarchy.contains(expectedLabel), "Missing sent skill accessibility label for \(variant.name)")
            XCTAssertFalse(capture.hierarchy.contains("label=/tasks"), "Sent skill token should expose the friendly skill label, not the raw command token.")
            assertValidCapture(capture)

            let imageAttachment = XCTAttachment(image: capture.image)
            imageAttachment.name = "TranscriptView-\(name)-\(variant.name)"
            imageAttachment.lifetime = .keepAlways
            add(imageAttachment)

            let hierarchyAttachment = XCTAttachment(string: capture.hierarchy)
            hierarchyAttachment.name = "TranscriptView-\(name)-\(variant.name)-hierarchy"
            hierarchyAttachment.lifetime = .keepAlways
            add(hierarchyAttachment)
        }
    }

    private func renderAssistantSkillReferenceFixtures(
        name: String,
        scenario: TranscriptScenario,
        expectedLabels: [String],
        forbiddenLabels: [String],
        variants: [MarkdownFixtureVariant]
    ) throws {
        for variant in variants {
            let surface = TranscriptVisualFixture(chat: scenario.chat)
                .environment(scenario.app)
                .environment(\.colorScheme, variant.colorScheme)
                .environment(\.dynamicTypeSize, variant.dynamicTypeSize)
            let size = CGSize(width: 440, height: 956)
            let controller = UIHostingController(rootView: surface)
            let window = host(controller, size: size)
            defer {
                window.isHidden = true
                window.rootViewController = nil
            }
            let capture = captureHostedView(controller.view, size: size)
            attachAssistantSkillCapture(
                capture,
                name: "\(name)-\(variant.name)",
                expectedLabels: expectedLabels,
                forbiddenLabels: forbiddenLabels
            )
            for label in expectedLabels {
                let frame = try XCTUnwrap(firstAccessibilityFrame(containingLabel: label, in: controller.view))
                XCTAssertGreaterThanOrEqual(frame.minX, -0.5, "Text must stay within the transcript: \(label)")
                XCTAssertLessThanOrEqual(frame.maxX, size.width + 0.5, "Text must wrap within the transcript: \(label)")
                XCTAssertGreaterThanOrEqual(frame.minY, -0.5, "Text must remain visible: \(label)")
                XCTAssertLessThanOrEqual(frame.maxY, size.height + 0.5, "Text must remain visible: \(label)")
            }
        }
    }

    private func attachAssistantSkillCapture(
        _ capture: ViewCapture,
        name: String,
        expectedLabels: [String],
        forbiddenLabels: [String]
    ) {
        assertValidCapture(capture)
        // Native Text attachments contribute an object replacement character
        // to accessibility labels; compare the visible words around the icon.
        let spokenText = capture.hierarchy.replacingOccurrences(of: "\u{FFFC} ", with: "")
        for label in expectedLabels {
            XCTAssertTrue(spokenText.contains(label), "Missing assistant skill fixture text in \(name): \(label)")
        }
        for label in forbiddenLabels {
            XCTAssertFalse(capture.hierarchy.contains(label), "Raw skill token leaked into prose in \(name): \(label)")
        }
        let imageAttachment = XCTAttachment(image: capture.image)
        imageAttachment.name = "TranscriptView-assistant-skill-\(name)"
        imageAttachment.lifetime = .keepAlways
        add(imageAttachment)
        let hierarchyAttachment = XCTAttachment(string: capture.hierarchy)
        hierarchyAttachment.name = "TranscriptView-assistant-skill-\(name)-hierarchy"
        hierarchyAttachment.lifetime = .keepAlways
        add(hierarchyAttachment)
    }

    private func captureWorkspaceFileSelection(
        scenario: TranscriptScenario,
        targetLabel: String,
        expectedPath: String,
        expectedLine: Int?,
        file: StaticString = #filePath,
        line: UInt = #line
    ) throws -> WorkspaceFileSelectionCapture {
        let surface = TranscriptVisualFixture(chat: scenario.chat, fileLinks: scenario.fileLinks)
            .environment(scenario.app)
            .environment(\.colorScheme, ColorScheme.light)
            .environment(\.dynamicTypeSize, DynamicTypeSize.large)
        let controller = UIHostingController(rootView: surface)
        let window = host(controller, size: CGSize(width: 440, height: 956))
        defer {
            window.isHidden = true
            window.rootViewController = nil
        }

        RunLoop.main.run(until: Date().addingTimeInterval(0.35))
        controller.view.setNeedsLayout()
        controller.view.layoutIfNeeded()

        let beforeTap = captureHostedView(window, size: CGSize(width: 440, height: 956))
        assertValidCapture(beforeTap, file: file, line: line)

        let didActivateLink = activateAccessibilityControl(
            matching: { object in
                (object.accessibilityLabel ?? "").contains(targetLabel)
            },
            in: controller.view
        )
        let linkURL = findWorkspaceFileURL(containingLabel: targetLabel, in: controller.view)
        let didOpenLinkURL = linkURL.map { scenario.fileLinks?.open($0) ?? false } ?? false
        RunLoop.main.run(until: Date().addingTimeInterval(0.5))
        controller.view.setNeedsLayout()
        controller.view.layoutIfNeeded()

        let afterTap = captureHostedView(window, size: CGSize(width: 440, height: 956))
        assertValidCapture(afterTap, file: file, line: line)

        let selectedPath = scenario.fileLinks?.selection?.path
        let selectedLine = scenario.fileLinks?.selection?.line
        if let selectedPath {
            XCTAssertEqual(selectedPath, expectedPath, file: file, line: line)
        }
        if let expectedLine {
            XCTAssertEqual(selectedLine, expectedLine, file: file, line: line)
        }

        return WorkspaceFileSelectionCapture(
            beforeTap: beforeTap,
            afterTap: afterTap,
            didActivateLink: didActivateLink,
            linkURL: linkURL,
            didOpenLinkURL: didOpenLinkURL,
            selectedPath: selectedPath,
            selectedLine: selectedLine
        )
    }

    private func captureCompletedWorkDisclosureExpansion(
        scenario: TranscriptScenario,
        file: StaticString = #filePath,
        line: UInt = #line
    ) throws -> CompletedWorkDisclosureCapture {
        let surface = TranscriptVisualFixture(chat: scenario.chat, fileLinks: scenario.fileLinks)
            .environment(scenario.app)
            .environment(\.colorScheme, ColorScheme.light)
            .environment(\.dynamicTypeSize, DynamicTypeSize.large)
        let controller = UIHostingController(rootView: surface)
        let window = host(controller, size: CGSize(width: 440, height: 956))
        defer {
            window.isHidden = true
            window.rootViewController = nil
        }

        RunLoop.main.run(until: Date().addingTimeInterval(0.35))
        controller.view.setNeedsLayout()
        controller.view.layoutIfNeeded()

        let collapsed = captureHostedView(window, size: CGSize(width: 440, height: 956))
        assertValidCapture(collapsed, file: file, line: line)

        let didActivateDisclosure = activateAccessibilityControl(
            matching: { object in
                (object.accessibilityLabel ?? "").contains("Worked for")
            },
            in: controller.view
        )
        RunLoop.main.run(until: Date().addingTimeInterval(0.35))
        controller.view.setNeedsLayout()
        controller.view.layoutIfNeeded()

        let expanded = captureHostedView(window, size: CGSize(width: 440, height: 956))
        assertValidCapture(expanded, file: file, line: line)

        return CompletedWorkDisclosureCapture(
            collapsed: collapsed,
            expanded: expanded,
            didActivateDisclosure: didActivateDisclosure
        )
    }

    private func captureLiveStatusMotionPair(
        scenario: TranscriptScenario,
        file: StaticString = #filePath,
        line: UInt = #line
    ) throws -> LiveStatusMotionCapture {
        let surface = TranscriptVisualFixture(chat: scenario.chat, fileLinks: scenario.fileLinks)
            .environment(scenario.app)
            .environment(\.colorScheme, ColorScheme.light)
            .environment(\.dynamicTypeSize, DynamicTypeSize.large)
        let controller = UIHostingController(rootView: surface)
        let window = host(controller, size: CGSize(width: 440, height: 956))
        defer {
            window.isHidden = true
            window.rootViewController = nil
        }

        RunLoop.main.run(until: Date().addingTimeInterval(0.35))
        controller.view.setNeedsLayout()
        controller.view.layoutIfNeeded()

        let first = captureHostedView(window, size: CGSize(width: 440, height: 956))
        assertValidCapture(first, file: file, line: line)

        RunLoop.main.run(until: Date().addingTimeInterval(0.6))
        controller.view.setNeedsLayout()
        controller.view.layoutIfNeeded()

        let second = captureHostedView(window, size: CGSize(width: 440, height: 956))
        assertValidCapture(second, file: file, line: line)

        return LiveStatusMotionCapture(first: first, second: second)
    }

    private func captureLiveStatusStandaloneMotionPair(
        reduceMotion: Bool,
        file: StaticString = #filePath,
        line: UInt = #line
    ) throws -> LiveStatusMotionCapture {
        let surface = LiveStatusMotionFixture()
            .environment(\._accessibilityReduceMotion, reduceMotion)
        let controller = UIHostingController(rootView: surface)
        let window = host(controller, size: CGSize(width: 360, height: 160))
        defer {
            window.isHidden = true
            window.rootViewController = nil
        }

        RunLoop.main.run(until: Date().addingTimeInterval(0.2))
        controller.view.setNeedsLayout()
        controller.view.layoutIfNeeded()
        let first = captureHostedView(window, size: CGSize(width: 360, height: 160))
        assertValidCapture(first, file: file, line: line)

        RunLoop.main.run(until: Date().addingTimeInterval(0.75))
        controller.view.setNeedsLayout()
        controller.view.layoutIfNeeded()
        let second = captureHostedView(window, size: CGSize(width: 360, height: 160))
        assertValidCapture(second, file: file, line: line)

        return LiveStatusMotionCapture(first: first, second: second)
    }

    private func captureActiveFooterWithControls(
        scenario: TranscriptScenario,
        file: StaticString = #filePath,
        line: UInt = #line
    ) throws -> ActiveFooterControlsCapture {
        let surface = ActiveTranscriptWithControlsFixture(chat: scenario.chat, fileLinks: scenario.fileLinks)
            .environment(scenario.app)
            .environment(\.colorScheme, ColorScheme.light)
            .environment(\.dynamicTypeSize, DynamicTypeSize.large)
        let controller = UIHostingController(rootView: surface)
        let window = host(controller, size: CGSize(width: 440, height: 956))
        defer {
            window.isHidden = true
            window.rootViewController = nil
        }

        RunLoop.main.run(until: Date().addingTimeInterval(0.35))
        controller.view.setNeedsLayout()
        controller.view.layoutIfNeeded()

        let capture = captureHostedView(window, size: CGSize(width: 440, height: 956))
        assertValidCapture(capture, file: file, line: line)
        let statusFrame = try XCTUnwrap(firstAccessibilityFrame(containingLabel: "Thinking", in: controller.view), file: file, line: line)
        let composerFrame = try XCTUnwrap(firstAccessibilityFrame(containingLabel: "Message Graft", in: controller.view), file: file, line: line)
        return ActiveFooterControlsCapture(
            capture: capture,
            statusFrame: statusFrame,
            composerFrame: composerFrame
        )
    }

    private func renderThreadComposerDockFixtures(chat: ChatModel, app: AppModel) throws {
        let variants: [TaskProgressFixtureVariant] = [
            .init(name: "light", colorScheme: .light, dynamicTypeSize: .large),
            .init(name: "dark", colorScheme: .dark, dynamicTypeSize: .large),
            .init(name: "large-type", colorScheme: .light, dynamicTypeSize: .accessibility1),
        ]

        for variant in variants {
            let surface = ThreadComposerDockFixture(chat: chat)
                .environment(app)
                .environment(\.colorScheme, variant.colorScheme)
                .environment(\.dynamicTypeSize, variant.dynamicTypeSize)

            let capture = try captureExpandedThreadComposerDock(surface, chat: chat, size: CGSize(width: 440, height: 620))

            let collapsedImage = XCTAttachment(image: capture.collapsed.image)
            collapsedImage.name = "ThreadComposerDock-collapsed-\(variant.name)"
            collapsedImage.lifetime = .keepAlways
            add(collapsedImage)

            let collapsedHierarchy = XCTAttachment(string: capture.collapsed.hierarchy)
            collapsedHierarchy.name = "ThreadComposerDock-collapsed-\(variant.name)-hierarchy"
            collapsedHierarchy.lifetime = .keepAlways
            add(collapsedHierarchy)

            let expandedImage = XCTAttachment(image: capture.expanded.image)
            expandedImage.name = "ThreadComposerDock-expanded-\(variant.name)"
            expandedImage.lifetime = .keepAlways
            add(expandedImage)

            let expandedHierarchy = XCTAttachment(string: capture.expanded.hierarchy)
            expandedHierarchy.name = "ThreadComposerDock-expanded-\(variant.name)-hierarchy"
            expandedHierarchy.lifetime = .keepAlways
            add(expandedHierarchy)

            XCTAssertTrue(capture.collapsed.hierarchy.contains("Scroll to latest message"))
            XCTAssertTrue(capture.collapsed.hierarchy.contains("value=Collapsed"))
            XCTAssertTrue(capture.didActivateScrollToLatest)
            XCTAssertEqual(capture.scrollToLatestTickAfterTap, capture.scrollToLatestTickBeforeTap + 1)
            XCTAssertTrue(capture.didActivateToggle)
            XCTAssertTrue(capture.expanded.hierarchy.contains("value=Expanded"))
            XCTAssertFalse(capture.expanded.hierarchy.contains("Scroll to latest message"))
            XCTAssertTrue(capture.expanded.hierarchy.contains("Review iOS transcript final answer spacing"))
            XCTAssertTrue(capture.expanded.hierarchy.contains("Check that the loader clears after the final streamed text settles"))
            XCTAssertEqual(capture.collapsedComposerFrame.midY, capture.expandedComposerFrame.midY, accuracy: 1.5)
        }
    }

    private func captureDiffBubbleSheet<Content: View>(
        _ content: Content,
        size: CGSize,
        file: StaticString = #filePath,
        line: UInt = #line
    ) throws -> DiffBubbleSheetCapture {
        let controller = UIHostingController(rootView: content)
        let window = host(controller, size: size)
        defer {
            window.isHidden = true
            window.rootViewController = nil
        }

        let composer = try XCTUnwrap(findFirstSubview(ofType: UITextView.self, in: controller.view), file: file, line: line)
        composer.becomeFirstResponder()
        RunLoop.main.run(until: Date().addingTimeInterval(0.35))
        controller.view.setNeedsLayout()
        controller.view.layoutIfNeeded()

        let beforeTap = captureHostedView(window, size: size)
        assertValidCapture(beforeTap, file: file, line: line)
        let beforeTapFocusedComposer = composer.isFirstResponder
        let visibleDiffButtonCount = countUniqueAccessibilityObjects(
            matching: { object in
                object.accessibilityLabel == "Changes: 1 file, 0 additions, 0 deletions"
            },
            in: controller.view
        )

        let didActivateDiff = activateAccessibilityControl(
            identifier: nil,
            fallbackLabel: "Changes: 1 file, 0 additions, 0 deletions",
            fallbackValue: nil,
            in: controller.view
        )
        RunLoop.main.run(until: Date().addingTimeInterval(0.6))
        controller.view.setNeedsLayout()
        controller.view.layoutIfNeeded()

        let afterTap = captureHostedView(window, size: size)
        assertValidCapture(afterTap, file: file, line: line)

        return DiffBubbleSheetCapture(
            beforeTap: beforeTap,
            afterTap: afterTap,
            beforeTapFocusedComposer: beforeTapFocusedComposer,
            afterTapFocusedComposer: composer.isFirstResponder,
            didActivateDiff: didActivateDiff,
            visibleDiffButtonCount: visibleDiffButtonCount
        )
    }

    private func captureView<Content: View>(
        _ content: Content,
        size: CGSize,
        file: StaticString = #filePath,
        line: UInt = #line
    ) throws -> ViewCapture {
        let controller = UIHostingController(rootView: content)
        let window = host(controller, size: size)
        defer {
            window.isHidden = true
            window.rootViewController = nil
        }

        let capture = captureHostedView(controller.view, size: size)
        assertValidCapture(capture, file: file, line: line)
        return capture
    }

    private func captureComposerSlashOverlay<Content: View>(
        _ content: Content,
        size: CGSize,
        file: StaticString = #filePath,
        line: UInt = #line
    ) throws -> ComposerSlashOverlayCapture {
        let controller = UIHostingController(rootView: content)
        let window = host(controller, size: size)
        defer {
            window.isHidden = true
            window.rootViewController = nil
        }

        RunLoop.main.run(until: Date().addingTimeInterval(0.25))
        controller.view.setNeedsLayout()
        controller.view.layoutIfNeeded()

        let composer = try XCTUnwrap(findFirstSubview(ofType: UITextView.self, in: controller.view), file: file, line: line)
        composer.becomeFirstResponder()
        RunLoop.main.run(until: Date().addingTimeInterval(0.25))
        controller.view.setNeedsLayout()
        controller.view.layoutIfNeeded()

        let beforeTranscriptFrame = try XCTUnwrap(
            firstAccessibilityFrame(containingLabel: "Transcript content stays fixed", in: controller.view),
            file: file,
            line: line
        )
        let beforeComposerFrame = composer.convert(composer.bounds, to: window)
        let before = captureHostedView(window, size: size)
        assertValidCapture(before, file: file, line: line)

        composer.insertText("/")
        if !(composer.text ?? "").hasPrefix("/") {
            composer.text = "/"
            composer.delegate?.textViewDidChange?(composer)
        }
        RunLoop.main.run(until: Date().addingTimeInterval(0.35))
        controller.view.setNeedsLayout()
        controller.view.layoutIfNeeded()

        let afterTranscriptFrame = try XCTUnwrap(
            firstAccessibilityFrame(containingLabel: "Transcript content stays fixed", in: controller.view),
            file: file,
            line: line
        )
        let afterComposerFrame = composer.convert(composer.bounds, to: window)
        let afterSlashPaletteFrame = try XCTUnwrap(
            firstAccessibilityFrame(containingLabel: "Slash commands", in: controller.view),
            file: file,
            line: line
        )
        let after = captureHostedView(window, size: size)
        assertValidCapture(after, file: file, line: line)

        return ComposerSlashOverlayCapture(
            before: before,
            after: after,
            beforeTranscriptFrame: beforeTranscriptFrame,
            afterTranscriptFrame: afterTranscriptFrame,
            beforeComposerFrame: beforeComposerFrame,
            afterComposerFrame: afterComposerFrame,
            afterSlashPaletteFrame: afterSlashPaletteFrame
        )
    }

    private func captureExpandedThreadComposerDock<Content: View>(
        _ content: Content,
        chat: ChatModel,
        size: CGSize,
        file: StaticString = #filePath,
        line: UInt = #line
    ) throws -> ThreadComposerDockCapture {
        let controller = UIHostingController(rootView: content)
        let window = host(controller, size: size)
        defer {
            window.isHidden = true
            window.rootViewController = nil
        }

        RunLoop.main.run(until: Date().addingTimeInterval(0.25))
        controller.view.setNeedsLayout()
        controller.view.layoutIfNeeded()
        let composer = try XCTUnwrap(findFirstSubview(ofType: UITextView.self, in: controller.view), file: file, line: line)
        let collapsedComposerFrame = composer.convert(composer.bounds, to: window)
        let collapsed = captureHostedView(window, size: size)
        assertValidCapture(collapsed, file: file, line: line)
        let scrollToLatestTickBeforeTap = chat.scrollToLatestTick
        let didActivateScrollToLatest = activateAccessibilityControl(
            identifier: "scroll-to-latest",
            fallbackLabel: "Scroll to latest message",
            fallbackValue: nil,
            in: controller.view
        )
        let scrollToLatestTickAfterTap = chat.scrollToLatestTick

        let didActivateToggle = activateAccessibilityControl(
            identifier: "task-progress-toggle",
            fallbackLabel: "Polish chat response, 2 of 5 completed",
            fallbackValue: "Collapsed",
            in: controller.view
        )
        controller.view.setNeedsLayout()
        controller.view.layoutIfNeeded()
        RunLoop.main.run(until: Date().addingTimeInterval(0.4))
        controller.view.setNeedsLayout()
        controller.view.layoutIfNeeded()

        let expandedComposerFrame = composer.convert(composer.bounds, to: window)
        let expanded = captureHostedView(window, size: size)
        assertValidCapture(expanded, file: file, line: line)

        return ThreadComposerDockCapture(
            collapsed: collapsed,
            expanded: expanded,
            didActivateToggle: didActivateToggle,
            didActivateScrollToLatest: didActivateScrollToLatest,
            scrollToLatestTickBeforeTap: scrollToLatestTickBeforeTap,
            scrollToLatestTickAfterTap: scrollToLatestTickAfterTap,
            collapsedComposerFrame: collapsedComposerFrame,
            expandedComposerFrame: expandedComposerFrame
        )
    }

    private func captureComposerSkillToken(
        command: ComposerCommand,
        file: StaticString = #filePath,
        line: UInt = #line
    ) throws -> ComposerSkillTokenCapture {
        let textView = ComposerUITextView(frame: CGRect(x: 0, y: 0, width: 360, height: 76), textContainer: nil)
        textView.placeholder = "Message Graft"
        textView.setDraft("/tasks polish composer", skill: command)
        textView.setNeedsLayout()
        textView.layoutIfNeeded()

        var hasSkillAttachment = false
        textView.attributedText.enumerateAttribute(.attachment, in: NSRange(location: 0, length: textView.attributedText.length)) { value, _, _ in
            if let attachment = value as? ComposerSkillAttachment, attachment.command.name == command.name, attachment.image != nil {
                hasSkillAttachment = true
            }
        }

        let renderer = UIGraphicsImageRenderer(size: CGSize(width: 360, height: 76))
        let image = renderer.image { _ in
            UIColor(DS.Color.bg).setFill()
            UIBezierPath(rect: CGRect(x: 0, y: 0, width: 360, height: 76)).fill()
            textView.drawHierarchy(in: textView.bounds, afterScreenUpdates: true)
        }
        let hierarchy = describeHierarchy(textView)
        let capture = ViewCapture(image: image, hierarchy: hierarchy)
        XCTAssertGreaterThan(capture.image.size.width, 0, file: file, line: line)
        XCTAssertGreaterThan(capture.image.size.height, 0, file: file, line: line)

        return ComposerSkillTokenCapture(
            capture: capture,
            plainText: ComposerSkillText.plainText(textView.attributedText),
            hasSkillAttachment: hasSkillAttachment
        )
    }

    private func host<Content: View>(_ controller: UIHostingController<Content>, size: CGSize) -> UIWindow {
        let window = Self.window(size: size)
        window.rootViewController = controller
        window.makeKeyAndVisible()
        controller.view.frame = window.bounds
        controller.view.bounds = window.bounds
        controller.view.backgroundColor = .clear
        controller.view.insetsLayoutMarginsFromSafeArea = false
        controller.view.setNeedsLayout()
        controller.view.layoutIfNeeded()
        RunLoop.main.run(until: Date().addingTimeInterval(0.05))
        return window
    }

    private func captureHostedView(_ view: UIView, size: CGSize) -> ViewCapture {
        let renderer = UIGraphicsImageRenderer(size: size)
        let image = renderer.image { _ in
            view.drawHierarchy(in: view.bounds, afterScreenUpdates: true)
        }
        let hierarchy = describeHierarchy(view)
        return ViewCapture(image: image, hierarchy: hierarchy)
    }

    private func assertValidCapture(
        _ capture: ViewCapture,
        file: StaticString = #filePath,
        line: UInt = #line
    ) {
        XCTAssertGreaterThan(capture.image.size.width, 0, file: file, line: line)
        XCTAssertGreaterThan(capture.image.size.height, 0, file: file, line: line)
        XCTAssertTrue(
            capture.hierarchy.contains("SwiftUI") || capture.hierarchy.contains("Hosting"),
            "Expected a hosted SwiftUI hierarchy",
            file: file,
            line: line
        )
    }

    private func activateAccessibilityControl(
        identifier: String?,
        fallbackLabel: String,
        fallbackValue: String?,
        in view: UIView
    ) -> Bool {
        if activateAccessibilityObject(
            identifier: identifier,
            fallbackLabel: fallbackLabel,
            fallbackValue: fallbackValue,
            object: view
        ) {
            return true
        }

        for object in accessibilityChildren(of: view) where activateAccessibilityObject(
            identifier: identifier,
            fallbackLabel: fallbackLabel,
            fallbackValue: fallbackValue,
            object: object
        ) {
            return true
        }

        for child in view.subviews where activateAccessibilityControl(
            identifier: identifier,
            fallbackLabel: fallbackLabel,
            fallbackValue: fallbackValue,
            in: child
        ) {
            return true
        }
        return false
    }

    private func activateAccessibilityControl(
        matching predicate: (NSObject) -> Bool,
        in view: UIView
    ) -> Bool {
        if predicate(view), activateAccessibilityObject(view) {
            return true
        }

        for object in accessibilityChildren(of: view) {
            if let object = object as? NSObject, predicate(object), activateAccessibilityObject(object) {
                return true
            }
            if let object = object as? NSObject, activateAccessibilityTree(matching: predicate, object: object) {
                return true
            }
        }

        for child in view.subviews where activateAccessibilityControl(matching: predicate, in: child) {
            return true
        }
        return false
    }

    private func activateAccessibilityTree(matching predicate: (NSObject) -> Bool, object: NSObject) -> Bool {
        if predicate(object), activateAccessibilityObject(object) {
            return true
        }
        for child in accessibilityChildren(of: object) {
            if let child = child as? NSObject, activateAccessibilityTree(matching: predicate, object: child) {
                return true
            }
        }
        return false
    }

    private func findWorkspaceFileURL(containingLabel targetLabel: String, in view: UIView) -> URL? {
        findWorkspaceFileURL(containingLabel: targetLabel, object: view)
            ?? view.subviews.lazy.compactMap { self.findWorkspaceFileURL(containingLabel: targetLabel, in: $0) }.first
    }

    private func findWorkspaceFileURL(containingLabel targetLabel: String, object: NSObject) -> URL? {
        if let identifier = (object as? UIAccessibilityIdentification)?.accessibilityIdentifier,
           identifier.hasPrefix("graft-file://"),
           (object.accessibilityLabel ?? "").contains(targetLabel),
           let url = URL(string: identifier) {
            return url
        }
        for child in accessibilityChildren(of: object) {
            if let child = child as? NSObject,
               let url = findWorkspaceFileURL(containingLabel: targetLabel, object: child) {
                return url
            }
        }
        return nil
    }

    private func activateAccessibilityObject(
        identifier: String?,
        fallbackLabel: String,
        fallbackValue: String?,
        object: Any
    ) -> Bool {
        if let identifier, let identified = object as? UIAccessibilityIdentification,
           identified.accessibilityIdentifier == identifier {
            return activateAccessibilityObject(object)
        }

        guard let object = object as? NSObject,
              object.accessibilityLabel == fallbackLabel else { return false }
        if let fallbackValue, object.accessibilityValue != fallbackValue { return false }
        return activateAccessibilityObject(object)
    }

    private func activateAccessibilityObject(_ object: Any) -> Bool {
        if let control = object as? UIControl {
            control.sendActions(for: .touchUpInside)
            return true
        }
        guard let object = object as? NSObject else { return false }
        if object.accessibilityActivate() { return true }
        for action in object.accessibilityCustomActions ?? [] {
            if action.actionHandler?(action) == true { return true }
        }
        return false
    }

    private func accessibilityChildren(of object: NSObject) -> [Any] {
        var elements: [Any] = object.accessibilityElements ?? []
        if #available(iOS 17.0, *) {
            elements.append(contentsOf: object.automationElements ?? [])
        }
        let count = object.accessibilityElementCount()
        if count > 0, count < 200 {
            for index in 0..<count {
                if let element = object.accessibilityElement(at: index) {
                    elements.append(element)
                }
            }
        }
        return elements
    }

    private func firstAccessibilityFrame(containingLabel targetLabel: String, in view: UIView) -> CGRect? {
        firstAccessibilityFrame(containingLabel: targetLabel, object: view)
            ?? view.subviews.lazy.compactMap { self.firstAccessibilityFrame(containingLabel: targetLabel, in: $0) }.first
    }

    private func firstAccessibilityFrame(containingLabel targetLabel: String, object: NSObject) -> CGRect? {
        if (object.accessibilityLabel ?? "").contains(targetLabel), !object.accessibilityFrame.isNull {
            return object.accessibilityFrame
        }
        for child in accessibilityChildren(of: object) {
            if let child = child as? NSObject,
               let frame = firstAccessibilityFrame(containingLabel: targetLabel, object: child) {
                return frame
            }
        }
        return nil
    }

    private func countUniqueAccessibilityObjects(matching predicate: (NSObject) -> Bool, in view: UIView) -> Int {
        var seen: Set<String> = []
        collectAccessibilityObjectKeys(matching: predicate, object: view, into: &seen)
        return seen.count
    }

    private func collectAccessibilityObjectKeys(
        matching predicate: (NSObject) -> Bool,
        object: NSObject,
        into seen: inout Set<String>
    ) {
        if predicate(object) { seen.insert(accessibilityObjectKey(object)) }
        for element in accessibilityChildren(of: object) {
            if let element = element as? NSObject, predicate(element) {
                seen.insert(accessibilityObjectKey(element))
            }
        }
        if let view = object as? UIView {
            for subview in view.subviews {
                collectAccessibilityObjectKeys(matching: predicate, object: subview, into: &seen)
            }
        }
    }

    private func accessibilityObjectKey(_ object: NSObject) -> String {
        let frame = object.accessibilityFrame
        return "\(object.accessibilityLabel ?? "")|\(object.accessibilityValue ?? "")|\(frame.origin.x.rounded())|\(frame.origin.y.rounded())|\(frame.width.rounded())|\(frame.height.rounded())"
    }

    private func findFirstSubview<T: UIView>(ofType type: T.Type, in view: UIView) -> T? {
        if let match = view as? T { return match }
        for child in view.subviews {
            if let match = findFirstSubview(ofType: type, in: child) { return match }
        }
        return nil
    }

    private static func window(size: CGSize) -> UIWindow {
        let frame = CGRect(origin: .zero, size: size)
        let scene = UIApplication.shared.connectedScenes
            .compactMap { $0 as? UIWindowScene }
            .first { $0.activationState == .foregroundActive }
            ?? UIApplication.shared.connectedScenes.compactMap { $0 as? UIWindowScene }.first

        if let scene {
            let window = UIWindow(windowScene: scene)
            window.frame = frame
            return window
        }
        return UIWindow(frame: frame)
    }

    private func makeTranscriptScenario(settled: Bool) -> TranscriptScenario {
        let app = AppModel(store: LocalStore(inMemory: true))
        let chat = ChatModel(threadId: "visual-thread", title: "Visual markdown check")

        chat.applySnapshot(snapshot(
            events: [
                event(id: "user", cursor: 1, kind: "user.message", text: Self.transcriptPrompt),
                event(id: "plan", cursor: 2, kind: "assistant.message", text: Self.transcriptSetup),
            ],
            cursor: 2,
            runs: [ActiveRun(id: "run-1", threadId: "visual-thread", status: "running", startedAt: 0)]
        ))
        chat.fold(event(
            id: "thought",
            cursor: 3,
            kind: "thinking.delta",
            runId: "run-1",
            text: "Reading the chat surface and checking the finished response layout."
        ))
        chat.fold(event(
            id: "scan",
            cursor: 4,
            kind: "tool.start",
            runId: "run-1",
            text: "Inspect TranscriptView and MarkdownText.",
            toolName: "Read"
        ))
        chat.fold(event(
            id: "scan",
            cursor: 5,
            kind: "tool.end",
            runId: "run-1",
            text: "Transcript and markdown components inspected.",
            toolName: "Read"
        ))
        chat.fold(event(
            id: "reply",
            cursor: 6,
            kind: "assistant.delta",
            runId: "run-1",
            text: Self.transcriptAnswer
        ))

        if settled {
            chat.fold(event(
                id: "reply",
                cursor: 7,
                kind: "assistant.message",
                runId: "run-1",
                text: Self.transcriptAnswer
            ))
            chat.fold(event(
                id: "done",
                cursor: 8,
                kind: "run.status",
                runId: "run-1",
                runStatus: "completed"
            ))
        }

        for item in chat.items where item.kind == .assistant {
            item.richContentAttached = true
        }

        return TranscriptScenario(app: app, chat: chat)
    }

    private func makeCompletedTurnCollapseScenario() -> TranscriptScenario {
        let app = AppModel(store: LocalStore(inMemory: true))
        let chat = ChatModel(threadId: "visual-thread", title: "Visual completed turn check")
        let fileLinks = WorkspaceFileLinks(
            threadId: "visual-thread",
            app: app,
            resolveReferences: { references in
                references.compactMap { reference in
                    guard let path = Self.resolvedFixtureFileMap[reference] else { return nil }
                    return WorkspaceFileReference(reference: reference, path: path)
                }
            }
        )

        chat.applySnapshot(snapshot(
            events: [
                event(
                    id: "user",
                    cursor: 1,
                    kind: "user.message",
                    text: "Make iOS completed turns match the desktop chat presentation.",
                    createdAt: 1_000
                ),
            ],
            cursor: 1,
            runs: [ActiveRun(id: "run-1", threadId: "visual-thread", status: "running", startedAt: 0)]
        ))
        chat.fold(event(
            id: "think-read",
            cursor: 2,
            kind: "thinking.delta",
            runId: "run-1",
            text: "Inspecting the transcript grouping and file-reference markdown renderer.",
            createdAt: 2_000
        ))
        chat.fold(event(
            id: "read-transcript",
            cursor: 3,
            kind: "tool.start",
            runId: "run-1",
            text: "apps/ios/Graft/Views/Chat/TranscriptView.swift",
            toolName: "Read",
            createdAt: 3_000
        ))
        chat.fold(event(
            id: "read-transcript",
            cursor: 4,
            kind: "tool.end",
            runId: "run-1",
            text: "Read apps/ios/Graft/Views/Chat/TranscriptView.swift",
            toolName: "Read",
            createdAt: 5_000
        ))
        chat.fold(event(
            id: "edit-row",
            cursor: 5,
            kind: "tool.start",
            runId: "run-1",
            text: "apps/ios/Graft/Views/Chat/TranscriptRow.swift",
            toolName: "Edit",
            createdAt: 6_000
        ))
        chat.fold(event(
            id: "edit-row",
            cursor: 6,
            kind: "tool.end",
            runId: "run-1",
            text: "Updated apps/ios/Graft/Views/Chat/TranscriptRow.swift",
            toolName: "Edit",
            createdAt: 8_000
        ))
        chat.fold(event(
            id: "reply",
            cursor: 7,
            kind: "assistant.delta",
            runId: "run-1",
            text: Self.fileReferenceTranscriptAnswer,
            createdAt: 9_000
        ))
        chat.fold(event(
            id: "reply",
            cursor: 8,
            kind: "assistant.message",
            runId: "run-1",
            text: Self.fileReferenceTranscriptAnswer,
            createdAt: 10_000,
            completedAt: 10_000
        ))
        chat.fold(event(
            id: "done",
            cursor: 9,
            kind: "run.status",
            runId: "run-1",
            runStatus: "completed",
            createdAt: 10_000
        ))

        for item in chat.items where item.kind == .assistant {
            item.richContentAttached = true
        }

        return TranscriptScenario(app: app, chat: chat, fileLinks: fileLinks)
    }

    private enum LiveStatusFixtureStage {
        case thinking
        case textAndTool
        case settled
    }

    private func makeInterleavedStreamingScenario(stage: LiveStatusFixtureStage) -> TranscriptScenario {
        let app = AppModel(store: LocalStore(inMemory: true))
        let chat = ChatModel(threadId: "visual-thread", title: "Visual live status check")

        chat.applySnapshot(snapshot(
            events: [
                event(
                    id: "user-live",
                    cursor: 1,
                    kind: "user.message",
                    text: "Keep the iOS live thinking indicator stable while text and tools interleave.",
                    createdAt: 1_000
                ),
            ],
            cursor: 1,
            runs: [ActiveRun(id: "run-live", threadId: "visual-thread", status: "running", startedAt: 0)]
        ))
        chat.fold(event(
            id: "live-think",
            cursor: 2,
            kind: "thinking.delta",
            runId: "run-live",
            text: "Checking the streaming footer before any visible answer text.",
            createdAt: 2_000
        ))
        guard stage != .thinking else { return TranscriptScenario(app: app, chat: chat) }

        chat.fold(event(
            id: "live-reply",
            cursor: 3,
            kind: "assistant.delta",
            runId: "run-live",
            text: "I’m keeping the answer text visible while the status line continues to report work.",
            createdAt: 3_000
        ))
        chat.fold(event(
            id: "live-tool",
            cursor: 4,
            kind: "tool.start",
            runId: "run-live",
            text: "apps/ios/Graft/Views/Chat/LiveStatusLine.swift",
            toolName: "Read",
            createdAt: 4_000
        ))
        chat.fold(event(
            id: "live-think",
            cursor: 5,
            kind: "thinking.delta",
            runId: "run-live",
            text: "The tool frame arrived after text, and the footer should stay mounted.",
            createdAt: 5_000
        ))
        guard stage != .settled else {
            chat.fold(event(
                id: "live-tool",
                cursor: 6,
                kind: "tool.end",
                runId: "run-live",
                text: "Read apps/ios/Graft/Views/Chat/LiveStatusLine.swift",
                toolName: "Read",
                createdAt: 6_000
            ))
            chat.fold(event(
                id: "live-reply",
                cursor: 7,
                kind: "assistant.message",
                runId: "run-live",
                text: "I’m keeping the answer text visible while the status line continues to report work.",
                createdAt: 7_000,
                completedAt: 7_000
            ))
            chat.fold(event(
                id: "live-done",
                cursor: 8,
                kind: "run.status",
                runId: "run-live",
                runStatus: "completed",
                createdAt: 7_000
            ))
            return TranscriptScenario(app: app, chat: chat)
        }

        return TranscriptScenario(app: app, chat: chat)
    }

    private func makeSentSkillUserBubbleScenario(text: String, skill: MessageSkill) -> TranscriptScenario {
        let app = AppModel(store: LocalStore(inMemory: true))
        let chat = ChatModel(threadId: "visual-thread", title: "Visual sent skill check")

        chat.applySnapshot(snapshot(
            events: [
                event(
                    id: "user-skill",
                    cursor: 1,
                    kind: "user.message",
                    text: text,
                    createdAt: 1_000,
                    skills: [skill]
                ),
                event(
                    id: "reply-skill",
                    cursor: 2,
                    kind: "assistant.message",
                    text: "Skill metadata should decorate only the sent user command token.",
                    createdAt: 2_000,
                    completedAt: 2_000
                ),
            ],
            cursor: 2
        ))

        for item in chat.items where item.kind == .assistant {
            item.richContentAttached = true
        }

        return TranscriptScenario(app: app, chat: chat)
    }

    private func makeAssistantSkillReferenceScenario(
        skill: MessageSkill,
        answer: String,
        isStreaming: Bool = false
    ) -> TranscriptScenario {
        let app = AppModel(store: LocalStore(inMemory: true))
        let chat = ChatModel(threadId: "visual-thread", title: "Visual assistant skill check")
        let runs = isStreaming
            ? [ActiveRun(id: "run-skill-reference", threadId: "visual-thread", status: "running", startedAt: 1_000)]
            : []
        chat.applySnapshot(snapshot(
            events: [
                event(
                    id: "user-skill-reference", cursor: 1, kind: "user.message",
                    text: "/\(skill.name) what does this skill do?", createdAt: 1_000, skills: [skill]
                ),
            ],
            cursor: 1,
            runs: runs
        ))
        chat.fold(event(
            id: "reply-skill-reference", cursor: 2,
            kind: isStreaming ? "assistant.delta" : "assistant.message", runId: "run-skill-reference",
            text: answer, createdAt: 2_000, completedAt: isStreaming ? nil : 2_000
        ))
        for item in chat.items where item.kind == .assistant {
            item.richContentAttached = true
        }
        return TranscriptScenario(app: app, chat: chat)
    }

    private func makeTaskProgressScenario() -> TranscriptScenario {
        let app = AppModel(store: LocalStore(inMemory: true))
        let chat = ChatModel(threadId: "visual-thread", title: "Visual task progress check")

        chat.applySnapshot(snapshot(
            events: [
                event(id: "user", cursor: 1, kind: "user.message", text: "Tighten the iOS chat streaming presentation."),
                event(
                    id: "plan",
                    cursor: 2,
                    kind: "plan.update",
                    runId: "run-1",
                    data: TimelineTaskData(
                        type: "plan",
                        title: "Polish chat response",
                        steps: Self.taskProgressItems,
                        todos: nil
                    )
                ),
            ],
            cursor: 2,
            runs: [ActiveRun(id: "run-1", threadId: "visual-thread", status: "running", startedAt: 0)]
        ))

        return TranscriptScenario(app: app, chat: chat)
    }

    private func event(
        id: String,
        cursor: Int,
        kind: String,
        threadId: String = "visual-thread",
        runId: String? = nil,
        text: String? = nil,
        toolName: String? = nil,
        runStatus: String? = nil,
        data: TimelineTaskData? = nil,
        createdAt: Int = 0,
        completedAt: Int? = nil,
        skills: [MessageSkill]? = nil
    ) -> TimelineEvent {
        var event = TimelineEvent(
            id: id,
            cursor: cursor,
            kind: kind,
            threadId: threadId,
            runId: runId,
            createdAt: createdAt,
            text: text,
            toolName: toolName,
            approvalId: nil,
            questionId: nil,
            diffId: nil,
            runStatus: runStatus,
            data: data
        )
        event.completedAt = completedAt
        event.skills = skills
        return event
    }

    private func snapshot(
        events: [TimelineEvent],
        cursor: Int,
        runs: [ActiveRun] = []
    ) -> EnvironmentSnapshot {
        EnvironmentSnapshot(
            environment: EnvironmentInfo(
                id: "env-visual",
                label: "Visual Test Mac",
                hostVersion: nil,
                protocolVersion: 1,
                capabilities: [],
                cursor: cursor
            ),
            projects: [],
            threads: [
                ThreadInfo(
                    id: "visual-thread",
                    projectId: "project-visual",
                    title: "Visual markdown check",
                    updatedAt: 0,
                    status: runs.isEmpty ? "completed" : "running",
                    preview: nil,
                    modelName: "gpt-6-astra",
                    providerId: "openai",
                    mode: "local"
                ),
            ],
            activeRuns: runs,
            pendingApprovals: [],
            pendingQuestions: [],
            selectedTranscript: TranscriptContainer(
                threadId: "visual-thread",
                cursor: cursor,
                events: events
            ),
            cursor: cursor
        )
    }

    private func describeHierarchy(_ view: UIView, depth: Int = 0) -> String {
        var visited: Set<ObjectIdentifier> = []
        return describeHierarchy(view, depth: depth, visited: &visited)
    }

    private func describeHierarchy(_ view: UIView, depth: Int, visited: inout Set<ObjectIdentifier>) -> String {
        let indent = String(repeating: "  ", count: depth)
        let frame = view.frame.integral
        let current = "\(indent)\(describeAccessibilityObject(view, frame: frame))"
        let accessibilityLines = accessibilityChildren(of: view)
            .map { describeAccessibilityTree($0, depth: depth + 1, visited: &visited) }
        let viewLines = view.subviews.map { describeHierarchy($0, depth: depth + 1, visited: &visited) }
        let children = (accessibilityLines + viewLines).joined(separator: "\n")
        return children.isEmpty ? current : "\(current)\n\(children)"
    }

    private func describeAccessibilityTree(_ object: Any, depth: Int, visited: inout Set<ObjectIdentifier>) -> String {
        let indent = String(repeating: "  ", count: depth)
        let current = "\(indent)accessibility \(describeAccessibilityObject(object, frame: nil))"
        guard let object = object as? NSObject else { return current }
        let identifier = ObjectIdentifier(object)
        guard !visited.contains(identifier) else { return current }
        visited.insert(identifier)
        let children = accessibilityChildren(of: object)
            .map { describeAccessibilityTree($0, depth: depth + 1, visited: &visited) }
            .joined(separator: "\n")
        return children.isEmpty ? current : "\(current)\n\(children)"
    }

    private func describeAccessibilityObject(_ object: Any, frame: CGRect?) -> String {
        let objectType = String(describing: type(of: object))
        let frameText = frame.map { " frame=\($0.integral)" } ?? ""
        let identifier = (object as? UIAccessibilityIdentification)?.accessibilityIdentifier.map { " id=\($0)" } ?? ""
        let object = object as? NSObject
        let label = object?.accessibilityLabel.map { " label=\($0)" } ?? ""
        let value = object?.accessibilityValue.map { " value=\($0)" } ?? ""
        let hint = object?.accessibilityHint.map { " hint=\($0)" } ?? ""
        let traits = object.map { " traits=\($0.accessibilityTraits.rawValue)" } ?? ""
        let actions = object?.accessibilityCustomActions?.map(\.name).joined(separator: ",").nilIfEmpty.map { " actions=\($0)" } ?? ""
        let accessibilityFrame = object.map { " axFrame=\($0.accessibilityFrame.integral)" } ?? ""
        return "\(objectType)\(frameText)\(accessibilityFrame)\(identifier)\(label)\(value)\(hint)\(traits)\(actions)"
    }
}

private struct MarkdownFixtureVariant {
    let name: String
    let colorScheme: ColorScheme
    let dynamicTypeSize: DynamicTypeSize
}

private struct TaskProgressFixtureVariant {
    let name: String
    let colorScheme: ColorScheme
    let dynamicTypeSize: DynamicTypeSize
}

private struct TranscriptScenario {
    let app: AppModel
    let chat: ChatModel
    let fileLinks: WorkspaceFileLinks?

    init(app: AppModel, chat: ChatModel, fileLinks: WorkspaceFileLinks? = nil) {
        self.app = app
        self.chat = chat
        self.fileLinks = fileLinks
    }
}

private struct ViewCapture {
    let image: UIImage
    let hierarchy: String
}

private struct ThreadComposerDockCapture {
    let collapsed: ViewCapture
    let expanded: ViewCapture
    let didActivateToggle: Bool
    let didActivateScrollToLatest: Bool
    let scrollToLatestTickBeforeTap: Int
    let scrollToLatestTickAfterTap: Int
    let collapsedComposerFrame: CGRect
    let expandedComposerFrame: CGRect
}

private struct ActiveFooterControlsCapture {
    let capture: ViewCapture
    let statusFrame: CGRect
    let composerFrame: CGRect
}

private struct ComposerSkillTokenCapture {
    let capture: ViewCapture
    let plainText: String
    let hasSkillAttachment: Bool
}

private struct DiffBubbleSheetCapture {
    let beforeTap: ViewCapture
    let afterTap: ViewCapture
    let beforeTapFocusedComposer: Bool
    let afterTapFocusedComposer: Bool
    let didActivateDiff: Bool
    let visibleDiffButtonCount: Int
}

private struct WorkspaceFileSelectionCapture {
    let beforeTap: ViewCapture
    let afterTap: ViewCapture
    let didActivateLink: Bool
    let linkURL: URL?
    let didOpenLinkURL: Bool
    let selectedPath: String?
    let selectedLine: Int?
}

private struct CompletedWorkDisclosureCapture {
    let collapsed: ViewCapture
    let expanded: ViewCapture
    let didActivateDisclosure: Bool
}

private struct LiveStatusMotionCapture {
    let first: ViewCapture
    let second: ViewCapture
}

private struct ComposerSlashOverlayCapture {
    let before: ViewCapture
    let after: ViewCapture
    let beforeTranscriptFrame: CGRect
    let afterTranscriptFrame: CGRect
    let beforeComposerFrame: CGRect
    let afterComposerFrame: CGRect
    let afterSlashPaletteFrame: CGRect
}

private struct DiffBubbleSheetFixture: View {
    let chat: ChatModel
    let diff: DiffSummary
    @State private var presentedDiff: DiffSummary?

    init(chat: ChatModel, diff: DiffSummary) {
        self.chat = chat
        self.diff = diff
        _presentedDiff = State(initialValue: nil)
    }

    var body: some View {
        VStack(spacing: 12) {
            Spacer(minLength: 0)
            ComposerDiffBubbleStrip(
                diffs: [
                    ComposerDiffPresentation(id: "empty", title: "Empty diff", files: []),
                    ComposerDiffPresentation(
                        id: diff.id,
                        title: diff.title,
                        files: diff.files.map {
                            ComposerDiffFilePresentation(
                                path: $0.path,
                                additions: $0.additions ?? 0,
                                deletions: $0.deletions ?? 0
                            )
                        }
                    ),
                ],
                onOpenDiff: { _ in presentedDiff = diff }
            )
            .padding(.horizontal, 12)
            ComposerView(chat: chat, siblingChromeHeight: 0)
        }
        .padding(.bottom, 18)
        .frame(width: 440, height: 720, alignment: .bottom)
        .background(DS.Color.bg)
        .sheet(item: $presentedDiff) { diff in
            DiffSheet(diff: diff, loadFile: { _ in nil })
                .presentationDetents([.medium, .large])
                .presentationDragIndicator(.visible)
                .presentationBackgroundInteraction(.disabled)
                .presentationCornerRadius(DS.Radius.xl)
        }
    }
}

private struct SlashPaletteFixture: View {
    let onPick: (ComposerCommand) -> Void

    var body: some View {
        VStack {
            Spacer(minLength: 0)
            SlashPalette(completions: MarkdownVisualCheckTests.slashCommands, onPick: onPick)
        }
        .frame(width: 440, height: 220, alignment: .bottom)
        .background(DS.Color.bg)
    }
}

private struct ComposerSlashOverlayFixture: View {
    let chat: ChatModel

    var body: some View {
        VStack(spacing: 0) {
            Text("Transcript content stays fixed while slash commands overlay the composer.")
                .font(.subheadline)
                .foregroundStyle(DS.Color.fgSubtle)
                .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
                .padding(20)
                .accessibilityIdentifier("slash-overlay-transcript-marker")
            ComposerView(chat: chat, siblingChromeHeight: 0)
        }
        .frame(width: 440, height: 620, alignment: .bottom)
        .background(DS.Color.bg)
    }
}

private struct ThreadComposerDockFixture: View {
    let chat: ChatModel

    var body: some View {
        VStack(spacing: 0) {
            Text("Transcript content stays fixed while bottom chrome overlays upward.")
                .font(.subheadline)
                .foregroundStyle(DS.Color.fgSubtle)
                .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
                .padding(20)
                .accessibilityIdentifier("transcript-stability-marker")
            ThreadComposerDock(chat: chat)
        }
        .frame(width: 440, height: 620, alignment: .bottom)
        .background(DS.Color.bg)
    }
}

private struct LiveStatusMotionFixture: View {
    var body: some View {
        HStack(spacing: 10) {
            RunStatusDotMatrixLoader(size: 18, tint: DS.Color.fgSubtle)
            ShimmerText(text: "Reading files", font: .subheadline)
        }
        .padding(.horizontal, 18)
        .padding(.vertical, 14)
        .frame(width: 360, height: 160, alignment: .center)
        .background(DS.Color.bg)
        .accessibilityElement(children: .combine)
        .accessibilityLabel("Reading files")
    }
}

private struct ActiveTranscriptWithControlsFixture: View {
    let chat: ChatModel
    var fileLinks: WorkspaceFileLinks?

    var body: some View {
        ZStack {
            DS.Color.bg.ignoresSafeArea()
            TranscriptView(chat: chat)
                .modifier(WorkspaceFilePresenter(links: fileLinks ?? chat.fileLinks))
        }
        .safeAreaInset(edge: .bottom, spacing: 0) {
            ThreadComposerDock(chat: chat)
        }
        .frame(width: 440, height: 956, alignment: .topLeading)
        .background(DS.Color.bg)
    }
}

private struct TranscriptVisualFixture: View {
    let chat: ChatModel
    var fileLinks: WorkspaceFileLinks?

    var body: some View {
        TranscriptView(chat: chat)
            .modifier(WorkspaceFilePresenter(links: fileLinks ?? chat.fileLinks))
            .frame(width: 440, height: 956, alignment: .topLeading)
            .background(DS.Color.bg)
    }
}

private struct MarkdownVisualFixture: View {
    let markdown: String
    let height: CGFloat

    var body: some View {
        VStack(alignment: .leading, spacing: 18) {
            MarkdownText(markdown)
                .fixedSize(horizontal: false, vertical: true)
        }
        .padding(.horizontal, 20)
        .padding(.vertical, 24)
        .frame(width: 390, height: height, alignment: .topLeading)
        .background(DS.Color.bg)
    }
}

private extension MarkdownVisualCheckTests {
    static let proseFixture = """
    # Streaming markdown check

    The assistant response should keep readable spacing, desktop-blue links like [OpenAI](https://openai.com), a bare URL https://example.com/path, and inline code such as `pnpm dev`.

    > Quoted context should keep its left accent and wrap across multiple lines without crowding the surrounding answer.

    1. First ordered item with a long sentence that wraps on iPhone width.
       - Nested bullet under the first step.
       - [ ] Nested task that is still pending.
    2. Second ordered item after the nested bullets.
       - [x] Finished task marker.
       - Mixed bullet content with `inline code`.
    """

    static let codeTableFixture = """
    ## Code and data

    ```swift
    struct MessageChunk {
        let text: String
        let isFinal: Bool
    }
    ```

    | State | Expected UI |
    | --- | --- |
    | Thinking | One loader below the active assistant message |
    | Streaming | Text appends cumulatively without duplicate loaders |
    | Final | Loader clears and provider stays locked |

    Keep table columns legible and preserve code block contrast in light, dark, and large Dynamic Type renders.
    """

    static let taskProgressItems = [
        TaskProgressItem(id: "inspect", title: "Review iOS transcript final answer spacing", status: .done),
        TaskProgressItem(id: "links", title: "Compare blue link and border treatments with the desktop chat surface", status: .active),
        TaskProgressItem(id: "streaming", title: "Check that the loader clears after the final streamed text settles", status: .pending),
        TaskProgressItem(id: "provider", title: "Confirm provider switching is locked after the first user message", status: .pending),
        TaskProgressItem(id: "install", title: "Install the latest build on Brent’s iPhone and capture visual evidence", status: .done),
    ]

    static let zeroLineDiffSummary = DiffSummary(
        id: "diff-zero-line",
        threadId: "visual-thread",
        runId: "run-1",
        title: "Focused diff",
        files: [
            DiffFile(
                path: "apps/ios/Graft/Views/Chat/ComposerDiffBubble.swift",
                status: "modified",
                additions: 0,
                deletions: 0,
                previousPath: nil,
                hunks: nil,
                detailStatus: nil
            ),
        ],
        updatedAt: 0
    )

    static let tasksSkillCommand = ComposerCommand(
        name: "tasks",
        description: "Show task progress",
        kind: "skill",
        displayName: "Tasks"
    )

    static let tasksMessageSkill = MessageSkill(name: "tasks", displayName: "Tasks")

    static let frontendDesignMessageSkill = MessageSkill(name: "frontend-design", displayName: "Frontend Design")

    static let assistantSkillReferenceAnswer = """
    `$frontend-design` is a UI implementation skill for building polished web interfaces.

    It’s meant for tasks like building a landing page, refining layouts, and making an existing screen feel finished.

    Use /frontend-design for the next page.
    """

    static let assistantSkillReferenceLiteralAnswer = """
    `$frontend-design` is a prose reference.

    Shell command: `echo $frontend-design`

    ```sh
    export SKILL=$frontend-design
    ```

    Authored link: [$frontend-design](https://example.com/skills/frontend-design).

    Unknown reference: `$unknown-skill`.
    """

    static let slashCommands = [
        ComposerCommand(name: "model", description: "Change model for the next turn", kind: "model"),
        ComposerCommand(name: "review", description: "Review the current diff", kind: "native"),
        ComposerCommand(name: "fix", description: "Fix the selected issue", kind: "native"),
        tasksSkillCommand,
    ]

    static let transcriptPrompt = """
    Clean up the final chat answer presentation on iOS and make the Markdown match desktop.
    """

    static let transcriptSetup = """
    I found the chat presentation path. The next render should show completed assistant prose, then work activity, then the final response with its normal controls.
    """

    static let transcriptAnswer = """
    ## Work summary

    I tightened the streaming path so the final answer settles cleanly after the last delta. The loader clears when text is visible, and the action row appears only after completion.

    The Markdown renderer now keeps authored links blue, including [desktop reference](https://example.com/reference), while inline code like `TranscriptView` stays readable in the body copy.

    - Completed the parser updates for end-of-turn prose.
    - Matched the assistant paragraphs against the desktop chat surface.
    - Kept the provider locked after the first user message.
    """

    static let resolvedFixtureFileMap = [
        "apps/ios/Graft/Views/Chat/TranscriptView.swift": "apps/ios/Graft/Views/Chat/TranscriptView.swift",
        "apps/ios/Graft/Views/Chat/TranscriptRow.swift": "apps/ios/Graft/Views/Chat/TranscriptRow.swift",
        "apps/ios/Graft/Views/Shared/MarkdownText.swift": "apps/ios/Graft/Views/Shared/MarkdownText.swift",
        "apps/web/src/components/chat/MessagesTimeline.tsx": "apps/web/src/components/chat/MessagesTimeline.tsx",
        "docs/core-concepts.md": "docs/core-concepts.md",
    ]

    static let resolvedFixtureFilePaths = Array(resolvedFixtureFileMap.keys).sorted()

    static let fileReferenceTranscriptAnswer = """
    The completed turn should keep the work collapsed above this final response, then leave the answer itself easy to scan.

    File references should render as blue tappable targets with type icons across bare paths, inline code, and authored file links:

    - apps/ios/Graft/Views/Chat/TranscriptView.swift
    - `apps/ios/Graft/Views/Chat/TranscriptRow.swift`
    - [Markdown renderer](apps/ios/Graft/Views/Shared/MarkdownText.swift#L508)
    - apps/web/src/components/chat/MessagesTimeline.tsx
    - docs/core-concepts.md

    This gives the post-implementation screenshot one real transcript row with work, prose, and mixed file types in the same completed turn.
    """
}


private extension String {
    var nilIfEmpty: String? { isEmpty ? nil : self }
}

private struct ThreadUsagePopoverFixture: View {
    let context: ContextUsageInfo
    let allowance: ProviderAllowanceInfo
    @State private var presented = false

    var body: some View {
        NavigationStack {
            Color.white
                .navigationTitle("Conversation")
                .navigationBarTitleDisplayMode(.inline)
                .toolbar {
                    ToolbarItem(placement: .topBarTrailing) {
                        Button { presented = true } label: { Image(systemName: "chart.pie") }
                            .popover(isPresented: $presented) {
                                ThreadUsageDetails(context: context, allowance: allowance,
                                    loading: false, failed: false, onRetry: {})
                                    .presentationCompactAdaptation(.popover)
                            }
                    }
                }
        }
        .environment(\.colorScheme, .light)
        .task {
            try? await Task.sleep(for: .milliseconds(250))
            presented = true
        }
    }
}
