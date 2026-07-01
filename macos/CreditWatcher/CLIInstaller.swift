import Foundation

enum CLIInstaller {
    private static let commandName = "creditwatcher"
    private static let bundledRelativePath = "cli/creditwatcher"

    static var bundledCLIURL: URL? {
        guard let resourceURL = Bundle.main.resourceURL else { return nil }
        let url = resourceURL.appendingPathComponent(bundledRelativePath)
        return FileManager.default.isExecutableFile(atPath: url.path) ? url : nil
    }

    static func installShimIfPossible() {
        guard let bundledCLIURL else {
            AppLogger.info("Bundled CLI is not available in this app build")
            return
        }

        if isRunningFromInstallerVolume {
            AppLogger.info("Skipping CLI shim install while running from installer volume")
            return
        }

        for directory in installDirectories() {
            if installShim(in: directory, target: bundledCLIURL) {
                return
            }
        }

        AppLogger.info("CLI shim was not installed because no writable PATH directory was available")
    }

    static func terminalCommand(arguments: String) -> String {
        if let bundledCLIURL {
            return "\(shellQuote(bundledCLIURL.path)) \(arguments)"
        }
        return "\(commandName) \(arguments)"
    }

    private static var isRunningFromInstallerVolume: Bool {
        Bundle.main.bundleURL.path.hasPrefix("/Volumes/")
    }

    private static func installDirectories() -> [URL] {
        let fileManager = FileManager.default
        let home = fileManager.homeDirectoryForCurrentUser
        let candidates = [
            URL(fileURLWithPath: "/opt/homebrew/bin", isDirectory: true),
            URL(fileURLWithPath: "/usr/local/bin", isDirectory: true),
            home.appendingPathComponent(".local/bin", isDirectory: true),
            home.appendingPathComponent("bin", isDirectory: true),
        ]

        var seen: Set<String> = []
        return candidates.filter { seen.insert($0.standardizedFileURL.path).inserted }
    }

    private static func installShim(in directory: URL, target: URL) -> Bool {
        let fileManager = FileManager.default
        let path = directory.path

        if !fileManager.fileExists(atPath: path) {
            do {
                try fileManager.createDirectory(at: directory, withIntermediateDirectories: true)
            } catch {
                return false
            }
        }

        guard fileManager.isWritableFile(atPath: path) else { return false }

        let shim = directory.appendingPathComponent(commandName)

        do {
            if fileManager.fileExists(atPath: shim.path) || isSymlink(shim) {
                guard shouldReplaceExistingShim(shim) else {
                    AppLogger.info("Leaving existing CLI command in place: \(shim.path)")
                    return true
                }
                try fileManager.removeItem(at: shim)
            }

            try fileManager.createSymbolicLink(at: shim, withDestinationURL: target)
            AppLogger.info("Installed CLI shim: \(shim.path) -> \(target.path)")
            return true
        } catch {
            AppLogger.error("Failed to install CLI shim in \(path): \(error)")
            return false
        }
    }

    private static func shouldReplaceExistingShim(_ shim: URL) -> Bool {
        guard isSymlink(shim), let destination = symlinkDestination(shim) else { return false }
        return destination.contains("/CreditWatcher.app/Contents/Resources/\(bundledRelativePath)")
    }

    private static func isSymlink(_ url: URL) -> Bool {
        do {
            let values = try url.resourceValues(forKeys: [.isSymbolicLinkKey])
            return values.isSymbolicLink == true
        } catch {
            return false
        }
    }

    private static func symlinkDestination(_ url: URL) -> String? {
        try? FileManager.default.destinationOfSymbolicLink(atPath: url.path)
    }

    private static func shellQuote(_ text: String) -> String {
        "'\(text.replacingOccurrences(of: "'", with: "'\\''"))'"
    }
}
