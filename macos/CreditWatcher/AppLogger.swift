import Foundation
import os.log

enum AppLogger {
    private static let log = Logger(subsystem: "com.creditwatcher.menubar", category: "app")

    static func info(_ message: String) {
        log.info("\(message, privacy: .public)")
        NSLog("[CreditWatcher] \(message)")
    }

    static func error(_ message: String) {
        log.error("\(message, privacy: .public)")
        NSLog("[CreditWatcher] ERROR: \(message)")
    }
}
