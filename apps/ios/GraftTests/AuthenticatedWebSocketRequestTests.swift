import XCTest
@testable import Graft

final class AuthenticatedWebSocketRequestTests: XCTestCase {
    func testUsesAuthorizationHeaderWithoutLeakingBearerTokenIntoURL() throws {
        let request = try AuthenticatedWebSocketRequest.make(
            baseURL: "wss://studio.example/v1/ws?token=stale&transport=websocket",
            sessionId: "session-123",
            bearerToken: "secret-bearer-token"
        )

        XCTAssertEqual(request.value(forHTTPHeaderField: "Authorization"), "Bearer secret-bearer-token")

        let components = try XCTUnwrap(URLComponents(url: try XCTUnwrap(request.url), resolvingAgainstBaseURL: false))
        let queryItems = components.queryItems ?? []
        XCTAssertEqual(components.path, "/v1/ws")
        XCTAssertEqual(queryItems.first(where: { $0.name == "sessionId" })?.value, "session-123")
        XCTAssertEqual(queryItems.first(where: { $0.name == "transport" })?.value, "websocket")
        XCTAssertFalse(queryItems.contains(where: { $0.name == "token" }))
        XCTAssertFalse(try XCTUnwrap(request.url).absoluteString.contains("secret-bearer-token"))
    }

    func testResolvesDesktopPairResponseBaseURLToGatewayWebSocketRoute() throws {
        let response = try decodeFixture("pair-response.json", as: PairResponse.self)
        let session = try XCTUnwrap(response.session)

        let request = try AuthenticatedWebSocketRequest.make(
            baseURL: session.wsBaseUrl,
            sessionId: session.sessionId,
            bearerToken: session.bearerToken
        )

        let components = try XCTUnwrap(
            URLComponents(url: try XCTUnwrap(request.url), resolvingAgainstBaseURL: false)
        )
        XCTAssertEqual(components.path, "/v1/ws")
        XCTAssertEqual(
            components.queryItems?.first(where: { $0.name == "sessionId" })?.value,
            session.sessionId
        )
        XCTAssertFalse(try XCTUnwrap(request.url).absoluteString.contains(session.bearerToken))
    }

    func testRejectsEmptyBearerToken() {
        XCTAssertThrowsError(
            try AuthenticatedWebSocketRequest.make(
                baseURL: "wss://studio.example/v1/ws",
                sessionId: "session-123",
                bearerToken: ""
            )
        ) { error in
            XCTAssertEqual(error as? GraftError, .unauthorized)
        }
    }
}
