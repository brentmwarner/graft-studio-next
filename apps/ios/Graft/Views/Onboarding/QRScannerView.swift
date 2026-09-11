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
                case .scanning:
                    scannerSurface
                case .invalid(let message):
                    scannerSurface
                        .safeAreaInset(edge: .bottom) {
                            ScannerStatusBanner(message: message, systemImage: "exclamationmark.triangle")
                        }
                case .denied:
                    ScannerFallbackView(
                        title: String(localized: "Camera Access Needed"),
                        message: String(
                            localized: "Allow camera access in Settings, or paste the pairing link instead."
                        ),
                        systemImage: "camera.fill"
                    )
                case .unavailable(let message):
                    ScannerFallbackView(
                        title: String(localized: "Scanner Unavailable"),
                        message: message,
                        systemImage: "qrcode.viewfinder"
                    )
                }
            }
            .navigationTitle("Scan Pairing QR")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Close", action: onDismiss)
                }
            }
            .onAppear(perform: resolveCameraState)
            .onChange(of: message) { _, newMessage in
                guard let newMessage, previewState == nil else { return }
                scannerState = .invalid(newMessage)
            }
        }
    }

    private var scannerSurface: some View {
        ZStack {
            QRDataScannerView(
                onScannedCode: onScannedCode,
                onBecameUnavailable: { scannerState = .unavailable($0) }
            )
            .ignoresSafeArea(edges: .bottom)

            VStack {
                Spacer()
                ScannerStatusBanner(
                    message: String(localized: "Point the camera at a Graft pairing QR code."),
                    systemImage: "qrcode"
                )
            }
        }
        .accessibilityElement(children: .contain)
        .accessibilityLabel(
            Text(
                "QR code scanner",
                comment: "Accessibility label for the live QR scanner"
            )
        )
    }

    private func resolveCameraState() {
        guard previewState == nil else { return }
        guard DataScannerViewController.isSupported else {
            scannerState = .unavailable(
                String(localized: "This device does not support live QR scanning. Paste the pairing link instead.")
            )
            return
        }
        guard DataScannerViewController.isAvailable else {
            scannerState = .unavailable(
                String(localized: "The camera scanner is not available right now. Paste the pairing link instead.")
            )
            return
        }

        switch AVCaptureDevice.authorizationStatus(for: .video) {
        case .authorized:
            scannerState = .scanning
        case .notDetermined:
            scannerState = .requestingPermission
            AVCaptureDevice.requestAccess(for: .video) { isGranted in
                Task { @MainActor in
                    scannerState = isGranted ? .scanning : .denied
                }
            }
        case .denied, .restricted:
            scannerState = .denied
        @unknown default:
            scannerState = .unavailable(
                String(localized: "The camera scanner is not available right now. Paste the pairing link instead.")
            )
        }
    }
}

private struct QRDataScannerView: UIViewControllerRepresentable {
    let onScannedCode: (String) -> Bool
    let onBecameUnavailable: (String) -> Void

    func makeCoordinator() -> Coordinator {
        Coordinator(onScannedCode: onScannedCode, onBecameUnavailable: onBecameUnavailable)
    }

    func makeUIViewController(context: Context) -> DataScannerViewController {
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
        do {
            try scanner.startScanning()
        } catch {
            context.coordinator.becameUnavailable(message: scannerUnavailableMessage(error))
        }
        return scanner
    }

    func updateUIViewController(_ uiViewController: DataScannerViewController, context: Context) {
        context.coordinator.onScannedCode = onScannedCode
        context.coordinator.onBecameUnavailable = onBecameUnavailable
        guard !uiViewController.isScanning else { return }
        do {
            try uiViewController.startScanning()
        } catch {
            context.coordinator.becameUnavailable(message: scannerUnavailableMessage(error))
        }
    }

    static func dismantleUIViewController(_ uiViewController: DataScannerViewController, coordinator: Coordinator) {
        uiViewController.stopScanning()
        uiViewController.delegate = nil
    }

    @MainActor
    final class Coordinator: NSObject, DataScannerViewControllerDelegate {
        var onScannedCode: (String) -> Bool
        var onBecameUnavailable: (String) -> Void
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
            dataScanner.stopScanning()
            becameUnavailable(message: scannerUnavailableMessage(error))
        }

        func becameUnavailable(message: String) {
            onBecameUnavailable(message)
        }

        private func handle(items: [RecognizedItem], scanner: DataScannerViewController) {
            for item in items {
                guard case .barcode(let barcode) = item,
                      let payload = barcode.payloadStringValue,
                      !payload.isEmpty
                else { continue }

                if resolutionGuard.evaluate(rawValue: payload, onScannedCode: onScannedCode) {
                    scanner.stopScanning()
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
    let title: String
    let message: String
    let systemImage: String

    var body: some View {
        ContentUnavailableView {
            Label(title, systemImage: systemImage)
        } description: {
            Text(message)
        }
        .padding()
    }
}

private func scannerUnavailableMessage(_ error: Error) -> String {
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
