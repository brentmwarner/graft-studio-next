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
        } catch let error as GraftError {
            return .unreachable(error)
        } catch let urlError as URLError {
            return .unreachable(classifyURLError(urlError))
        } catch {
            return .unreachable(.unreachable(error.localizedDescription))
        }
    }

    private static func classifyURLError(_ error: URLError) -> GraftError {
        switch error.code {
        case .cannotFindHost,
             .cannotConnectToHost,
             .timedOut,
             .networkConnectionLost,
             .notConnectedToInternet,
             .secureConnectionFailed:
            return .unreachable(error.localizedDescription)
        default:
            return .unreachable(error.localizedDescription)
        }
    }
}
