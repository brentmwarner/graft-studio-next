import Foundation
import Network

// MARK: - Incoming event type

/// A decoded event frame pushed by the host over the WebSocket.
struct GatewayEvent: Sendable {
    let envelope: String
    let payload: Data
}

// MARK: - GatewayClient

/// WebSocket client for the Graft remote-gateway protocol.
///
/// One connection multiplexes all protocol interaction.
/// The client owns the reconnect loop, NWPathMonitor nudges, and
/// the hello/welcome handshake. Listeners receive raw `GatewayEvent`
/// values; higher-level parsing is the caller's responsibility.
@MainActor
@Observable
final class GatewayClient {
    enum ConnectionState: Equatable, Sendable {
        case idle
        case connecting
        case connected
        case reconnecting
        case disconnected(String?)
    }

    private(set) var state: ConnectionState = .idle

    /// Resolves the authenticated WebSocket upgrade request before each connect attempt.
    var requestProvider: (@MainActor () async throws -> URLRequest)?

    /// Resolves the hello frame sent immediately after the WebSocket upgrade.
    var helloProvider: (@MainActor () async throws -> ClientHello)?

    private var socket: URLSessionWebSocketTask?
    private var receiveTask: Task<Void, Never>?
    private var pingTask: Task<Void, Never>?

    private typealias ListenerID = UUID
    private struct Listener {
        let handler: @MainActor (GatewayEvent) -> Void
    }
    private var listeners: [ListenerID: Listener] = [:]
    private var connectWaiters: [CheckedContinuation<Void, Error>] = []
    private var reconnectTask: Task<Void, Never>?

    var reconnectPolicy = ReconnectPolicy.default

    /// Set when we deliberately intend to hold the connection open.
    /// Cleared only by an explicit `disconnect()` or `suspendForBackground()`.
    private var shouldStayConnected = false

    /// Re-dials immediately when the network path recovers, bypassing backoff.
    private let pathMonitor = NWPathMonitor()

    init() {
        pathMonitor.pathUpdateHandler = { [weak self] path in
            let satisfied = path.status == .satisfied
            Task { @MainActor [weak self] in self?.pathChanged(satisfied: satisfied) }
        }
        pathMonitor.start(queue: DispatchQueue(label: "graft.gateway.path-monitor", qos: .utility))
    }

    private func pathChanged(satisfied: Bool) {
        guard satisfied, shouldStayConnected else { return }
        nudge()
    }

    // MARK: Listeners

    @discardableResult
    func addListener(_ handler: @escaping @MainActor (GatewayEvent) -> Void) -> UUID {
        let id = UUID()
        listeners[id] = Listener(handler: handler)
        return id
    }

    func removeListener(_ id: UUID) {
        listeners.removeValue(forKey: id)
    }

    private func broadcast(_ event: GatewayEvent) {
        for listener in listeners.values {
            listener.handler(event)
        }
    }

    // MARK: Connection

    func ensureConnected() async throws {
        switch state {
        case .connected:
            return
        case .connecting:
            try await withCheckedThrowingContinuation { (cont: CheckedContinuation<Void, Error>) in
                connectWaiters.append(cont)
            }
        case .reconnecting:
            reconnectTask?.cancel()
            reconnectTask = nil
            try await dial()
        case .idle, .disconnected:
            try await dial()
        }
    }

    private func dial() async throws {
        guard requestProvider != nil, helloProvider != nil else {
            throw GraftError.notPaired
        }
        shouldStayConnected = true
        state = .connecting
        try await openSocket(isReconnect: false)
    }

    /// Probe-connect: opens the socket, waits for the `welcome` frame, then
    /// starts the receive and ping loops.
    private func openSocket(isReconnect: Bool) async throws {
        guard let requestProvider, let helloProvider else {
            throw GraftError.notPaired
        }
        do {
            var request = try await requestProvider()
            let hello = try await helloProvider()
            request.timeoutInterval = 15
            let task = RESTClient.session.webSocketTask(with: request)
            task.maximumMessageSize = 32 * 1024 * 1024
            socket = task
            task.resume()

            // The host waits for `hello` before replying with `welcome`.
            try await task.send(.string(try GatewayHandshake.helloText(hello)))
            let first = try await task.receive()
            let welcomeData = try GatewayHandshake.validatedWelcomeData(first)
            reconnectTask?.cancel()
            reconnectTask = nil
            state = .connected
            broadcast(GatewayEvent(envelope: "welcome", payload: welcomeData))
            startReceiveLoop(task)
            startPingLoop(task)
            resumeWaiters(with: nil)
        } catch {
            socket = nil
            if !isReconnect {
                state = .disconnected(error.localizedDescription)
                resumeWaiters(with: error)
                if shouldStayConnected && shouldRetry(error) {
                    scheduleReconnect(reason: error.localizedDescription)
                }
            }
            throw error
        }
    }

    /// Fast-path liveness check: ping-verifies a nominally connected socket
    /// (which may be stale after suspension) and dials immediately for any
    /// non-connected state, bypassing any pending backoff sleep.
    func nudge() {
        switch state {
        case .connecting:
            return
        case .connected:
            guard let socket else { return }
            socket.sendPing { [weak self] error in
                guard error != nil else { return }
                Task { @MainActor [weak self] in
                    self?.handleDrop(of: socket, reason: "connection lost")
                }
            }
        case .reconnecting, .disconnected, .idle:
            Task { try? await ensureConnected() }
        }
    }

    func disconnect() {
        shouldStayConnected = false
        reconnectTask?.cancel()
        reconnectTask = nil
        teardown(reason: nil, notify: false)
        state = .idle
    }

    /// Called when the app enters the background. Tears down the socket and
    /// pending reconnect so we don't burn background CPU on a connection that
    /// iOS is about to suspend anyway.
    func suspendForBackground() {
        guard shouldStayConnected || socket != nil || reconnectTask != nil else { return }
        shouldStayConnected = false
        reconnectTask?.cancel()
        reconnectTask = nil
        teardown(reason: "backgrounded", notify: true)
        state = .idle
    }

    // MARK: Reconnect

    private func handleDrop(of dropped: URLSessionWebSocketTask, reason: String?) {
        guard dropped === socket, case .connected = state else { return }
        teardown(reason: reason, notify: true)
        if shouldStayConnected { scheduleReconnect(reason: reason) }
    }

    private func scheduleReconnect(reason: String?) {
        guard shouldStayConnected, reconnectTask == nil else { return }
        state = .reconnecting
        AppLog.networking.info("Scheduling reconnect after drop: \(reason ?? "unknown")")
        reconnectTask = Task { [weak self] in
            var attempt = 0
            while !Task.isCancelled {
                guard let self else { return }
                let delay = self.reconnectPolicy.delay(for: attempt)
                AppLog.networking.debug("Reconnect attempt \(attempt), delay \(delay)")
                try? await Task.sleep(for: delay)
                if Task.isCancelled { return }
                guard case .reconnecting = self.state else { return }
                do {
                    try await self.openSocket(isReconnect: true)
                    return
                } catch {
                    guard self.shouldRetry(error) else {
                        self.shouldStayConnected = false
                        self.state = .disconnected(error.localizedDescription)
                        self.reconnectTask = nil
                        return
                    }
                    attempt += 1
                }
            }
        }
    }

    private func teardown(reason: String?, notify: Bool) {
        receiveTask?.cancel()
        pingTask?.cancel()
        receiveTask = nil
        pingTask = nil
        socket?.cancel(with: .goingAway, reason: nil)
        socket = nil
        if case .connected = state {
            state = .disconnected(reason)
        } else if case .connecting = state {
            state = .disconnected(reason)
        }
        if notify {
            broadcast(GatewayEvent(envelope: "gateway.disconnected", payload: Data()))
        }
    }

    // MARK: Receive / Ping loops

    private func startReceiveLoop(_ task: URLSessionWebSocketTask) {
        receiveTask?.cancel()
        receiveTask = Task { [weak self] in
            while !Task.isCancelled {
                do {
                    let message = try await task.receive()
                    await MainActor.run { self?.handleRaw(message) }
                } catch {
                    await MainActor.run {
                        self?.handleDrop(of: task, reason: error.localizedDescription)
                    }
                    return
                }
            }
        }
    }

    private func startPingLoop(_ task: URLSessionWebSocketTask) {
        pingTask?.cancel()
        pingTask = Task { [weak self, weak task] in
            while !Task.isCancelled {
                try? await Task.sleep(for: .seconds(25))
                if Task.isCancelled { return }
                guard let task, task.state == .running else { return }
                let failed = await withCheckedContinuation { (cont: CheckedContinuation<Bool, Never>) in
                    task.sendPing { cont.resume(returning: $0 != nil) }
                }
                if failed {
                    await MainActor.run {
                        self?.handleDrop(of: task, reason: "ping timeout")
                    }
                    return
                }
            }
        }
    }

    private func shouldRetry(_ error: Error) -> Bool {
        (error as? GraftError)?.isRetryable ?? true
    }

    // MARK: Send

    /// Sends an `Encodable` value as a JSON WebSocket text frame.
    func send<T: Encodable & Sendable>(_ message: T) async throws {
        try await ensureConnected()
        guard let socket else { throw GraftError.socketClosed }
        let data = try JSONEncoder().encode(message)
        guard let text = String(data: data, encoding: .utf8) else {
            throw GraftError.decoding("Cannot encode message as UTF-8")
        }
        try await socket.send(.string(text))
    }

    // MARK: Raw dispatch

    private func handleRaw(_ message: URLSessionWebSocketTask.Message) {
        let data: Data
        switch message {
        case .string(let text):
            data = Data(text.utf8)
        case .data(let d):
            data = d
        @unknown default:
            return
        }
        guard let envelope = (try? JSONDecoder().decode(EnvelopeProbe.self, from: data))?.envelope else {
            AppLog.networking.warning("Received unrecognized gateway frame")
            return
        }
        broadcast(GatewayEvent(envelope: envelope, payload: data))
    }

    private func resumeWaiters(with error: Error?) {
        let waiters = connectWaiters
        connectWaiters = []
        for waiter in waiters {
            if let error { waiter.resume(throwing: error) } else { waiter.resume() }
        }
    }
}

enum GatewayHandshake {
    static func helloText(_ hello: ClientHello) throws -> String {
        let data = try JSONEncoder().encode(hello)
        guard let text = String(data: data, encoding: .utf8) else {
            throw GraftError.decoding("Cannot encode hello as UTF-8")
        }
        return text
    }

    static func validatedWelcomeData(
        _ message: URLSessionWebSocketTask.Message
    ) throws -> Data {
        let data: Data
        switch message {
        case .string(let text):
            data = Data(text.utf8)
        case .data(let bytes):
            data = bytes
        @unknown default:
            throw GraftError.decoding("Unexpected WebSocket handshake frame")
        }

        if let hostError = try? JSONDecoder().decode(HostError.self, from: data),
           hostError.envelope == "error"
        {
            let detail = hostError.error
            throw GraftError.hostError(
                code: detail.code,
                message: detail.message,
                retryable: detail.retryable ?? false
            )
        }
        guard let welcome = try? JSONDecoder().decode(HostWelcome.self, from: data),
              welcome.envelope == "welcome"
        else {
            throw GraftError.decoding("Expected welcome handshake frame")
        }
        return data
    }
}

// MARK: - Envelope probe

/// Minimal decodable used only to extract the discriminant `envelope` field.
private struct EnvelopeProbe: Decodable {
    let envelope: String
}
