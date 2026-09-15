import AVFoundation
import SwiftUI
import Vision
import VisionKit

enum QRScannerState: Equatable {
    case checking
    case requestingPermission
    case scanning
    case denied
    case unavailable(String)
    case invalid(String)

    static func resolve(authorization: AVAuthorizationStatus, isSupported: Bool, isAvailable: Bool) -> Self {
        switch authorization {
        case .notDetermined:
            return .requestingPermission
        case .denied, .restricted:
            return .denied
        case .authorized:
            guard isSupported else {
                return .unavailable(String(localized: "This device does not support live QR scanning. Paste the pairing link instead."))
            }
            guard isAvailable else {
                return .unavailable(String(localized: "The camera scanner is not available right now. Paste the pairing link instead."))
            }
            return .scanning
        @unknown default:
            return .unavailable(String(localized: "The camera scanner is not available right now. Paste the pairing link instead."))
        }
    }
}

@MainActor
final class QRScannerResolutionGuard {
    private var didResolveValidCode = false

    func evaluate(rawValue: String, onScannedCode: (String) -> Bool) -> Bool {
        guard !didResolveValidCode else { return false }
        let didAccept = onScannedCode(rawValue)
        if didAccept {
            didResolveValidCode = true
        }
        return didAccept
    }
}

struct QRScannerView: View {
    let message: String?
    let previewState: QRScannerState?
    let onScannedCode: (String) -> Bool
    let onDismiss: () -> Void

    @Environment(\.scenePhase) private var scenePhase
    @State private var scannerState: QRScannerState = .checking

    init(
        message: String? = nil,
        previewState: QRScannerState? = nil,
        onScannedCode: @escaping (String) -> Bool,
        onDismiss: @escaping () -> Void
    ) {
        self.message = message
        self.previewState = previewState
        self.onScannedCode = onScannedCode
        self.onDismiss = onDismiss
    }

    private var currentState: QRScannerState {
        previewState ?? scannerState
    }

    var body: some View {
        NavigationStack {
            ZStack {
                switch currentState {
                case .checking, .requestingPermission:
                    ProgressView("Preparing camera...")
                        .frame(maxWidth: .infinity, maxHeight: .infinity)
                case .scanning, .invalid:
                    QRScannerSurface(
                        message: scannerMessage,
                        isActive: scenePhase == .active,
                        onScannedCode: onScannedCode,
                        onBecameUnavailable: { scannerState = .unavailable($0) }
                    )
                case .denied:
                    ScannerFallbackView(
                        title: String(localized: "Camera Access Needed"),
                        message: String(
                            localized: "Allow camera access in Settings, or paste the pairing link instead."
                        ),
                        systemImage: "camera.fill",
                        showsSettingsButton: true
                    )
                case .unavailable(let message):
                    ScannerFallbackView(
                        title: String(localized: "Scanner Unavailable"),
                        message: message,
                        systemImage: "qrcode.viewfinder"
                    )
                }
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity)
            .navigationTitle("Scan Pairing QR")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Close", action: onDismiss)
                }
            }
            .task(id: scenePhase) { await resolveCameraState() }
            .onChange(of: message) { _, newMessage in
                guard let newMessage, previewState == nil else { return }
                switch scannerState {
                case .scanning, .invalid:
                    scannerState = .invalid(newMessage)
                default:
                    break
                }
            }
        }
    }

    private var scannerMessage: String? {
        if case .invalid(let message) = currentState { return message }
        return nil
    }

    private func resolveCameraState() async {
        guard previewState == nil, scenePhase == .active else { return }
        var authorization = AVCaptureDevice.authorizationStatus(for: .video)
        if authorization == .notDetermined {
            scannerState = .requestingPermission
            _ = await AVCaptureDevice.requestAccess(for: .video)
            guard !Task.isCancelled else { return }
            authorization = AVCaptureDevice.authorizationStatus(for: .video)
        }
        let resolved = QRScannerState.resolve(
            authorization: authorization,
            isSupported: DataScannerViewController.isSupported,
            isAvailable: DataScannerViewController.isAvailable
        )
        // Returning from an interruption should preserve feedback and the same
        // scanner instance, so an invalid QR can be retried without camera churn.
        if resolved == .scanning, case .invalid = scannerState { return }
        scannerState = resolved
    }
}

private struct QRScannerSurface: View {
    let message: String?
    let isActive: Bool
    let onScannedCode: (String) -> Bool
    let onBecameUnavailable: (String) -> Void

    var body: some View {
        QRDataScannerView(
            isActive: isActive,
            onScannedCode: onScannedCode,
            onBecameUnavailable: onBecameUnavailable
        )
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .ignoresSafeArea(edges: .bottom)
        .safeAreaInset(edge: .bottom) {
            ScannerStatusBanner(
                message: message ?? String(localized: "Point the camera at a Graft pairing QR code."),
                systemImage: message == nil ? "qrcode" : "exclamationmark.triangle"
            )
        }
        .accessibilityElement(children: .contain)
        .accessibilityLabel(Text("QR code scanner", comment: "Accessibility label for the live QR scanner"))
    }
}

private struct QRDataScannerView: UIViewControllerRepresentable {
    let isActive: Bool
    let onScannedCode: (String) -> Bool
    let onBecameUnavailable: (String) -> Void

    func makeCoordinator() -> Coordinator {
        Coordinator(onScannedCode: onScannedCode, onBecameUnavailable: onBecameUnavailable)
    }

    func makeUIViewController(context: Context) -> QRScannerHostController {
        let scanner = DataScannerViewController(
            recognizedDataTypes: [.barcode(symbologies: [.qr])],
            qualityLevel: .balanced,
            recognizesMultipleItems: false,
            isHighFrameRateTrackingEnabled: false,
            isPinchToZoomEnabled: true,
            isGuidanceEnabled: true,
            isHighlightingEnabled: true
        )
        scanner.delegate = context.coordinator
        let host = QRScannerHostController(
            scanner: scanner,
            onBecameUnavailable: context.coordinator.becameUnavailable
        )
        context.coordinator.host = host
        host.setActive(isActive)
        return host
    }

    func updateUIViewController(_ host: QRScannerHostController, context: Context) {
        context.coordinator.onScannedCode = onScannedCode
        context.coordinator.onBecameUnavailable = onBecameUnavailable
        host.setActive(isActive)
    }

    static func dismantleUIViewController(_ host: QRScannerHostController, coordinator: Coordinator) {
        host.finishScanning()
        (host.scanner as? DataScannerViewController)?.delegate = nil
        coordinator.host = nil
    }

    @MainActor
    final class Coordinator: NSObject, DataScannerViewControllerDelegate {
        var onScannedCode: (String) -> Bool
        var onBecameUnavailable: (String) -> Void
        weak var host: QRScannerHostController?
        private let resolutionGuard = QRScannerResolutionGuard()

        init(
            onScannedCode: @escaping (String) -> Bool,
            onBecameUnavailable: @escaping (String) -> Void
        ) {
            self.onScannedCode = onScannedCode
            self.onBecameUnavailable = onBecameUnavailable
        }

        func dataScanner(
            _ dataScanner: DataScannerViewController,
            didAdd addedItems: [RecognizedItem],
            allItems: [RecognizedItem]
        ) {
            handle(items: addedItems, scanner: dataScanner)
        }

        func dataScanner(
            _ dataScanner: DataScannerViewController,
            didUpdate updatedItems: [RecognizedItem],
            allItems: [RecognizedItem]
        ) {
            handle(items: updatedItems, scanner: dataScanner)
        }

        func dataScanner(
            _ dataScanner: DataScannerViewController,
            becameUnavailableWithError error: DataScannerViewController.ScanningUnavailable
        ) {
            host?.becameUnavailable(message: scannerUnavailableMessage(error))
        }

        func becameUnavailable(message: String) {
            guard host != nil else { return }
            onBecameUnavailable(message)
        }

        private func handle(items: [RecognizedItem], scanner: DataScannerViewController) {
            for item in items {
                guard case .barcode(let barcode) = item,
                      let payload = barcode.payloadStringValue,
                      !payload.isEmpty
                else { continue }

                if resolutionGuard.evaluate(rawValue: payload, onScannedCode: onScannedCode) {
                    host?.finishScanning()
                    return
                }
            }
        }
    }
}

private struct ScannerStatusBanner: View {
    let message: String
    let systemImage: String

    var body: some View {
        Label(message, systemImage: systemImage)
            .font(.callout)
            .multilineTextAlignment(.leading)
            .padding()
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(.regularMaterial)
            .accessibilityAddTraits(.isStaticText)
    }
}

private struct ScannerFallbackView: View {
    @Environment(\.openURL) private var openURL
    let title: String
    let message: String
    let systemImage: String
    var showsSettingsButton = false

    var body: some View {
        ContentUnavailableView {
            Label(title, systemImage: systemImage)
        } description: {
            Text(message)
        } actions: {
            if showsSettingsButton {
                Button("Open Settings") {
                    if let url = URL(string: UIApplication.openSettingsURLString) {
                        openURL(url)
                    }
                }
                .buttonStyle(.borderedProminent)
            }
        }
        .padding()
    }
}

func scannerUnavailableMessage(_ error: Error) -> String {
    if let unavailable = error as? DataScannerViewController.ScanningUnavailable {
        return scannerUnavailableMessage(unavailable)
    }
    return String(localized: "The camera scanner stopped. Paste the pairing link instead.")
}

private func scannerUnavailableMessage(
    _ error: DataScannerViewController.ScanningUnavailable
) -> String {
    switch error {
    case .cameraRestricted:
        return String(localized: "Camera access is restricted on this device. Paste the pairing link instead.")
    case .unsupported:
        return String(localized: "This device does not support live QR scanning. Paste the pairing link instead.")
    @unknown default:
        return String(localized: "The camera scanner stopped. Paste the pairing link instead.")
    }
}

#Preview("Scanning") {
    QRScannerView(previewState: .scanning, onScannedCode: { _ in false }, onDismiss: {})
}

#Preview("Denied") {
    QRScannerView(previewState: .denied, onScannedCode: { _ in false }, onDismiss: {})
}

#Preview("Unavailable") {
    QRScannerView(
        previewState: .unavailable("This device does not support live QR scanning. Paste the pairing link instead."),
        onScannedCode: { _ in false },
        onDismiss: {}
    )
}

#Preview("Invalid") {
    QRScannerView(
        previewState: .invalid("That QR code is not a valid Graft pairing code. Keep the scanner open and try another code."),
        onScannedCode: { _ in false },
        onDismiss: {}
    )
}
