import XCTest
@testable import Graft

final class GatewayHandshakeTests: XCTestCase {
    func testHelloFrameContainsThePairedSessionBeforeWelcome() throws {
        let text = try GatewayHandshake.helloText(
            ClientHello(sessionId: "session-123", afterCursor: nil)
        )
        let json = try XCTUnwrap(
            JSONSerialization.jsonObject(with: Data(text.utf8)) as? [String: Any]
        )

        XCTAssertEqual(json["envelope"] as? String, "hello")
        XCTAssertEqual(json["protocolVersion"] as? Int, 1)
        XCTAssertEqual(json["sessionId"] as? String, "session-123")
    }

    func testAcceptsOnlyAWelcomeAsTheFirstHostFrame() throws {
        let welcome = """
        {"envelope":"welcome","protocolVersion":1,"capabilities":["projects"],"environmentId":"env-1","environmentLabel":"Studio","cursor":0}
        """

        let data = try GatewayHandshake.validatedWelcomeData(.string(welcome))
        XCTAssertEqual(try JSONDecoder().decode(HostWelcome.self, from: data).environmentId, "env-1")

        XCTAssertThrowsError(
            try GatewayHandshake.validatedWelcomeData(.string(#"{"envelope":"pong","at":1}"#))
        )
    }

    func testSurfacesHostErrorDuringHandshake() {
        let errorFrame = """
        {"envelope":"error","error":{"code":"device_revoked","message":"session_revoked","retryable":false}}
        """

        XCTAssertThrowsError(
            try GatewayHandshake.validatedWelcomeData(.string(errorFrame))
        ) { error in
            XCTAssertEqual(
                error as? GraftError,
                .hostError(
                    code: "device_revoked",
                    message: "session_revoked",
                    retryable: false
                )
            )
        }
    }

    func testRevokedHandshakeErrorsAreNotRetryable() {
        XCTAssertFalse(
            GraftError.hostError(
                code: "device_revoked",
                message: "session_revoked",
                retryable: false
            ).isRetryable
        )
        XCTAssertTrue(GraftError.unreachable("offline").isRetryable)
    }
}
