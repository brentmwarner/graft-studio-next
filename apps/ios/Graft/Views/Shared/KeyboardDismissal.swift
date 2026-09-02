import SwiftUI

#if canImport(UIKit)
import UIKit
#endif

@MainActor
enum KeyboardDismissal {
    static func dismiss() {
        #if canImport(UIKit)
        UIApplication.shared.sendAction(
            #selector(UIResponder.resignFirstResponder),
            to: nil,
            from: nil,
            for: nil
        )
        #endif
    }
}

@MainActor
enum ModalDismissal {
    static func dismissPresentedModals() {
        #if canImport(UIKit)
        for scene in UIApplication.shared.connectedScenes {
            guard let windowScene = scene as? UIWindowScene else { continue }
            for window in windowScene.windows {
                window.rootViewController?.presentedViewController?.dismiss(animated: false)
            }
        }
        #endif
    }
}

@MainActor
enum PrivacySnapshotOverlay {
    #if canImport(UIKit)
    private static var overlayWindows: [UIWindow] = []
    #endif

    static func show() {
        #if canImport(UIKit)
        guard overlayWindows.isEmpty else { return }
        overlayWindows = UIApplication.shared.connectedScenes.compactMap { scene in
            guard let windowScene = scene as? UIWindowScene else { return nil }
            let window = UIWindow(windowScene: windowScene)
            window.windowLevel = .alert + 1
            let controller = UIViewController()
            controller.view.backgroundColor = .black
            window.rootViewController = controller
            window.isHidden = false
            return window
        }
        #endif
    }

    static func hide() {
        #if canImport(UIKit)
        overlayWindows.forEach { $0.isHidden = true }
        overlayWindows.removeAll()
        #endif
    }
}

extension View {
    func dismissKeyboardOnTap() -> some View {
        simultaneousGesture(
            TapGesture().onEnded {
                KeyboardDismissal.dismiss()
            },
            including: .gesture
        )
    }

    func dismissKeyboardOnDisappear() -> some View {
        onDisappear {
            KeyboardDismissal.dismiss()
        }
    }
}
