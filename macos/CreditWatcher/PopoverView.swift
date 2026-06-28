import SwiftUI
import AppKit

struct PopoverView: View {
    @ObservedObject var viewModel: QuotaViewModel

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            header
            Divider().opacity(0.3)
            content
            Divider().opacity(0.3)
            footer
        }
        .frame(width: 340)
        .background(Color(nsColor: .windowBackgroundColor))
        .onAppear {
            viewModel.refreshOnOpen()
        }
    }

    private var header: some View {
        HStack {
            Text("CreditWatcher")
                .font(.headline)
            Spacer()
            if viewModel.isLoading {
                ProgressView()
                    .controlSize(.small)
            }
        }
        .padding(.horizontal, 14)
        .padding(.vertical, 10)
    }

    @ViewBuilder
    private var content: some View {
        ScrollView {
            VStack(spacing: 10) {
                if let error = viewModel.errorMessage, viewModel.quota == nil {
                    Text(error)
                        .font(.caption)
                        .foregroundStyle(.red)
                        .padding()
                }

                if let quota = viewModel.quota {
                    ForEach(quota.providers) { provider in
                        ProviderCardView(provider: provider)
                    }
                } else if !viewModel.isLoading && viewModel.errorMessage == nil {
                    Text("Loading usage…")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                        .padding()
                }
            }
            .padding(12)
        }
        .frame(maxHeight: 420)
    }

    private var footer: some View {
        HStack {
            if let updated = viewModel.quota?.updatedAt {
                Text("Updated \(formatUpdatedAt(updated))")
                    .font(.caption2)
                    .foregroundStyle(.secondary)
            }
            Spacer()
            Button("Refresh") {
                viewModel.refresh(force: true)
            }
            .controlSize(.small)
            .disabled(viewModel.isLoading)

            Button("CLI") {
                openCLIHelp()
            }
            .controlSize(.small)
        }
        .padding(.horizontal, 14)
        .padding(.vertical, 8)
    }

    private func formatUpdatedAt(_ iso: String) -> String {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        var date = formatter.date(from: iso)
        if date == nil {
            formatter.formatOptions = [.withInternetDateTime]
            date = formatter.date(from: iso)
        }
        guard let date else { return iso }
        return date.formatted(date: .omitted, time: .shortened)
    }

    private func openCLIHelp() {
        let script = """
        tell application "Terminal"
            activate
            do script "creditwatcher dashboard --verbose"
        end tell
        """
        if let appleScript = NSAppleScript(source: script) {
            var error: NSDictionary?
            appleScript.executeAndReturnError(&error)
        }
    }
}
