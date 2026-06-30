import SwiftUI

@MainActor
final class QuotaViewModel: ObservableObject {
    @Published var quota: QuotaResponse?
    @Published var isLoading = false
    @Published var errorMessage: String?
    @Published var errorHint: String?
    @Published private(set) var providerSettings: [ProviderDisplaySetting]
    @Published private(set) var signedOutProviders: Set<String>

    private var refreshTask: Task<Void, Never>?
    private var backgroundTask: Task<Void, Never>?
    private let providerSettingsKey = "providerDisplaySettings"
    private let signedOutProvidersKey = "signedOutProviders"

    init() {
        providerSettings = Self.loadProviderSettings()
        signedOutProviders = Self.loadSignedOutProviders()
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

    var visibleProviders: [QuotaProvider] {
        guard let quota else { return [] }

        let byId = Dictionary(uniqueKeysWithValues: quota.providers.map { ($0.id, $0) })
        let ordered = providerSettings
            .filter(\.isVisible)
            .compactMap { byId[$0.id] }
        let knownIds = Set(providerSettings.map(\.id))
        let extras = quota.providers.filter { !knownIds.contains($0.id) }
        return ordered + extras
    }

    func setProviderVisible(_ id: String, isVisible: Bool) {
        guard let index = providerSettings.firstIndex(where: { $0.id == id }) else { return }
        providerSettings[index].isVisible = isVisible
        saveProviderSettings()
    }

    func moveProvider(_ id: String, by offset: Int) {
        guard let from = providerSettings.firstIndex(where: { $0.id == id }) else { return }
        let to = from + offset
        guard providerSettings.indices.contains(to) else { return }
        let item = providerSettings.remove(at: from)
        providerSettings.insert(item, at: to)
        saveProviderSettings()
    }

    func resetProviderSettings() {
        providerSettings = Self.defaultProviderSettings()
        saveProviderSettings()
    }

    func authActionTitle(for providerId: String) -> String {
        isSignedIn(providerId) ? "Sign Out" : "Sign In"
    }

    func performAuthAction(for providerId: String) {
        if isSignedIn(providerId) {
            signOut(providerId)
        } else {
            signIn(providerId)
        }
    }

    func isSignedIn(_ providerId: String) -> Bool {
        if signedOutProviders.contains(providerId) { return false }
        if let provider = quota?.providers.first(where: { $0.id == providerId }) {
            return provider.status != "not_connected"
        }
        return hasLocalCredentials(providerId)
    }

    private func signIn(_ providerId: String) {
        signedOutProviders.remove(providerId)
        saveSignedOutProviders()
        let command = ProviderID(rawValue: providerId)?.loginCommand ?? "creditwatcher login \(providerId)"
        TerminalHelper.runCommand(command)
        refresh(force: true)
    }

    private func signOut(_ providerId: String) {
        guard let provider = ProviderID(rawValue: providerId) else { return }
        signedOutProviders.insert(providerId)
        saveSignedOutProviders()
        forgetCredentials(for: provider)
        QuotaCache.clearProvider(provider)
        replaceProvider(with: signedOutQuotaProvider(provider))
    }

    private func load(force: Bool) async {
        isLoading = true
        errorMessage = nil
        errorHint = nil
        defer { isLoading = false }

        let response = await NativeQuotaService.fetchQuota(
            force: force,
            signedOutProviders: signedOutProviders
        )
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
        let worst = visibleProviders.map(\.worstUsedPercent).max() ?? quota?.worstUsedPercent ?? 0
        if worst > 90 { return .red }
        if worst >= 70 { return .yellow }
        return .green
    }

    private static func defaultProviderSettings() -> [ProviderDisplaySetting] {
        ProviderID.allCases.map { ProviderDisplaySetting(id: $0.rawValue, isVisible: true) }
    }

    private static func loadProviderSettings() -> [ProviderDisplaySetting] {
        let defaults = defaultProviderSettings()
        guard let data = UserDefaults.standard.data(forKey: "providerDisplaySettings"),
              let decoded = try? JSONDecoder().decode([ProviderDisplaySetting].self, from: data)
        else { return defaults }

        var result = decoded.filter { setting in
            ProviderID(rawValue: setting.id) != nil
        }
        let existingIds = Set(result.map(\.id))
        for item in defaults where !existingIds.contains(item.id) {
            result.append(item)
        }
        return result.isEmpty ? defaults : result
    }

    private func saveProviderSettings() {
        guard let data = try? JSONEncoder().encode(providerSettings) else { return }
        UserDefaults.standard.set(data, forKey: providerSettingsKey)
    }

    private static func loadSignedOutProviders() -> Set<String> {
        let ids = UserDefaults.standard.stringArray(forKey: "signedOutProviders") ?? []
        return Set(ids.filter { ProviderID(rawValue: $0) != nil })
    }

    private func saveSignedOutProviders() {
        UserDefaults.standard.set(Array(signedOutProviders).sorted(), forKey: signedOutProvidersKey)
    }

    private func hasLocalCredentials(_ providerId: String) -> Bool {
        switch providerId {
        case ProviderID.codex.rawValue:
            return CodexAuth.load() != nil
        case ProviderID.claude.rawValue:
            return !ClaudeAuth.loadCandidates().isEmpty
        case ProviderID.cursor.rawValue:
            return !CursorAuth.loadCandidates().isEmpty
        default:
            return false
        }
    }

    private func forgetCredentials(for provider: ProviderID) {
        switch provider {
        case .codex:
            CodexAuth.forgetCopy()
        case .claude:
            ClaudeAuth.forgetCopy()
        case .cursor:
            CursorAuth.forgetCopy()
        }
    }

    private func replaceProvider(with provider: QuotaProvider) {
        let updatedAt = quota?.updatedAt ?? ISO8601DateFormatter().string(from: Date())
        var providers = quota?.providers ?? []
        if let index = providers.firstIndex(where: { $0.id == provider.id }) {
            providers[index] = provider
        } else {
            providers.append(provider)
        }
        quota = QuotaResponse(providers: providers, updatedAt: updatedAt)
    }

    private func signedOutQuotaProvider(_ provider: ProviderID) -> QuotaProvider {
        QuotaProvider(
            id: provider.rawValue,
            status: "not_connected",
            plan: nil,
            account: nil,
            windows: [],
            credits: nil,
            warnings: [],
            error: nil,
            loginHint: "Signed out in CreditWatcher. Sign in from Settings to reconnect.",
            cached: nil,
            secondsUntilRefresh: nil,
            nextRefreshAt: nil,
            lastUpdated: nil
        )
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
