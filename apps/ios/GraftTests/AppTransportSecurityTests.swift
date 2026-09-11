import XCTest
@testable import Graft

@MainActor
final class AppTransportSecurityTests: XCTestCase {
    func testAllowsLocalNetworkHTTPPairing() throws {
        let ats = try XCTUnwrap(
            Bundle(for: AuthStore.self).object(forInfoDictionaryKey: "NSAppTransportSecurity")
                as? [String: Any]
        )
        XCTAssertEqual(ats["NSAllowsLocalNetworking"] as? Bool, true)
        XCTAssertNil(ats["NSAllowsArbitraryLoads"])
        let domains = try XCTUnwrap(ats["NSExceptionDomains"] as? [String: Any])
        let tsNet = try XCTUnwrap(domains["ts.net"] as? [String: Any])
        XCTAssertEqual(tsNet["NSIncludesSubdomains"] as? Bool, true)
        XCTAssertEqual(tsNet["NSExceptionAllowsInsecureHTTPLoads"] as? Bool, true)
    }
}
