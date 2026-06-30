import Foundation

enum QuotaCache {
    private static let dir: URL = {
        FileManager.default.homeDirectoryForCurrentUser
            .appendingPathComponent(".creditwatcher", isDirectory: true)
    }()

    private static let minInterval: TimeInterval = 60

    static func checkUsageCooldown(provider: ProviderID) throws {
        let url = dir.appendingPathComponent(usageCacheFile(provider))
        guard let data = try? Data(contentsOf: url),
              let entry = try? JSONDecoder().decode(UsageCooldown.self, from: data)
        else { return }

        let fetchedAt = normalizeFetchedAt(entry.fetchedAt)
        let elapsed = Date().timeIntervalSince1970 - fetchedAt

        // Mixed CLI (ms) / app (s) cache formats can produce bogus wait times.
        if elapsed < 0 || elapsed > minInterval {
            try? FileManager.default.removeItem(at: url)
            return
        }

        if elapsed < minInterval {
            let wait = Int(ceil(minInterval - elapsed))
            if wait > Int(minInterval) {
                try? FileManager.default.removeItem(at: url)
                return
            }
            throw QuotaError.cooldown(seconds: wait, provider: provider)
        }
    }

    private static func normalizeFetchedAt(_ value: TimeInterval) -> TimeInterval {
        value > 1_000_000_000_000 ? value / 1000 : value
    }

    static func markUsageFetched(provider: ProviderID) {
        try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        let entry = UsageCooldown(fetchedAt: Date().timeIntervalSince1970)
        let url = dir.appendingPathComponent(usageCacheFile(provider))
        if let data = try? JSONEncoder().encode(entry) {
            try? data.write(to: url, options: .atomic)
        }
    }

    static func loadProviderCache(_ provider: ProviderID) -> ProviderQuotaData? {
        let url = dir.appendingPathComponent("quota-cache-\(provider.rawValue).json")
        guard let data = try? Data(contentsOf: url),
              let entry = try? JSONDecoder().decode(ProviderCacheEntry.self, from: data)
        else { return nil }
        return entry.data
    }

    static func saveProviderCache(_ provider: ProviderID, data: ProviderQuotaData) {
        try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        let entry = ProviderCacheEntry(data: data, fetchedAt: Date().timeIntervalSince1970)
        let url = dir.appendingPathComponent("quota-cache-\(provider.rawValue).json")
        if let encoded = try? JSONEncoder().encode(entry) {
            try? encoded.write(to: url, options: .atomic)
        }
    }

    static func clearProvider(_ provider: ProviderID) {
        let files = [
            usageCacheFile(provider),
            "quota-cache-\(provider.rawValue).json",
        ]
        for file in files {
            try? FileManager.default.removeItem(at: dir.appendingPathComponent(file))
        }
    }

    private static func usageCacheFile(_ provider: ProviderID) -> String {
        switch provider {
        case .codex: return "usage-cache.json"
        case .claude: return "usage-cache-claude.json"
        case .cursor: return "usage-cache-cursor.json"
        }
    }

    private struct UsageCooldown: Codable {
        let fetchedAt: TimeInterval
    }

    private struct ProviderCacheEntry: Codable {
        let data: ProviderQuotaData
        let fetchedAt: TimeInterval
    }
}

enum QuotaError: LocalizedError {
    case notConnected(provider: ProviderID, hint: String)
    case cooldown(seconds: Int, provider: ProviderID)
    case http(status: Int, body: String)
    case auth(String)

    var errorDescription: String? {
        switch self {
        case .notConnected(_, let hint): return hint
        case .cooldown(let seconds, _):
            return "Usage was checked recently. Wait \(seconds)s before checking again (max once per 60s)."
        case .http(let status, let body): return "Request failed (\(status)): \(body.prefix(200))"
        case .auth(let message): return message
        }
    }
}
