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

    func testSidebarWidthsStayUsableInPortraitAndLandscape() {
        XCTAssertLessThan(AdaptiveChrome.sidebarMinWidth, AdaptiveChrome.sidebarIdealWidth)
        XCTAssertLessThan(AdaptiveChrome.sidebarIdealWidth, AdaptiveChrome.sidebarMaxWidth)
        // iPad Mini portrait (744) and 11-inch portrait (834) still leave a
        // usable chat column when the ideal sidebar is visible.
        XCTAssertGreaterThan(744 - AdaptiveChrome.sidebarIdealWidth, 360)
        XCTAssertGreaterThan(834 - AdaptiveChrome.sidebarIdealWidth, 480)
    }
}
