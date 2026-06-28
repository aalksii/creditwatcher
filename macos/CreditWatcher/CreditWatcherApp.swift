import SwiftUI

@main
struct CreditWatcherApp: App {
    @StateObject private var viewModel = QuotaViewModel()

    var body: some Scene {
        MenuBarExtra {
            PopoverView(viewModel: viewModel)
        } label: {
            Image(systemName: "gauge")
                .symbolRenderingMode(.palette)
                .foregroundStyle(viewModel.menuBarTint, Color.primary.opacity(0.85))
        }
        .menuBarExtraStyle(.window)
    }
}
