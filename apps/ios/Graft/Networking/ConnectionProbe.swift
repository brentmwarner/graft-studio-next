import Foundation

/// One-shot connectivity check used during onboarding and the
/// connection-settings test button.
///
/// Hits `GET /health` with the stored bearer token; classifies transport-level
/// errors into the GraftError domain.
enum ConnectionProbe {
    enum Result: Sendable {
        case reachable(HealthResponse)
        case unreachable(GraftError)
    }

    static func run(baseURL: URL, bearerToken: String) async -> Result {
        let client = RESTClient(baseURL: baseURL, bearerToken: bearerToken)
        do {
            let health = try await client.health()
            return .reachable(health)
        } catch {
            return .unreachable(.transport(error))
        }
    }
}
