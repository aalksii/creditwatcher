import SwiftUI
import AppKit

@main
struct CreditWatcherApp: App {
    @NSApplicationDelegateAdaptor(AppDelegate.self) private var appDelegate

    init() {
        AppLogger.info("App started")
    }

    var body: some Scene {
        // Menu bar icon is managed by NSStatusItem (MenuBarController).
        // Settings scene keeps SwiftUI App lifecycle alive without a Dock icon.
        Settings {
            EmptyView()
        }
        .commands {
            CommandGroup(replacing: .appSettings) {}
        }
    }
}

@MainActor
final class AppDelegate: NSObject, NSApplicationDelegate {
    private var menuBarController: MenuBarController?
    private let viewModel = QuotaViewModel()

    func applicationWillFinishLaunching(_ notification: Notification) {
        NSApp.setActivationPolicy(.accessory)
        AppLogger.info("Activation policy set to .accessory")
    }

    func applicationDidFinishLaunching(_ notification: Notification) {
        menuBarController = MenuBarController(viewModel: viewModel)
        AppLogger.info("Launch complete — menu bar should be visible")
    }
}
