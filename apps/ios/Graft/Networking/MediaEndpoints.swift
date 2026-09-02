import Foundation

/// Remote media fetching for transcript attachments.
///
/// The Graft remote gateway does not expose media/file-read routes yet, so
/// these throw a 404-shaped error. `ChatImage`/`ChatVideo` degrade to their
/// built-in unavailable/tap-to-retry states. When the desktop gateway grows
/// media endpoints, implement them here and the chat surface lights up
/// without further changes.
extension RESTClient {
    func mediaData(path: String) async throws -> Data {
        throw GraftError.http(status: 404, body: "media_unsupported")
    }

    func fileData(path: String) async throws -> Data {
        throw GraftError.http(status: 404, body: "files_unsupported")
    }

    func videoData(path: String) async throws -> Data {
        throw GraftError.http(status: 404, body: "files_unsupported")
    }
}
