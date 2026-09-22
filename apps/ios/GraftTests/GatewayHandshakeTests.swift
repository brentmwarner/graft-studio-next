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

@MainActor
final class GatewayRecoveryTests: XCTestCase {
    func testCertificateFailureReachesTheMachineOwnerAndStopsRetrying() async {
        let factory = FakeGatewaySocketFactory()
        let gateway = makeGateway(factory)
        defer { gateway.disconnect() }
        var reported: GraftError?
        gateway.onFailure = { reported = $0 }
        gateway.requestProvider = { throw URLError(.serverCertificateUntrusted) }
        gateway.nudge()
        await waitUntil { reported != nil }
        XCTAssertFalse(reported?.isOffline ?? true)
        XCTAssertFalse(reported?.isRetryable ?? true)
        if case .disconnected = gateway.state {} else { XCTFail("Certificate failures must stop retrying") }
        XCTAssertTrue(factory.sockets.isEmpty)
    }

    func testRevokedHandshakeReachesTheMachineOwnerBeforeAnyWelcome() async {
        let factory = FakeGatewaySocketFactory()
        let gateway = makeGateway(factory)
        defer { gateway.disconnect() }
        var reported: GraftError?
        gateway.onFailure = { reported = $0 }
        gateway.nudge()
        await waitUntil { factory.sockets.count == 1 }
        factory.sockets[0].push(.string("""
        {"envelope":"error","error":{"code":"device_revoked","message":"Revoked","retryable":false}}
        """))
        await waitUntil { reported != nil }
        XCTAssertEqual(reported, .hostError(code: "device_revoked", message: "Revoked", retryable: false))
        XCTAssertTrue(factory.sockets[0].cancelled)
        XCTAssertEqual(factory.sockets.count, 1)
    }

    func testNetworkHandoffReplacesTheOldConnectionAndKeepsTheResumeCursor() async throws {
        let factory = FakeGatewaySocketFactory()
        let gateway = makeGateway(factory)
        defer { gateway.disconnect() }
        gateway.networkChanged(available: true, interfaces: ["en0"])
        gateway.nudge()
        await waitUntil { factory.sockets.count == 1 }
        let first = factory.sockets[0]
        first.welcome()
        await waitUntil { gateway.state == .connected }

        gateway.networkChanged(available: true, interfaces: ["pdp_ip0"])
        await waitUntil { factory.sockets.count == 2 }
        XCTAssertTrue(first.cancelled)
        let replacement = factory.sockets[1]
        let hello = try XCTUnwrap(replacement.sent.first)
        XCTAssertEqual(try decode(hello)["afterCursor"] as? Int, 40)
        replacement.welcome()
        await waitUntil { gateway.state == .connected }
        gateway.networkChanged(available: true, interfaces: ["pdp_ip0"])
        XCTAssertEqual(factory.sockets.count, 2)
    }

    func testLateWelcomeFromSupersededHandshakeCannotClearTheNewSocket() async {
        let factory = FakeGatewaySocketFactory()
        let gateway = makeGateway(factory)
        defer { gateway.disconnect() }
        gateway.networkChanged(available: true, interfaces: ["en0"])
        let connecting = Task { try await gateway.ensureConnected() }
        await waitUntil { factory.sockets.count == 1 }
        let old = factory.sockets[0]
        old.ignoreCancellation = true
        gateway.networkChanged(available: true, interfaces: ["pdp_ip0"])
        await waitUntil { factory.sockets.count == 2 }
        factory.sockets[1].welcome()
        await waitUntil { gateway.state == .connected }
        old.welcome()
        do {
            try await connecting.value
            XCTFail("A superseded handshake must fail")
        } catch {}
        XCTAssertEqual(gateway.state, .connected)
        XCTAssertFalse(factory.sockets[1].cancelled)
    }

    func testBackgroundingFailsHandshakeWaitersAndPreventsNetworkRedialUntilForeground() async {
        let factory = FakeGatewaySocketFactory()
        let gateway = makeGateway(factory)
        defer { gateway.disconnect() }
        let first = Task { try await gateway.ensureConnected() }
        await waitUntil { factory.sockets.count == 1 }
        var waiting = false
        let waiter = Task {
            waiting = true
            try await gateway.ensureConnected()
        }
        await waitUntil { waiting }
        gateway.suspendForBackground()
        gateway.networkChanged(available: false, interfaces: [])
        gateway.networkChanged(available: true, interfaces: ["pdp_ip0"])
        for task in [first, waiter] {
            do {
                try await task.value
                XCTFail("Backgrounding must release connection waiters")
            } catch {}
        }
        XCTAssertEqual(factory.sockets.count, 1)
        XCTAssertEqual(gateway.state, .idle)
        gateway.nudge()
        await waitUntil { factory.sockets.count == 2 }
    }

    func testMissingWelcomeHasADeadlineWithoutAnyCommandWaiting() async {
        let factory = FakeGatewaySocketFactory()
        let gateway = makeGateway(factory, handshake: .milliseconds(20))
        defer { gateway.disconnect() }
        gateway.nudge()
        await waitUntil { factory.sockets.count >= 2 }
        XCTAssertTrue(factory.sockets[0].cancelled)
    }

    func testHeartbeatRequiresTheMatchingApplicationPongFromStudio() async throws {
        let factory = FakeGatewaySocketFactory()
        let gateway = makeGateway(factory)
        defer { gateway.disconnect() }
        gateway.nudge()
        await waitUntil { factory.sockets.count == 1 }
        let wire = factory.sockets[0]
        wire.welcome()
        await waitUntil { gateway.state == .connected }
        gateway.nudge()
        await waitUntil { wire.sent.count == 2 }
        let ping = try decode(wire.sent[1])
        XCTAssertEqual(ping["envelope"] as? String, "ping")
        let at = try XCTUnwrap(ping["at"] as? Int)
        wire.push(.string("{\"envelope\":\"pong\",\"at\":\(at)}"))
        try await Task.sleep(for: .milliseconds(60))
        XCTAssertFalse(wire.cancelled)

        gateway.nudge()
        await waitUntil { wire.sent.count == 3 }
        // A delayed reply to the previous ping cannot satisfy the new probe.
        wire.push(.string("{\"envelope\":\"pong\",\"at\":\(at)}"))
        await waitUntil { factory.sockets.count == 2 }
        XCTAssertTrue(wire.cancelled)
    }

    private func makeGateway(
        _ factory: FakeGatewaySocketFactory,
        handshake: Duration = .seconds(2)
    ) -> GatewayClient {
        let gateway = GatewayClient(
            monitorNetwork: false,
            timing: GatewayConnectionTiming(handshake: handshake, heartbeat: .seconds(600), pong: .milliseconds(30)),
            makeSocket: { _ in factory.make() }
        )
        gateway.reconnectPolicy = ReconnectPolicy(baseDelay: .milliseconds(1), maxDelay: .seconds(1), jitterFactor: 0)
        gateway.requestProvider = { URLRequest(url: URL(string: "wss://relay.test/e/studio/v1/ws")!) }
        gateway.helloProvider = { ClientHello(sessionId: "session-1", afterCursor: 40) }
        return gateway
    }

    private func waitUntil(_ predicate: @MainActor () -> Bool, file: StaticString = #filePath, line: UInt = #line) async {
        let deadline = ContinuousClock.now.advanced(by: .seconds(1))
        while !predicate(), ContinuousClock.now < deadline {
            try? await Task.sleep(for: .milliseconds(1))
        }
        XCTAssertTrue(predicate(), "Timed out waiting for gateway state", file: file, line: line)
    }

    private func decode(_ message: URLSessionWebSocketTask.Message) throws -> [String: Any] {
        let data: Data
        switch message {
        case .string(let text): data = Data(text.utf8)
        case .data(let bytes): data = bytes
        @unknown default: throw GraftError.decoding("Unknown frame")
        }
        return try XCTUnwrap(JSONSerialization.jsonObject(with: data) as? [String: Any])
    }
}

@MainActor
private final class FakeGatewaySocketFactory {
    var sockets: [FakeGatewaySocket] = []
    func make() -> FakeGatewaySocket {
        let socket = FakeGatewaySocket()
        sockets.append(socket)
        return socket
    }
}

@MainActor
private final class FakeGatewaySocket: GatewaySocketTransport {
    var sent: [URLSessionWebSocketTask.Message] = []
    var cancelled = false
    var ignoreCancellation = false
    private var frames: [URLSessionWebSocketTask.Message] = []
    private var waiter: CheckedContinuation<URLSessionWebSocketTask.Message, Error>?

    func resume() {}
    func cancel(with closeCode: URLSessionWebSocketTask.CloseCode, reason: Data?) {
        cancelled = true
        if !ignoreCancellation {
            let pending = waiter
            waiter = nil
            pending?.resume(throwing: GraftError.socketClosed)
        }
    }
    func send(_ message: URLSessionWebSocketTask.Message) async throws {
        if cancelled { throw GraftError.socketClosed }
        sent.append(message)
    }
    func receive() async throws -> URLSessionWebSocketTask.Message {
        if !frames.isEmpty { return frames.removeFirst() }
        if cancelled && !ignoreCancellation { throw GraftError.socketClosed }
        return try await withCheckedThrowingContinuation { waiter = $0 }
    }
    func push(_ message: URLSessionWebSocketTask.Message) {
        if let pending = waiter {
            waiter = nil
            pending.resume(returning: message)
        } else {
            frames.append(message)
        }
    }
    func welcome() {
        push(.string("""
        {"envelope":"welcome","protocolVersion":1,"capabilities":["projects"],"environmentId":"env-1","environmentLabel":"Studio","cursor":100}
        """))
    }
}
