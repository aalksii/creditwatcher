import Foundation

struct QuotaWindow: Codable, Identifiable {
    var id: String { label }
    let label: String
    let usedPercent: Double
    let remainingPercent: Double
    let resetAt: String?
    let resetAfterSeconds: Int?
}

struct ProviderCredits: Codable {
    let balance: String?
    let unlimited: Bool?
    let hasCredits: Bool?
}

struct QuotaProvider: Codable, Identifiable {
    let id: String
    let status: String
    let plan: String?
    let account: String?
    let windows: [QuotaWindow]
    let credits: ProviderCredits?
    let warnings: [String]
    let error: String?
    let loginHint: String?
    let cached: Bool?
    let secondsUntilRefresh: Int?
    let nextRefreshAt: String?
    let lastUpdated: String?

    var displayName: String {
        switch id {
        case "codex": return "Codex"
        case "claude": return "Claude"
        case "cursor": return "Cursor"
        default: return id.capitalized
        }
    }

    var worstUsedPercent: Double {
        windows.map(\.usedPercent).max() ?? 0
    }
}

struct QuotaResponse: Codable {
    let providers: [QuotaProvider]
    let updatedAt: String

    var worstUsedPercent: Double {
        providers.map(\.worstUsedPercent).max() ?? 0
    }
}

enum ProviderID: String, CaseIterable {
    case codex
    case claude
    case cursor
}

struct ProviderQuotaData: Codable {
    var providerId: String = "unknown"
    var status: String
    var plan: String?
    var account: String?
    var authSource: String?
    var windows: [QuotaWindow] = []
    var credits: ProviderCredits?
    var warnings: [String] = []
    var error: String?
    var loginHint: String?
    var lastUpdated: String?
    var cached: Bool?
    var secondsUntilRefresh: Int?
    var nextRefreshAt: String?
}
