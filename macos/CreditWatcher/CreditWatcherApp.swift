import SwiftUI

@main
struct CreditWatcherApp: App {
    @StateObject private var viewModel = QuotaViewModel()

    var body: some Scene {
        MenuBarExtra {
            PopoverView(viewModel: viewModel)
        } label: {
            Image(systemName: "gauge.with.dots.needle.67percent")
                .symbolRenderingMode(.palette)
                .foregroundStyle(viewModel.menuBarTint, .primary)
        }
        .menuBarExtraStyle(.window)
    }
}
