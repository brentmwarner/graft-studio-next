import UIKit
import VisionKit

@MainActor
protocol QRScanningController: AnyObject {
    var isScanning: Bool { get }
    func startScanning() throws
    func stopScanning()
}

extension DataScannerViewController: QRScanningController {}

/// VisionKit owns the camera; this container starts it only after UIKit has
/// attached and presented its view. SwiftUI updates never create a new session.
@MainActor
final class QRScannerHostController: UIViewController {
    let scanner: UIViewController & QRScanningController
    var onBecameUnavailable: (String) -> Void

    private var hasAppeared = false
    private var isActive = false
    private var hasFinished = false

    init(scanner: UIViewController & QRScanningController,
         onBecameUnavailable: @escaping (String) -> Void) {
        self.scanner = scanner
        self.onBecameUnavailable = onBecameUnavailable
        super.init(nibName: nil, bundle: nil)
    }

    @available(*, unavailable)
    required init?(coder: NSCoder) { nil }

    override func viewDidLoad() {
        super.viewDidLoad()
        view.backgroundColor = .black
        addChild(scanner)
        scanner.view.translatesAutoresizingMaskIntoConstraints = false
        view.addSubview(scanner.view)
        NSLayoutConstraint.activate([
            scanner.view.leadingAnchor.constraint(equalTo: view.leadingAnchor),
            scanner.view.trailingAnchor.constraint(equalTo: view.trailingAnchor),
            scanner.view.topAnchor.constraint(equalTo: view.topAnchor),
            scanner.view.bottomAnchor.constraint(equalTo: view.bottomAnchor),
        ])
        scanner.didMove(toParent: self)
    }

    override func viewDidAppear(_ animated: Bool) {
        super.viewDidAppear(animated)
        hasAppeared = true
        startIfReady()
    }

    override func viewWillDisappear(_ animated: Bool) {
        hasAppeared = false
        stopScanning()
        super.viewWillDisappear(animated)
    }

    func setActive(_ active: Bool) {
        isActive = active
        if active {
            startIfReady()
        } else {
            stopScanning()
        }
    }

    func finishScanning() {
        hasFinished = true
        stopScanning()
    }

    func becameUnavailable(message: String) {
        guard hasAppeared, isActive, !hasFinished else { return }
        finishScanning()
        AppLog.ui.error("QR camera session unavailable")
        // An updateUIViewController call can trigger a failed resume. Deliver
        // the SwiftUI state change after that update has returned.
        Task { @MainActor [weak self] in
            guard let self, self.hasAppeared else { return }
            self.onBecameUnavailable(message)
        }
    }

    private func startIfReady() {
        guard hasAppeared, isActive, !hasFinished, !scanner.isScanning else { return }
        do {
            try scanner.startScanning()
            AppLog.ui.debug("QR camera session started after presentation")
        } catch {
            becameUnavailable(message: scannerUnavailableMessage(error))
        }
    }

    private func stopScanning() {
        guard scanner.isScanning else { return }
        scanner.stopScanning()
        AppLog.ui.debug("QR camera session stopped")
    }
}
