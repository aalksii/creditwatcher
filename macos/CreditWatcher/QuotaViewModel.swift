import SwiftUI

@MainActor
final class QuotaViewModel: ObservableObject {
    @Published var quota: QuotaResponse?
    @Published var isLoading = false
    @Published var errorMessage: String?
    @Published var errorHint: String?

    private var refreshTask: Task<Void, Never>?
    private var backgroundTask: Task<Void, Never>?

    init() {
        AppLogger.info("Native quota service ready")
        startBackgroundRefresh()
    }

    deinit {
        refreshTask?.cancel()
        backgroundTask?.cancel()
    }

    func refresh(force: Bool = false) {
        refreshTask?.cancel()
        refreshTask = Task {
            await load(force: force)
        }
    }

    func refreshOnOpen() {
        refresh(force: false)
    }

    private func load(force: Bool) async {
        isLoading = true
        errorMessage = nil
        errorHint = nil
        defer { isLoading = false }

        let response = await NativeQuotaService.fetchQuota(force: force)
        if !Task.isCancelled {
            quota = response
            let errors = response.providers.compactMap { p -> String? in
                guard p.status == "error", let err = p.error else { return nil }
                return "\(p.displayName): \(err)"
            }
            if errors.isEmpty {
                errorMessage = nil
            } else {
                errorMessage = errors.joined(separator: "\n")
            }
            AppLogger.info("Quota loaded: \(response.providers.count) providers")
        }
    }

    private func startBackgroundRefresh() {
        backgroundTask = Task {
            while !Task.isCancelled {
                try? await Task.sleep(nanoseconds: UInt64(NativeQuotaService.refreshCooldown * 1_000_000_000))
                if !Task.isCancelled {
                    await load(force: false)
                }
            }
        }
    }

    var menuBarTint: Color {
        guard let quota else { return .primary }
        let worst = quota.worstUsedPercent
        if worst > 90 { return .red }
        if worst >= 70 { return .yellow }
        return .green
    }
}

func formatDuration(seconds: Int) -> String {
    if seconds <= 0 { return "now" }
    let totalHours = seconds / 3600
    let m = (seconds % 3600) / 60
    let s = seconds % 60

    if totalHours >= 24 {
        let d = totalHours / 24
        let h = totalHours % 24
        var parts = ["\(d)d"]
        if h > 0 { parts.append("\(h)h") }
        return parts.joined(separator: " ")
    }

    var parts: [String] = []
    if totalHours > 0 { parts.append("\(totalHours)h") }
    if m > 0 { parts.append("\(m)m") }
    if s > 0 && totalHours == 0 { parts.append("\(s)s") }
    return parts.isEmpty ? "0s" : parts.joined(separator: " ")
}

func shortWindowLabel(_ label: String) -> String {
    switch label {
    case "5-hour": return "5h"
    case "weekly": return "wk"
    case "7-day": return "7d"
    case "7-day Sonnet": return "7dS"
    case "7-day Opus": return "7dO"
    case "included": return "inc"
    case "on-demand": return "od"
    default:
        return label.count <= 4 ? label : String(label.prefix(4))
    }
}

func percentColor(_ used: Double) -> Color {
    if used > 90 { return .red }
    if used >= 70 { return .yellow }
    return .green
}

func formatPercent(_ used: Double) -> String {
    let rounded = (used * 10).rounded() / 10
    if rounded == rounded.rounded() {
        return "\(Int(rounded))%"
    }
    return String(format: "%.1f%%", rounded)
}
