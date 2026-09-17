import SwiftUI
import XCTest
@testable import Graft

final class AdaptiveChromeTests: XCTestCase {
    func testRegularHorizontalSizeClassUsesPersistentSidebar() {
        XCTAssertTrue(AdaptiveChrome.usesPersistentSidebar(horizontalSizeClass: .regular))
        XCTAssertFalse(AdaptiveChrome.usesPersistentSidebar(horizontalSizeClass: .compact))
        XCTAssertFalse(AdaptiveChrome.usesPersistentSidebar(horizontalSizeClass: nil))
    }

    func testReadableColumnWidthCapsWideContainersAndLeavesPhoneWidthsAlone() {
        XCTAssertEqual(AdaptiveChrome.readableColumnWidth(in: 1_204), 720)
        XCTAssertEqual(AdaptiveChrome.readableColumnWidth(in: 720), 720)
        XCTAssertEqual(AdaptiveChrome.readableColumnWidth(in: 390), 390)
        XCTAssertEqual(AdaptiveChrome.readableColumnWidth(in: 0), 0)
        XCTAssertEqual(AdaptiveChrome.readableColumnWidth(in: -40), 0)
    }

    func testLandscapePinsSidebarAndLeavesAReadableChatColumn() {
        let landscapes: [CGFloat] = [
            AdaptiveChrome.Canvas.iPadMiniLandscape,
            AdaptiveChrome.Canvas.iPad11Landscape,
            AdaptiveChrome.Canvas.iPad13Landscape,
        ]
        for width in landscapes {
            XCTAssertTrue(
                AdaptiveChrome.prefersPinnedSplit(containerWidth: width),
                "landscape \(width) should pin both columns"
            )
            XCTAssertEqual(
                AdaptiveChrome.preferredColumnVisibility(containerWidth: width),
                .all
            )
            let chat = AdaptiveChrome.remainingChatWidth(containerWidth: width)
            XCTAssertGreaterThanOrEqual(
                chat,
                AdaptiveChrome.readableColumnMaxWidth,
                "landscape \(width) should leave a full readable chat column"
            )
        }
    }

    func testNarrowPortraitOverlaysInsteadOfCrushingChat() {
        let portraits: [CGFloat] = [
            AdaptiveChrome.Canvas.iPadMiniPortrait,
            AdaptiveChrome.Canvas.iPad11Portrait,
        ]
        for width in portraits {
            XCTAssertFalse(
                AdaptiveChrome.prefersPinnedSplit(containerWidth: width),
                "portrait \(width) should not pin a 320pt sidebar"
            )
            XCTAssertEqual(
                AdaptiveChrome.preferredColumnVisibility(containerWidth: width),
                .automatic
            )
            XCTAssertEqual(AdaptiveChrome.readableColumnWidth(in: width), width)
        }
    }

    func testWidePortraitStillSplits() {
        let width = AdaptiveChrome.Canvas.iPad13Portrait
        XCTAssertTrue(AdaptiveChrome.prefersPinnedSplit(containerWidth: width))
        XCTAssertEqual(
            AdaptiveChrome.preferredColumnVisibility(containerWidth: width),
            .all
        )
        XCTAssertGreaterThan(
            AdaptiveChrome.remainingChatWidth(containerWidth: width),
            680
        )
    }

    func testSidebarWidthsStayUsableWhenPinned() {
        XCTAssertLessThan(AdaptiveChrome.sidebarMinWidth, AdaptiveChrome.sidebarIdealWidth)
        XCTAssertLessThan(AdaptiveChrome.sidebarIdealWidth, AdaptiveChrome.sidebarMaxWidth)
        XCTAssertEqual(
            AdaptiveChrome.pinnedSplitMinimumWidth,
            900,
            "Keep the pin threshold between 11-inch portrait (834) and 13-inch portrait (1024)"
        )
    }
}
