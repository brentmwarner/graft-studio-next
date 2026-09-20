import Foundation
import Network

// MARK: - Incoming event type

/// A decoded event frame pushed by the host over the WebSocket.
struct GatewayEvent: Sendable {
    let envelope: String
    let payload: Data
}

@MainActor
protocol GatewaySocketTransport: AnyObject {
    func resume()
    func cancel(with closeCode: URLSessionWebSocketTask.CloseCode, reason: Data?)
    func send(_ message: URLSessionWebSocketTask.Message) async throws
    func receive() async throws -> URLSessionWebSocketTask.Message
}

extension URLSessionWebSocketTask: GatewaySocketTransport {}

struct GatewayConnectionTiming {
    var handshake: Duration = .seconds(15)
    var heartbeat: Duration = .seconds(25)
    var pong: Duration = .seconds(10)
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

    /// Reports typed failures to the owning machine, including handshake errors.
    var onFailure: (@MainActor (GraftError) -> Void)?

    private var socket: (any GatewaySocketTransport)?
    private var receiveTask: Task<Void, Never>?
    private var pingTask: Task<Void, Never>?
    private var handshakeTimeoutTask: Task<Void, Never>?
    private var pongTimeoutTask: Task<Void, Never>?
    private var pendingPing: Int?
    private var lastPing = 0
    private var connectionGeneration = 0
    private let timing: GatewayConnectionTiming
    private let makeSocket: @MainActor (URLRequest) -> any GatewaySocketTransport

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
    private var networkAvailable = true
    private var networkInterfaces: [String]?

    init(
        monitorNetwork: Bool = true,
        timing: GatewayConnectionTiming = GatewayConnectionTiming(),
        makeSocket: @escaping @MainActor (URLRequest) -> any GatewaySocketTransport = { request in
            let task = RESTClient.session.webSocketTask(with: request)
            task.maximumMessageSize = 32 * 1024 * 1024
            return task
        }
    ) {
        self.timing = timing
        self.makeSocket = makeSocket
        guard monitorNetwork else { return }
        pathMonitor.pathUpdateHandler = { [weak self] path in
            // A requiresConnection path (for example an on-demand VPN) can
            // become usable by dialing. Only an unsatisfied path is offline.
            let available = path.status != .unsatisfied
            let interfaces = path.availableInterfaces
                .filter { path.usesInterfaceType($0.type) }.map(\.name).sorted()
            Task { @MainActor [weak self] in
                self?.networkChanged(available: available, interfaces: interfaces)
            }
        }
        pathMonitor.start(queue: DispatchQueue(label: "graft.gateway.path-monitor", qos: .utility))
    }

    /// Wi-Fi → cellular can leave the old socket nominally running. Replace it
    /// on a route change instead of waiting for the old TCP connection to fail.
    func networkChanged(available: Bool, interfaces: [String]) {
        let changed = networkAvailable != available ||
            (networkInterfaces != nil && networkInterfaces != interfaces)
        networkAvailable = available
        networkInterfaces = interfaces
        guard changed, shouldStayConnected else { return }
        reconnectTask?.cancel()
        reconnectTask = nil
        teardown(reason: "network changed", notify: true)
        state = .reconnecting
        if available { scheduleReconnect(reason: "network changed", immediately: true) }
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
        guard networkAvailable else {
            state = .reconnecting
            throw GraftError.unreachable("Waiting for a network connection.")
        }
        state = .connecting
        try await openSocket(isReconnect: false)
    }

    /// Probe-connect: opens the socket, waits for the `welcome` frame, then
    /// starts the receive and ping loops.
    private func openSocket(isReconnect: Bool) async throws {
        guard let requestProvider, let helloProvider else {
            throw GraftError.notPaired
        }
        connectionGeneration += 1
        let generation = connectionGeneration
        state = .connecting
        var opened: (any GatewaySocketTransport)?
        do {
            var request = try await requestProvider()
            let hello = try await helloProvider()
            try Task.checkCancellation()
            guard generation == connectionGeneration, shouldStayConnected else {
                throw CancellationError()
            }
            request.timeoutInterval = 15
            let task = makeSocket(request)
            opened = task
            socket = task
            handshakeTimeoutTask = Task { [weak self, weak task] in
                guard let self else { return }
                do { try await Task.sleep(for: self.timing.handshake) } catch { return }
                guard let task else { return }
                self.handleDrop(of: task, reason: "handshake timeout")
            }
            task.resume()

            // The host waits for `hello` before replying with `welcome`.
            try await task.send(.string(try GatewayHandshake.helloText(hello)))
            let first = try await task.receive()
            let welcomeData = try GatewayHandshake.validatedWelcomeData(first)
            try Task.checkCancellation()
            guard generation == connectionGeneration, shouldStayConnected, socket === task else {
                throw CancellationError()
            }
            handshakeTimeoutTask?.cancel()
            handshakeTimeoutTask = nil
            reconnectTask = nil
            state = .connected
            startReceiveLoop(task)
            startPingLoop(task)
            resumeWaiters(with: nil)
            broadcast(GatewayEvent(envelope: "welcome", payload: welcomeData))
        } catch {
            opened?.cancel(with: .goingAway, reason: nil)
            // A superseded handshake must never clear the replacement socket
            // or restart a connection after backgrounding/unpairing.
            guard generation == connectionGeneration else { throw error }
            handshakeTimeoutTask?.cancel()
            handshakeTimeoutTask = nil
            socket = nil
            resumeWaiters(with: error)
            if !shouldRetry(error) { shouldStayConnected = false }
            if !isReconnect {
                state = .disconnected(error.localizedDescription)
                if shouldStayConnected && shouldRetry(error) {
                    scheduleReconnect(reason: error.localizedDescription)
                }
            } else {
                state = .reconnecting
            }
            if !(error is CancellationError) { onFailure?(.transport(error)) }
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
            sendHeartbeat(socket)
        case .reconnecting, .disconnected, .idle:
            shouldStayConnected = true
            reconnectTask?.cancel()
            reconnectTask = nil
            scheduleReconnect(reason: "foregrounded", immediately: true)
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

    private func handleDrop(of dropped: any GatewaySocketTransport, reason: String?, error: Error? = nil) {
        guard dropped === socket else { return }
        reconnectTask?.cancel()
        reconnectTask = nil
        teardown(reason: reason, notify: true)
        if let error {
            onFailure?(.transport(error))
            if !shouldRetry(error) { shouldStayConnected = false }
        }
        if shouldStayConnected { scheduleReconnect(reason: reason) }
    }

    private func scheduleReconnect(reason: String?, immediately: Bool = false) {
        guard shouldStayConnected, reconnectTask == nil else { return }
        state = .reconnecting
        guard networkAvailable else { return }
        AppLog.networking.info("Scheduling reconnect after drop: \(reason ?? "unknown")")
        reconnectTask = Task { [weak self] in
            var attempt = 0
            while !Task.isCancelled {
                guard let self else { return }
                let delay: Duration = immediately && attempt == 0 ? .zero : self.reconnectPolicy.delay(for: attempt)
                AppLog.networking.debug("Reconnect attempt \(attempt), delay \(delay)")
                try? await Task.sleep(for: delay)
                if Task.isCancelled { return }
                guard case .reconnecting = self.state else { return }
                do {
                    try await self.openSocket(isReconnect: true)
                    return
                } catch {
                    if Task.isCancelled { return }
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
        connectionGeneration += 1
        receiveTask?.cancel()
        pingTask?.cancel()
        handshakeTimeoutTask?.cancel()
        pongTimeoutTask?.cancel()
        receiveTask = nil
        pingTask = nil
        handshakeTimeoutTask = nil
        pongTimeoutTask = nil
        pendingPing = nil
        socket?.cancel(with: .goingAway, reason: nil)
        socket = nil
        resumeWaiters(with: GraftError.socketClosed)
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

    private func startReceiveLoop(_ task: any GatewaySocketTransport) {
        receiveTask?.cancel()
        receiveTask = Task { [weak self] in
            while !Task.isCancelled {
                do {
                    let message = try await task.receive()
                    guard !Task.isCancelled, self?.socket === task else { return }
                    self?.handleRaw(message)
                } catch {
                    self?.handleDrop(of: task, reason: error.localizedDescription, error: error)
                    return
                }
            }
        }
    }

    private func startPingLoop(_ task: any GatewaySocketTransport) {
        pingTask?.cancel()
        pingTask = Task { [weak self, weak task] in
            while !Task.isCancelled {
                guard let interval = self?.timing.heartbeat else { return }
                try? await Task.sleep(for: interval)
                if Task.isCancelled { return }
                guard let task, self?.socket === task else { return }
                self?.sendHeartbeat(task)
            }
        }
    }

    /// Application pings traverse the relay all the way to Studio. A native
    /// WebSocket pong only proves the nearest proxy is still reachable.
    private func sendHeartbeat(_ task: any GatewaySocketTransport) {
        guard socket === task, pendingPing == nil, state == .connected else { return }
        let at = max(Int(Date().timeIntervalSince1970), lastPing + 1)
        lastPing = at
        pendingPing = at
        pongTimeoutTask = Task { [weak self, weak task] in
            guard let self else { return }
            do { try await Task.sleep(for: self.timing.pong) } catch { return }
            guard let task else { return }
            self.handleDrop(of: task, reason: "heartbeat timeout")
        }
        Task { [weak self] in
            do {
                let data = try JSONEncoder().encode(ClientPing(at: at))
                try await task.send(.string(String(decoding: data, as: UTF8.self)))
            } catch {
                self?.handleDrop(of: task, reason: error.localizedDescription, error: error)
            }
        }
    }

    private func shouldRetry(_ error: Error) -> Bool {
        GraftError.transport(error).isRetryable
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
        if envelope == "pong",
           let pong = try? JSONDecoder().decode(HostPong.self, from: data), pong.at == pendingPing {
            pongTimeoutTask?.cancel()
            pongTimeoutTask = nil
            pendingPing = nil
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
