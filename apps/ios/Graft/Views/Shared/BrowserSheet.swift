import UIKit
import SwiftUI
import WebKit

/// Identifiable wrapper so `.sheet(item:)` re-presents on new URLs.
struct BrowsableURL: Identifiable, Equatable {
    let id = UUID()
    let url: URL
}

/// Live WKWebView state surfaced to SwiftUI chrome via KVO.
@MainActor
@Observable
final class BrowserState {
    var title = ""
    var progress: Double = 0
    var canGoBack = false
    var canGoForward = false
    var currentURL: URL?
    var loadFailed = false
    var failedURL: URL?
    weak var webView: WKWebView?

    var host: String {
        currentURL?.host()?.replacingOccurrences(of: "www.", with: "") ?? ""
    }
}

private struct WebView: UIViewRepresentable {
    let url: URL
    let state: BrowserState

    func makeUIView(context: Context) -> WKWebView {
        let web = WKWebView()
        web.allowsBackForwardNavigationGestures = true
        web.scrollView.contentInsetAdjustmentBehavior = .automatic
        web.navigationDelegate = context.coordinator
        context.coordinator.observe(web, state: state)
        state.webView = web
        state.currentURL = url
        web.load(URLRequest(url: url))
        return web
    }

    func updateUIView(_ uiView: WKWebView, context: Context) {}

    func makeCoordinator() -> Coordinator { Coordinator() }

    final class Coordinator: NSObject, WKNavigationDelegate {
        private var observations: [NSKeyValueObservation] = []
        weak var state: BrowserState?

        func observe(_ web: WKWebView, state: BrowserState) {
            self.state = state
            observations = [
                web.observe(\.title, options: [.new]) { web, _ in
                    let value = web.title ?? ""
                    Task { @MainActor in state.title = value }
                },
                web.observe(\.estimatedProgress, options: [.new]) { web, _ in
                    let value = web.estimatedProgress
                    Task { @MainActor in state.progress = value }
                },
                web.observe(\.canGoBack, options: [.new]) { web, _ in
                    let value = web.canGoBack
                    Task { @MainActor in state.canGoBack = value }
                },
                web.observe(\.canGoForward, options: [.new]) { web, _ in
                    let value = web.canGoForward
                    Task { @MainActor in state.canGoForward = value }
                },
                web.observe(\.url, options: [.new]) { web, _ in
                    let value = web.url
                    Task { @MainActor in state.currentURL = value }
                },
            ]
        }

        func webView(_ webView: WKWebView, didStartProvisionalNavigation navigation: WKNavigation!) {
            Task { @MainActor in state?.loadFailed = false }
        }

        func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
            Task { @MainActor in state?.loadFailed = false }
        }

        func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) {
            surface(error)
        }

        func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) {
            surface(error)
        }

        /// A cancelled load (the user tapped a new link before this one finished,
        /// or we replaced the request on Retry) isn't a failure worth showing.
        private func surface(_ error: Error) {
            let nsError = error as NSError
            guard !(nsError.domain == NSURLErrorDomain && nsError.code == NSURLErrorCancelled) else { return }
            let url = nsError.userInfo[NSURLErrorFailingURLErrorKey] as? URL
            Task { @MainActor in
                state?.failedURL = url ?? state?.currentURL
                state?.loadFailed = true
            }
        }
    }
}

/// The in-chat browser: a bottom drawer (medium detent) that pulls up to
/// full height, with quiet monochrome chrome and an exit to Safari.
struct BrowserSheet: View {
    let target: BrowsableURL
    @Environment(\.dismiss) private var dismiss
    @State private var state = BrowserState()

    var body: some View {
        VStack(spacing: 0) {
            header
            ZStack(alignment: .top) {
                WebView(url: target.url, state: state)
                if state.progress < 0.99 && !state.loadFailed {
                    ProgressView(value: state.progress)
                        .progressViewStyle(.linear)
                        .tint(DS.Color.fg)
                }
                if state.loadFailed {
                    loadFailure
                }
            }
            // Controls float over the page as Liquid Glass — no solid chin.
            .overlay(alignment: .bottom) { floatingControls }
        }
        // Links inside the drawer must not re-trigger the chat's interceptor.
        .environment(\.openURL, OpenURLAction { _ in .systemAction })
    }

    /// Shown when a navigation fails outright (bad host, no connection) so the
    /// drawer doesn't sit on "Loading…" forever.
    private var loadFailure: some View {
        VStack(spacing: 12) {
            Image(systemName: "exclamationmark.triangle")
                .font(.system(size: 32, weight: .light))
                .foregroundStyle(DS.Color.fgSubtle)
            VStack(spacing: 4) {
                Text("Couldn't load page")
                    .font(DS.Font.headline)
                    .foregroundStyle(DS.Color.fg)
                if !failedHost.isEmpty {
                    Text(failedHost)
                        .font(DS.Font.footnote)
                        .foregroundStyle(DS.Color.fgSubtle)
                        .lineLimit(1)
                }
            }
            Button { reload() } label: {
                Text("Retry")
                    .font(DS.Font.subhead)
                    .foregroundStyle(DS.Color.fg)
                    .padding(.horizontal, DS.Space.s3)
                    .frame(height: 40)
                    .contentShape(.capsule)
            }
            .buttonStyle(.plain)
            .glassEffect(.regular.interactive(), in: .capsule)
            .padding(.top, DS.Space.half)
        }
        .padding(DS.Space.s2)
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(DS.Color.bg)
    }

    private var failedHost: String {
        (state.failedURL ?? state.currentURL)?
            .host()?.replacingOccurrences(of: "www.", with: "") ?? ""
    }

    private func reload() {
        state.loadFailed = false
        if let url = state.failedURL ?? state.currentURL {
            state.webView?.load(URLRequest(url: url))
        } else {
            state.webView?.reload()
        }
    }

    private var header: some View {
        HStack(spacing: 10) {
            VStack(alignment: .leading, spacing: 1) {
                Text(state.title.isEmpty ? "Loading…" : state.title)
                    .font(DS.Font.subhead)
                    .foregroundStyle(DS.Color.fg)
                    .lineLimit(1)
                Text(state.host)
                    .font(DS.Font.caption)
                    .foregroundStyle(DS.Color.fgSubtle)
                    .lineLimit(1)
            }
            Spacer()
            Button {
                KeyboardDismissal.dismiss()
                dismiss()
            } label: {
                Image(systemName: "xmark")
                    .font(.system(size: 13, weight: .semibold))
                    .foregroundStyle(DS.Color.fgMuted)
                    .frame(width: 32, height: 32)
                    .contentShape(.circle)
            }
            .buttonStyle(.plain)
            .glassEffect(.regular.interactive(), in: .circle)
        }
        .padding(.horizontal, DS.Space.s2)
        .padding(.top, 14)
        .padding(.bottom, 10)
    }

    /// Floating Liquid Glass controls that hover over the page instead of a
    /// solid toolbar — each control is its own round glass button. Navigation
    /// bottom-left, share / open-in-Safari bottom-right.
    private var floatingControls: some View {
        HStack(spacing: 10) {
            glassButton("chevron.left", enabled: state.canGoBack) {
                state.webView?.goBack()
            }
            glassButton("chevron.right", enabled: state.canGoForward) {
                state.webView?.goForward()
            }
            Spacer()
            if let url = state.currentURL {
                ShareLink(item: url) {
                    glassIcon("square.and.arrow.up")
                }
                .buttonStyle(.plain)
                .glassEffect(.regular.interactive(), in: .circle)
            }
            glassButton("safari", enabled: state.currentURL != nil) {
                if let url = state.currentURL {
                    UIApplication.shared.open(url)
                }
            }
        }
        .padding(.horizontal, DS.Space.s2)
        .padding(.bottom, 10)
    }

    private func glassButton(
        _ symbol: String,
        enabled: Bool,
        action: @escaping () -> Void
    ) -> some View {
        Button(action: action) {
            glassIcon(symbol, enabled: enabled)
        }
        .buttonStyle(.plain)
        .glassEffect(.regular.interactive(), in: .circle)
        .disabled(!enabled)
    }

    private func glassIcon(_ symbol: String, enabled: Bool = true) -> some View {
        Image(systemName: symbol)
            .font(.system(size: 16, weight: .medium))
            .foregroundStyle(enabled ? DS.Color.fg : DS.Color.fgFaint)
            .frame(width: 44, height: 44)
            .contentShape(.circle)
    }
}
