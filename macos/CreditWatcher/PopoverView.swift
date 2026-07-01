import SwiftUI
import AppKit

struct PopoverView: View {
    @ObservedObject var viewModel: QuotaViewModel
    @State private var showsSettings = false
    private let projectURL = URL(string: "https://github.com/aalksii/creditwatcher")!

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            header
            Divider().opacity(0.3)
            if showsSettings {
                settings
            } else {
                content
            }
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
            Button {
                NSWorkspace.shared.open(projectURL)
            } label: {
                Image(systemName: "link")
            }
            .buttonStyle(.plain)
            .controlSize(.small)
            .help("Open GitHub project")

            Button {
                showsSettings.toggle()
            } label: {
                Image(systemName: showsSettings ? "list.bullet.rectangle" : "gearshape")
            }
            .buttonStyle(.plain)
            .controlSize(.small)
            .help(showsSettings ? "Show usage" : "Settings")
        }
        .padding(.horizontal, 14)
        .padding(.vertical, 10)
    }

    @ViewBuilder
    private var content: some View {
        ScrollView {
            VStack(spacing: 10) {
                if let error = viewModel.errorMessage, viewModel.quota == nil {
                    errorCard(message: error, hint: viewModel.errorHint)
                }

                if viewModel.quota != nil {
                    let visible = viewModel.visibleProviders
                    if visible.isEmpty {
                        Text("No providers shown.")
                            .font(.caption)
                            .foregroundStyle(.secondary)
                            .padding()
                    }
                    ForEach(visible) { provider in
                        ProviderCardView(provider: provider)
                    }
                } else if viewModel.isLoading {
                    HStack(spacing: 8) {
                        ProgressView()
                            .controlSize(.small)
                        Text("Fetching usage…")
                            .font(.caption)
                            .foregroundStyle(.secondary)
                    }
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, 24)
                } else if viewModel.errorMessage == nil {
                    Text("No usage data yet.")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                        .padding()
                }
            }
            .padding(12)
        }
        .frame(maxHeight: 420)
    }

    private var settings: some View {
        VStack(alignment: .leading, spacing: 10) {
            ForEach(Array(viewModel.providerSettings.enumerated()), id: \.element.id) { index, setting in
                HStack(spacing: 10) {
                    VStack(alignment: .leading, spacing: 8) {
                        Toggle(isOn: Binding(
                            get: { setting.isVisible },
                            set: { viewModel.setProviderVisible(setting.id, isVisible: $0) }
                        )) {
                            Text(setting.displayName)
                                .font(.subheadline)
                        }
                        .toggleStyle(.checkbox)

                        Button(viewModel.authActionTitle(for: setting.id)) {
                            viewModel.performAuthAction(for: setting.id)
                        }
                        .controlSize(.small)
                    }

                    Spacer()

                    Button {
                        viewModel.moveProvider(setting.id, by: -1)
                    } label: {
                        Image(systemName: "chevron.up")
                    }
                    .buttonStyle(.plain)
                    .disabled(index == 0)
                    .help("Move up")

                    Button {
                        viewModel.moveProvider(setting.id, by: 1)
                    } label: {
                        Image(systemName: "chevron.down")
                    }
                    .buttonStyle(.plain)
                    .disabled(index == viewModel.providerSettings.count - 1)
                    .help("Move down")
                }
                .padding(10)
                .background(Color(nsColor: .controlBackgroundColor).opacity(0.5))
                .clipShape(RoundedRectangle(cornerRadius: 8))
            }

            Button("Reset") {
                viewModel.resetProviderSettings()
            }
            .controlSize(.small)
        }
        .padding(12)
        .frame(maxHeight: 420, alignment: .top)
    }

    private func errorCard(message: String, hint: String?) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            Label("Could not load usage", systemImage: "exclamationmark.triangle.fill")
                .font(.subheadline.weight(.semibold))
                .foregroundStyle(.orange)

            Text(message)
                .font(.caption)
                .foregroundStyle(.primary)
                .textSelection(.enabled)

            if let hint {
                Text(hint)
                    .font(.caption2)
                    .foregroundStyle(.secondary)
                    .textSelection(.enabled)
            }
        }
        .padding(12)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Color.orange.opacity(0.08))
        .clipShape(RoundedRectangle(cornerRadius: 8))
        .overlay(
            RoundedRectangle(cornerRadius: 8)
                .stroke(Color.orange.opacity(0.25), lineWidth: 1)
        )
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
                TerminalHelper.runCommand(CLIInstaller.terminalCommand(arguments: "dashboard --verbose"))
            }
            .controlSize(.small)

            Button("Quit") {
                NSApp.terminate(nil)
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
}
