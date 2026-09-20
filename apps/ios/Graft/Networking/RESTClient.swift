import Foundation

/// HTTP client for the Graft remote-gateway REST API.
///
/// All requests carry the session `bearerToken` in the `Authorization` header.
/// The client is `Sendable` (no mutable state) and safe to call from any actor.
struct RESTClient: Sendable {
    let baseURL: URL
    let bearerToken: String

    static let session: URLSession = {
        let config = URLSessionConfiguration.default
        config.timeoutIntervalForRequest = 30
        config.waitsForConnectivity = false
        return URLSession(configuration: config)
    }()

    // MARK: Endpoints

    /// `GET /health` — verifies the gateway is reachable and authenticated.
    func health() async throws -> HealthResponse {
        let data = try await get("/v1/health")
        return try decode(HealthResponse.self, from: data)
    }

    /// `POST /pair` — exchanges a one-time pairing token for a session.
    func pair(token: String, deviceLabel: String, deviceId: String) async throws -> PairResponse {
        let body = PairRequest(
            token: token,
            protocolVersion: GraftProtocol.version,
            client: PairClientInfo(
                platform: "ios",
                appVersion: Bundle.main.infoDictionary?["CFBundleShortVersionString"] as? String ?? "0.0",
                deviceLabel: deviceLabel,
                deviceId: deviceId
            )
        )
        let encoded = try JSONEncoder().encode(body)
        let data = try await send("/v1/pair", method: "POST", body: encoded)
        return try decode(PairResponse.self, from: data)
    }

    /// `GET /v1/snapshot` — fetches the authoritative environment state.
    ///
    /// Supplying a thread ID includes that thread's transcript in the snapshot.
    func snapshot(threadId: String? = nil) async throws -> EnvironmentSnapshot {
        var components = URLComponents(
            url: baseURL.appending(path: "/v1/snapshot"),
            resolvingAgainstBaseURL: false
        )
        if let threadId, !threadId.isEmpty {
            components?.queryItems = [URLQueryItem(name: "threadId", value: threadId)]
        }
        guard let url = components?.url else {
            throw GraftError.decoding("Cannot construct snapshot URL")
        }
        let data = try await get(url)
        return try decode(EnvironmentSnapshot.self, from: data)
    }

    func usage(threadId: String) async throws -> ThreadUsageInfo {
        var components = URLComponents(
            url: baseURL.appending(path: "/v1/usage"), resolvingAgainstBaseURL: false
        )
        components?.queryItems = [URLQueryItem(name: "threadId", value: threadId)]
        guard let url = components?.url else {
            throw GraftError.decoding("Cannot construct usage URL")
        }
        let data = try await get(url)
        let usage = try decode(ThreadUsageInfo.self, from: data)
        guard usage.threadId == threadId else {
            throw GraftError.decoding("Usage belongs to another thread")
        }
        return usage
    }

    /// `PUT /v1/push-registration` — registration only; the host does not deliver pushes yet.
    func registerPushToken(
        _ token: String,
        environment: APNsEnvironment,
        bundleId: String
    ) async throws -> PushRegistrationResponse {
        let body = PushRegistrationRequest(
            apnsToken: token,
            apnsEnvironment: environment,
            bundleId: bundleId
        )
        let encoded = try JSONEncoder().encode(body)
        let data = try await send(
            "/v1/push-registration",
            method: "PUT",
            body: encoded
        )
        return try decode(PushRegistrationResponse.self, from: data)
    }

    /// `DELETE /v1/push-registration` — removes this authenticated device's registration.
    func unregisterPushRegistration() async throws -> PushUnregistrationResponse {
        let data = try await send(
            "/v1/push-registration",
            method: "DELETE",
            body: Data("{}".utf8)
        )
        return try decode(PushUnregistrationResponse.self, from: data)
    }

    // MARK: Core

    private func get(_ path: String) async throws -> Data {
        try await get(baseURL.appending(path: path))
    }

    private func get(_ url: URL) async throws -> Data {
        var req = URLRequest(url: url)
        req.httpMethod = "GET"
        req.setValue("Bearer \(bearerToken)", forHTTPHeaderField: "Authorization")
        return try await perform(req)
    }

    private func send(_ path: String, method: String, body: Data) async throws -> Data {
        var req = URLRequest(url: baseURL.appending(path: path))
        req.httpMethod = method
        req.setValue("application/json", forHTTPHeaderField: "Content-Type")
        req.setValue("Bearer \(bearerToken)", forHTTPHeaderField: "Authorization")
        req.httpBody = body
        return try await perform(req)
    }

    private func perform(_ request: URLRequest) async throws -> Data {
        let (data, response) = try await Self.session.data(for: request)
        guard let http = response as? HTTPURLResponse else {
            throw GraftError.decoding("Not an HTTP response")
        }
        switch http.statusCode {
        case 200..<300:
            return data
        default:
            throw GraftError.httpResponse(status: http.statusCode, body: data)
        }
    }

    private func decode<T: Decodable>(_ type: T.Type, from data: Data) throws -> T {
        let decoder = JSONDecoder()
        do {
            return try decoder.decode(type, from: data)
        } catch {
            throw GraftError.decoding(error.localizedDescription)
        }
    }
}
