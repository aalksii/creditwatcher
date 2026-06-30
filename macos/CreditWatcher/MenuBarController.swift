import AppKit
import SwiftUI
import Combine

@MainActor
final class MenuBarController: NSObject {
    private var statusItem: NSStatusItem?
    private var popover: NSPopover?
    private let viewModel: QuotaViewModel
    private var cancellables = Set<AnyCancellable>()

    init(viewModel: QuotaViewModel) {
        self.viewModel = viewModel
        super.init()
        setupStatusItem()
        observeTint()
        AppLogger.info("Menu bar item created")
    }

    private func setupStatusItem() {
        let item = NSStatusBar.system.statusItem(withLength: NSStatusItem.squareLength)
        statusItem = item

        guard let button = item.button else {
            AppLogger.error("NSStatusItem button is nil — menu bar icon cannot appear")
            return
        }

        let image = NSImage(systemSymbolName: "gauge", accessibilityDescription: "CreditWatcher")
        image?.isTemplate = true
        button.image = image
        button.contentTintColor = nil
        button.action = #selector(togglePopover(_:))
        button.target = self
        button.sendAction(on: [.leftMouseUp, .rightMouseUp])
    }

    private func observeTint() {
        viewModel.objectWillChange
            .receive(on: RunLoop.main)
            .sink { [weak self] _ in
                self?.updateIconTint()
            }
            .store(in: &cancellables)

        viewModel.$quota
            .receive(on: RunLoop.main)
            .sink { [weak self] _ in
                self?.updateIconTint()
            }
            .store(in: &cancellables)
    }

    private func updateIconTint() {
        guard let button = statusItem?.button else { return }
        let tint = tintColor(forWorstUsed: viewModel.quota?.worstUsedPercent)
        button.contentTintColor = tint
    }

    private func tintColor(forWorstUsed worst: Double?) -> NSColor? {
        guard let worst else { return nil }
        if worst > 90 { return .systemRed }
        if worst >= 70 { return .systemYellow }
        return nil
    }

    @objc private func togglePopover(_ sender: Any?) {
        guard let button = statusItem?.button else { return }

        if NSApp.currentEvent?.type == .rightMouseUp {
            showContextMenu(relativeTo: button)
            return
        }

        if let popover, popover.isShown {
            closePopover()
            return
        }

        showPopover(relativeTo: button)
    }

    private func showContextMenu(relativeTo button: NSStatusBarButton) {
        closePopover()

        let menu = NSMenu()
        let quitItem = NSMenuItem(
            title: "Quit CreditWatcher",
            action: #selector(quitApp(_:)),
            keyEquivalent: "q"
        )
        quitItem.target = self
        menu.addItem(quitItem)

        statusItem?.menu = menu
        button.performClick(nil)
        statusItem?.menu = nil
    }

    private func showPopover(relativeTo button: NSStatusBarButton) {
        let popover = NSPopover()
        popover.contentSize = NSSize(width: 340, height: 480)
        popover.behavior = .transient
        popover.animates = true
        popover.contentViewController = NSHostingController(
            rootView: PopoverView(viewModel: viewModel)
        )
        self.popover = popover

        viewModel.refreshOnOpen()
        popover.show(relativeTo: button.bounds, of: button, preferredEdge: .minY)

        AppLogger.info("Popover opened")
    }

    private func closePopover() {
        popover?.performClose(nil)
        popover = nil
    }

    @objc private func quitApp(_ sender: Any?) {
        closePopover()
        NSApp.terminate(nil)
    }
}
