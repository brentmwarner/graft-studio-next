import XCTest
@testable import Graft

/// Decodes every JSON fixture in `GraftTests/Fixtures/mobile-v1/` against
/// the corresponding `Codable` type in `ProtocolModels.swift`.
///
/// Fixtures are copied from `packages/mobile-contract/protocol-fixtures/mobile-v1/valid/`
/// and must stay in sync with the shared source of truth. Run this test after
/// any protocol change to catch model drift early.
final class ProtocolFixtureTests: XCTestCase {

    // MARK: Pairing

    func testDecodePairingPayload() throws {
        let payload = try decodeFixture("pairing-payload.json", as: PairingPayload.self)
        XCTAssertEqual(payload.v, 1)
        XCTAssertFalse(payload.host.isEmpty)
        XCTAssertFalse(payload.token.isEmpty)
    }

    func testDecodePairRequest() throws {
        let req = try decodeFixture("pair-request.json", as: PairRequest.self)
        XCTAssertEqual(req.protocolVersion, 1)
        XCTAssertFalse(req.token.isEmpty)
        XCTAssertEqual(req.client.platform, "ios")
    }

    func testDecodePairResponse() throws {
        let resp = try decodeFixture("pair-response.json", as: PairResponse.self)
        XCTAssertTrue(resp.ok)
        let session = try XCTUnwrap(resp.session)
        XCTAssertFalse(session.sessionId.isEmpty)
        XCTAssertFalse(session.bearerToken.isEmpty)
    }

    func testDecodeRelayPairingPayload() throws {
        let raw = try loadFixture("pairing-payload-relay.json")
        let payload = try JSONDecoder().decode(PairingPayload.self, from: raw)
        XCTAssertEqual(payload.endpointKind, "relay")
        XCTAssertTrue(payload.host.hasPrefix("https://"))

        // The same fixture is what a QR scan hands the parser.
        let parsed = try XCTUnwrap(PairingURLParser.parse(String(decoding: raw, as: UTF8.self)))
        XCTAssertEqual(parsed.endpointKind, "relay")
        XCTAssertEqual(parsed.host, payload.host)
    }

    func testDecodeRelayPairResponse() throws {
        let resp = try decodeFixture("pair-response-relay.json", as: PairResponse.self)
        let session = try XCTUnwrap(resp.session)
        XCTAssertEqual(session.endpointKind, "relay")
        XCTAssertTrue(session.httpBaseUrl.hasPrefix("https://"))
        XCTAssertTrue(session.wsBaseUrl.hasPrefix("wss://"))
    }

    /// A relay session survives a round trip through SwiftData so the app knows
    /// it does not depend on this Mac's network after a relaunch.
    @MainActor
    func testPersistsRelayTransportAcrossRelaunch() throws {
        let store = LocalStore(inMemory: true)
        let resp = try decodeFixture("pair-response-relay.json", as: PairResponse.self)
        let session = try XCTUnwrap(resp.session)

        try store.upsertSession(
            PersistedSession(
                environmentId: session.environmentId,
                environmentLabel: session.environmentLabel,
                httpBaseUrl: session.httpBaseUrl,
                wsBaseUrl: session.wsBaseUrl,
                sessionId: session.sessionId,
                deviceId: session.deviceId,
                keychainAccount: "bearerToken:\(session.environmentId)",
                protocolVersion: session.protocolVersion,
                capabilities: session.capabilities,
                endpointKind: session.endpointKind
            )
        )

        let restored = try XCTUnwrap(try store.session(environmentId: session.environmentId))
        XCTAssertEqual(restored.endpointKind, "relay")
        XCTAssertEqual(restored.httpBaseUrl, session.httpBaseUrl)
    }

    /// Sessions paired before the relay shipped have no transport recorded and
    /// must still load.
    @MainActor
    func testPersistsSessionWithoutTransport() throws {
        let store = LocalStore(inMemory: true)
        try store.upsertSession(
            PersistedSession(
                environmentId: "env-legacy",
                environmentLabel: "Studio",
                httpBaseUrl: "http://192.168.1.20:4783",
                wsBaseUrl: "ws://192.168.1.20:4783",
                sessionId: "session-legacy",
                deviceId: "device-legacy",
                keychainAccount: "bearerToken:env-legacy",
                protocolVersion: 1,
                capabilities: ["projects"]
            )
        )

        let restored = try XCTUnwrap(try store.session(environmentId: "env-legacy"))
        XCTAssertNil(restored.endpointKind)
    }

    // MARK: Health

    func testDecodeHealth() throws {
        let health = try decodeFixture("health.json", as: HealthResponse.self)
        XCTAssertTrue(health.ok)
        XCTAssertEqual(health.protocolVersion, 1)
        XCTAssertFalse(health.capabilities.isEmpty)
    }

    // MARK: Client frames

    func testDecodeClientHello() throws {
        let data = try loadFixture("client-hello.json")
        let probe = try JSONDecoder().decode(EnvelopeProbeForTests.self, from: data)
        XCTAssertEqual(probe.envelope, "hello")

        let hello = try JSONDecoder().decode(ClientHello.self, from: data)
        XCTAssertEqual(hello.envelope, "hello")
        XCTAssertEqual(hello.protocolVersion, 1)
        XCTAssertFalse(hello.capabilities.isEmpty)
    }

    func testDecodeClientPing() throws {
        let data = try loadFixture("client-ping.json")
        let ping = try JSONDecoder().decode(ClientPing.self, from: data)
        XCTAssertEqual(ping.envelope, "ping")
        XCTAssertGreaterThan(ping.at, 0)
    }

    func testDecodeClientSubscribe() throws {
        let data = try loadFixture("client-subscribe.json")
        let sub = try JSONDecoder().decode(ClientSubscribe.self, from: data)
        XCTAssertEqual(sub.envelope, "subscribe")
        XCTAssertFalse(sub.topics.isEmpty)
    }

    func testDecodeClientCommandTurnStart() throws {
        let data = try loadFixture("client-command-turn-start.json")
        let cmd = try JSONDecoder().decode(ClientCommandEnvelope.self, from: data)
        XCTAssertEqual(cmd.envelope, "command")
        XCTAssertFalse(cmd.commandId.isEmpty)
        if case .turnStart(let ts) = cmd.command {
            XCTAssertEqual(ts.type, "turn.start")
            XCTAssertFalse(ts.text.isEmpty)
        } else {
            XCTFail("Expected turnStart command")
        }
    }

    func testDecodeClientCommandApproval() throws {
        let data = try loadFixture("client-command-approval.json")
        let cmd = try JSONDecoder().decode(ClientCommandEnvelope.self, from: data)
        if case .approvalResolve(let ar) = cmd.command {
            XCTAssertEqual(ar.type, "approval.resolve")
            XCTAssertFalse(ar.approvalId.isEmpty)
        } else {
            XCTFail("Expected approvalResolve command")
        }
    }

    func testDecodeClientCommandCursorReplay() throws {
        let data = try loadFixture("client-command-cursor-replay.json")
        let cmd = try JSONDecoder().decode(ClientCommandEnvelope.self, from: data)
        if case .cursorReplay(let cr) = cmd.command {
            XCTAssertEqual(cr.type, "cursor.replay")
        } else {
            XCTFail("Expected cursorReplay command")
        }
    }

    // MARK: Host frames

    func testDecodeHostWelcome() throws {
        let welcome = try decodeFixture("host-welcome.json", as: HostWelcome.self)
        XCTAssertEqual(welcome.envelope, "welcome")
        XCTAssertEqual(welcome.protocolVersion, 1)
        XCTAssertFalse(welcome.environmentId.isEmpty)
        XCTAssertGreaterThanOrEqual(welcome.cursor, 0)
    }

    func testDecodeHostPong() throws {
        let pong = try decodeFixture("host-pong.json", as: HostPong.self)
        XCTAssertEqual(pong.envelope, "pong")
        XCTAssertGreaterThan(pong.at, 0)
    }

    func testDecodeHostError() throws {
        let err = try decodeFixture("host-error-revoked.json", as: HostError.self)
        XCTAssertEqual(err.envelope, "error")
        XCTAssertEqual(err.error.code, "device_revoked")
        XCTAssertEqual(err.error.retryable, false)
    }

    func testDecodeHostSnapshotRequired() throws {
        let snap = try decodeFixture("host-snapshot-required.json", as: HostSnapshotRequired.self)
        XCTAssertEqual(snap.envelope, "snapshot_required")
        XCTAssertFalse(snap.reason.isEmpty)
    }

    func testDecodeHostEventAssistantDelta() throws {
        let evt = try decodeFixture("host-event-assistant-delta.json", as: HostEventEnvelope.self)
        XCTAssertEqual(evt.envelope, "event")
        XCTAssertEqual(evt.event.kind, "assistant.delta")
        XCTAssertNotNil(evt.event.text)
    }

    func testDecodeHostEventApproval() throws {
        let evt = try decodeFixture("host-event-approval.json", as: HostEventEnvelope.self)
        XCTAssertEqual(evt.event.kind, "approval.requested")
        XCTAssertNotNil(evt.event.approvalId)
    }

    func testDecodeHostResponseTurnStart() throws {
        let resp = try decodeFixture("host-response-turn-start.json", as: HostResponseEnvelope.self)
        XCTAssertEqual(resp.envelope, "response")
        XCTAssertFalse(resp.commandId.isEmpty)
        let receipt = try XCTUnwrap(resp.receipt)
        XCTAssertEqual(receipt.status, "accepted")
    }

    func testDecodeHostResponseDuplicate() throws {
        let resp = try decodeFixture("host-response-duplicate.json", as: HostResponseEnvelope.self)
        let receipt = try XCTUnwrap(resp.receipt)
        XCTAssertEqual(receipt.status, "duplicate")
    }

    // MARK: Complex structures

    func testDecodeEnvironmentSnapshot() throws {
        let snap = try decodeFixture("environment-snapshot.json", as: EnvironmentSnapshot.self)
        XCTAssertEqual(snap.environment.protocolVersion, 1)
        XCTAssertFalse(snap.projects.isEmpty)
        XCTAssertFalse(snap.threads.isEmpty)
        XCTAssertGreaterThanOrEqual(snap.cursor, 0)
    }

    func testDecodeDiffSummary() throws {
        let diff = try decodeFixture("diff-summary.json", as: DiffSummary.self)
        XCTAssertFalse(diff.id.isEmpty)
        XCTAssertFalse(diff.files.isEmpty)
        XCTAssertFalse(diff.files[0].path.isEmpty)
    }

    func testDecodeCursorReplay() throws {
        let replay = try decodeFixture("cursor-replay.json", as: CursorReplayPayload.self)
        XCTAssertFalse(replay.events.isEmpty)
        XCTAssertGreaterThan(replay.latestCursor, replay.afterCursor)
    }

    func testDecodeCommandReceipt() throws {
        let receipt = try decodeFixture("command-receipt.json", as: CommandReceipt.self)
        XCTAssertFalse(receipt.commandId.isEmpty)
        XCTAssertEqual(receipt.status, "completed")
    }

    @MainActor
    func testAppRestoresCachedSnapshotAndUsesItsCursorForReconnect() async throws {
        let store = LocalStore(inMemory: true)
        try store.upsertSession(
            PersistedSession(
                environmentId: "env-1",
                environmentLabel: "Studio",
                httpBaseUrl: "http://127.0.0.1:4783",
                wsBaseUrl: "ws://127.0.0.1:4783",
                sessionId: "session-1",
                deviceId: "device-1",
                keychainAccount: "test-token",
                protocolVersion: 1,
                capabilities: ["cursor_replay"]
            )
        )
        let rawSnapshot = try loadFixture("environment-snapshot.json")
        let decoded = try JSONDecoder().decode(EnvironmentSnapshot.self, from: rawSnapshot)
        try store.saveSnapshot(environmentId: "env-1", rawJSON: rawSnapshot)

        let app = AppModel(store: store)

        XCTAssertEqual(app.snapshot, decoded)
        let helloProvider = try XCTUnwrap(app.gateway.helloProvider)
        let hello = try await helloProvider()
        XCTAssertEqual(hello.afterCursor, decoded.cursor)
    }
}

// MARK: - Test helpers

/// Minimal probe used to read the `envelope` field without full decoding.
struct EnvelopeProbeForTests: Decodable {
    let envelope: String
}

/// Loads a JSON fixture from the test bundle.
///
/// Tries `Fixtures/mobile-v1/<filename>` first (folder-reference build),
/// then a flat bundle lookup (individual-file resource build, which is what
/// XcodeGen produces when the source directory contains individual files).
func loadFixture(_ filename: String) throws -> Data {
    let bundle = Bundle(for: ProtocolFixtureTests.self)
    // Strip extension for the forResource: parameter
    let name = (filename as NSString).deletingPathExtension
    let ext  = (filename as NSString).pathExtension

    // 1. Subdirectory layout (folder reference or folder-group resources)
    if let url = bundle.url(forResource: name, withExtension: ext, subdirectory: "Fixtures/mobile-v1") {
        return try Data(contentsOf: url)
    }
    if let url = bundle.url(forResource: name, withExtension: ext, subdirectory: "mobile-v1") {
        return try Data(contentsOf: url)
    }
    // 2. Flat bundle root (individual file resources added by XcodeGen)
    if let url = bundle.url(forResource: name, withExtension: ext) {
        return try Data(contentsOf: url)
    }
    throw XCTestError(.failureWhileWaiting, userInfo: [
        NSLocalizedDescriptionKey: "Fixture not found in bundle: \(filename)"
    ])
}

/// Convenience: load and decode a fixture in one call.
func decodeFixture<T: Decodable>(_ filename: String, as type: T.Type) throws -> T {
    let data = try loadFixture(filename)
    return try JSONDecoder().decode(type, from: data)
}
