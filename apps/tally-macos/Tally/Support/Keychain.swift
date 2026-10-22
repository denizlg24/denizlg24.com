import Foundation
import LocalAuthentication
import Security

/// Tally's own secrets in the login keychain. Items Tally creates trust Tally's
/// designated requirement, so a Developer ID build reads them without a prompt.
enum Keychain {
  private static let interactionLock = NSRecursiveLock()

  /// The login keychain uses the legacy macOS backend, which ignores
  /// LAContext.interactionNotAllowed. Serialize this process-wide setting so
  /// a background read cannot inherit an explicit foreground authorization.
  private static func withInteraction<T>(_ allowed: Bool, _ operation: () throws -> T) throws -> T {
    interactionLock.lock()
    defer { interactionLock.unlock() }
    var previous = DarwinBoolean(true)
    let read = SecKeychainGetUserInteractionAllowed(&previous)
    guard read == errSecSuccess else { throw Failure(status: read) }
    let set = SecKeychainSetUserInteractionAllowed(allowed)
    guard set == errSecSuccess else { throw Failure(status: set) }
    defer { _ = SecKeychainSetUserInteractionAllowed(previous.boolValue) }
    return try operation()
  }

  struct Failure: Error, LocalizedError {
    let status: OSStatus
    var errorDescription: String? {
      (SecCopyErrorMessageString(status, nil) as String?) ?? "Keychain error \(status)"
    }
  }

  static func read(service: String, account: String, allowInteraction: Bool = false) throws -> Data?
  {
    try withInteraction(allowInteraction) {
      let context = LAContext()
      context.interactionNotAllowed = !allowInteraction
      let query: [String: Any] = [
        kSecClass as String: kSecClassGenericPassword,
        kSecAttrService as String: service,
        kSecAttrAccount as String: account,
        kSecReturnData as String: true,
        kSecMatchLimit as String: kSecMatchLimitOne,
        kSecUseAuthenticationContext as String: context,
      ]
      var result: CFTypeRef?
      let status = SecItemCopyMatching(query as CFDictionary, &result)
      if status == errSecItemNotFound { return nil }
      guard status == errSecSuccess else { throw Failure(status: status) }
      return result as? Data
    }
  }

  static func write(_ data: Data, service: String, account: String, allowInteraction: Bool = false)
    throws
  {
    try withInteraction(allowInteraction) {
      let context = LAContext()
      context.interactionNotAllowed = !allowInteraction
      let query: [String: Any] = [
        kSecClass as String: kSecClassGenericPassword,
        kSecAttrService as String: service,
        kSecAttrAccount as String: account,
        kSecUseAuthenticationContext as String: context,
      ]
      let update = SecItemUpdate(
        query as CFDictionary, [kSecValueData as String: data] as CFDictionary)
      if update == errSecSuccess { return }
      guard update == errSecItemNotFound else { throw Failure(status: update) }
      var item = query
      item[kSecValueData as String] = data
      item[kSecAttrLabel as String] = service
      let add = SecItemAdd(item as CFDictionary, nil)
      guard add == errSecSuccess else { throw Failure(status: add) }
    }
  }

  static func delete(service: String, account: String) {
    _ = try? withInteraction(false) {
      let query: [String: Any] = [
        kSecClass as String: kSecClassGenericPassword,
        kSecAttrService as String: service,
        kSecAttrAccount as String: account,
      ]
      SecItemDelete(query as CFDictionary)
    }
  }
}
