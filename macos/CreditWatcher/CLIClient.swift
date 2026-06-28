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

enum CLIClientError: LocalizedError {
    case cliNotFound
    case nodeNotFound
    case executionFailed(String)
    case invalidJSON(String)

    var errorDescription: String? {
        switch self {
        case .cliNotFound:
            return "creditwatcher CLI not found."
        case .nodeNotFound:
            return "Node.js not found. Install Node 18+ (Homebrew or nvm)."
        case .executionFailed(let message):
            return message
        case .invalidJSON(let message):
            return "Invalid JSON from CLI: \(message)"
        }
    }

    var recoverySuggestion: String? {
        switch self {
        case .cliNotFound:
            return "Run npm install && npm run build from the repo, then rebuild the app. Or set CREDITWATCHER_CLI_PATH in the Xcode scheme."
        case .nodeNotFound:
            return "Install Node via Homebrew (brew install node) or nvm, then rebuild."
        default:
            return nil
        }
    }
}

final class CLIClient {
    static let shared = CLIClient()

    private let refreshCooldown: TimeInterval = 60

    func fetchQuota(force: Bool = false) async throws -> QuotaResponse {
        let (executable, arguments) = try resolveCLI(force: force)
        let output = try await runProcess(executable: executable, arguments: arguments)
        return try parseQuota(from: output)
    }

    private func resolveCLI(force: Bool) throws -> (String, [String]) {
        var args = ["quota", "--json"]
        if force {
            args.append("--force")
        }

        if let custom = ProcessInfo.processInfo.environment["CREDITWATCHER_CLI_PATH"], !custom.isEmpty {
            if custom.hasSuffix(".js") {
                guard let node = resolveNode() else {
                    throw CLIClientError.nodeNotFound
                }
                return (node, [custom] + args)
            }
            return (custom, args)
        }

        if let bundled = bundledCLIPath() {
            guard let node = resolveNode() else {
                throw CLIClientError.nodeNotFound
            }
            return (node, [bundled] + args)
        }

        if let cli = findOnPath("creditwatcher") {
            return (cli, args)
        }

        for path in devCLIPaths() {
            if FileManager.default.isExecutableFile(atPath: path) {
                return (path, args)
            }
            if path.hasSuffix(".js"), FileManager.default.fileExists(atPath: path) {
                guard let node = resolveNode() else {
                    throw CLIClientError.nodeNotFound
                }
                return (node, [path] + args)
            }
        }

        throw CLIClientError.cliNotFound
    }

    private func bundledCLIPath() -> String? {
        if let url = Bundle.main.url(forResource: "cli", withExtension: "js", subdirectory: "cli") {
            return url.path
        }
        let fallback = Bundle.main.bundlePath + "/Contents/Resources/cli/cli.js"
        return FileManager.default.fileExists(atPath: fallback) ? fallback : nil
    }

    private func devCLIPaths() -> [String] {
        let bundlePath = Bundle.main.bundlePath
        let candidates = [
            bundlePath + "/../../../dist/cli.js",
            bundlePath + "/../../../../dist/cli.js",
            FileManager.default.currentDirectoryPath + "/dist/cli.js",
            NSHomeDirectory() + "/git/creditwatcher/dist/cli.js",
        ]
        return candidates.map { NSString(string: $0).standardizingPath as String }
    }

    private func resolveNode() -> String? {
        let home = NSHomeDirectory()
        var candidates = [
            "/opt/homebrew/bin/node",
            "/usr/local/bin/node",
            "/usr/bin/node",
        ]

        let nvmBase = home + "/.nvm/versions/node"
        if let versions = try? FileManager.default.contentsOfDirectory(atPath: nvmBase) {
            for version in versions.sorted().reversed() {
                candidates.insert(nvmBase + "/" + version + "/bin/node", at: 0)
            }
        }

        let fnmBase = home + "/.fnm/node-versions"
        if let versions = try? FileManager.default.contentsOfDirectory(atPath: fnmBase) {
            for version in versions.sorted().reversed() {
                candidates.insert(fnmBase + "/" + version + "/installation/bin/node", at: 0)
            }
        }

        for path in candidates {
            if FileManager.default.isExecutableFile(atPath: path) {
                return path
            }
        }

        return findOnPath("node")
    }

    private func augmentedPATH() -> String {
        let home = NSHomeDirectory()
        let extras = [
            "/opt/homebrew/bin",
            "/usr/local/bin",
            home + "/.nvm/versions/node/current/bin",
        ]
        let current = ProcessInfo.processInfo.environment["PATH"] ?? "/usr/bin:/bin:/usr/sbin:/sbin"
        return extras.joined(separator: ":") + ":" + current
    }

    private func findOnPath(_ name: String) -> String? {
        let process = Process()
        process.executableURL = URL(fileURLWithPath: "/usr/bin/env")
        process.arguments = ["bash", "-lc", "command -v \(name)"]

        var env = ProcessInfo.processInfo.environment
        env["PATH"] = augmentedPATH()
        process.environment = env

        let pipe = Pipe()
        process.standardOutput = pipe
        process.standardError = Pipe()

        do {
            try process.run()
            process.waitUntilExit()
            guard process.terminationStatus == 0 else { return nil }
            let data = pipe.fileHandleForReading.readDataToEndOfFile()
            let path = String(data: data, encoding: .utf8)?
                .trimmingCharacters(in: .whitespacesAndNewlines)
            guard let path, !path.isEmpty else { return nil }
            return path
        } catch {
            return nil
        }
    }

    private func runProcess(executable: String, arguments: [String]) async throws -> String {
        try await withCheckedThrowingContinuation { continuation in
            DispatchQueue.global(qos: .userInitiated).async {
                let process = Process()
                process.executableURL = URL(fileURLWithPath: executable)
                process.arguments = arguments

                var env = ProcessInfo.processInfo.environment
                env["PATH"] = self.augmentedPATH()
                env["NODE_NO_WARNINGS"] = "1"
                process.environment = env

                let stdout = Pipe()
                let stderr = Pipe()
                process.standardOutput = stdout
                process.standardError = stderr

                do {
                    try process.run()
                    process.waitUntilExit()

                    let outData = stdout.fileHandleForReading.readDataToEndOfFile()
                    let errData = stderr.fileHandleForReading.readDataToEndOfFile()
                    let out = String(data: outData, encoding: .utf8) ?? ""
                    let err = String(data: errData, encoding: .utf8) ?? ""

                    if process.terminationStatus != 0 {
                        let message = err.isEmpty ? out : err
                        continuation.resume(throwing: CLIClientError.executionFailed(
                            message.trimmingCharacters(in: .whitespacesAndNewlines)
                        ))
                        return
                    }

                    continuation.resume(returning: out)
                } catch {
                    continuation.resume(throwing: CLIClientError.executionFailed(error.localizedDescription))
                }
            }
        }
    }

    private func parseQuota(from output: String) throws -> QuotaResponse {
        let trimmed = output.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else {
            throw CLIClientError.invalidJSON("empty output")
        }

        let jsonString: String
        if let start = trimmed.firstIndex(of: "{"), let end = trimmed.lastIndex(of: "}") {
            jsonString = String(trimmed[start...end])
        } else {
            jsonString = trimmed
        }

        guard let data = jsonString.data(using: .utf8) else {
            throw CLIClientError.invalidJSON("cannot encode output")
        }
        do {
            return try JSONDecoder().decode(QuotaResponse.self, from: data)
        } catch {
            throw CLIClientError.invalidJSON(error.localizedDescription)
        }
    }

    var recommendedRefreshInterval: TimeInterval { refreshCooldown }
}
